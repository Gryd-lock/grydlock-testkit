import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Account, Asset, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { decodeTransactionXdr, extractDestination } from './evaluate/decode.mjs';
import { STUB_DEFAULT_SCORE, createDestinationIndex, stubLookup } from './evaluate/stub-oracle.mjs';
import { LABEL_ALLOWED_TIERS, compareLabelAndTier, tierForScore } from './evaluate/tiers.mjs';
import { evaluateLabelledDestination, evaluateRepo, evaluateTransaction } from './evaluate/pipeline.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const CLEAN = 'GCRRYBV5IY7DSI54DKW33ZELC2LWYCAHC43TXAM2A2HTFN5GWOFWXPC2';
const SUSPICIOUS = 'GCRNKXJJLZNDLK2EWPX25JISTORCXCF2HYUXMYKF7XWKHMEOHCXVGP4J';

function loadScoresAndDestinations() {
  const destinations = JSON.parse(readFileSync(join(root, 'destinations.json'), 'utf-8')).destinations;
  const scores = JSON.parse(readFileSync(join(root, 'scores.json'), 'utf-8'));
  return { destinations, scores, destinationsById: createDestinationIndex(destinations) };
}

function buildPaymentXdr(destination, source = CLEAN) {
  const account = new Account(source, '0');
  return new TransactionBuilder(account, {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.payment({ destination, asset: Asset.native(), amount: '10' }))
    .setTimeout(30)
    .build()
    .toXDR();
}

describe('tier mapping (grydlock-research)', () => {
  it('maps research score bands to warning tiers', () => {
    assert.equal(tierForScore(0), 'low');
    assert.equal(tierForScore(20), 'low');
    assert.equal(tierForScore(21), 'elevated');
    assert.equal(tierForScore(50), 'elevated');
    assert.equal(tierForScore(51), 'high');
    assert.equal(tierForScore(75), 'high');
    assert.equal(tierForScore(76), 'critical');
    assert.equal(tierForScore(100), 'critical');
  });

  it('compares labels to allowed tiers explicitly', () => {
    assert.deepEqual(LABEL_ALLOWED_TIERS.clean, ['low', 'elevated']);
    assert.equal(compareLabelAndTier('clean', 'low').match, true);
    assert.equal(compareLabelAndTier('suspicious', 'high').match, true);
    assert.equal(compareLabelAndTier('malicious', 'critical').match, true);
    assert.equal(compareLabelAndTier('clean', 'critical').match, false);
    assert.equal(compareLabelAndTier('malicious', 'low').match, false);
  });
});

describe('stub lookup', () => {
  it('keeps unknown destinations distinct from low-risk score 0', () => {
    const { scores, destinationsById } = loadScoresAndDestinations();
    const unknown = Keypair.random().publicKey();
    const knownLow = stubLookup(CLEAN, scores, destinationsById);
    const missing = stubLookup(unknown, scores, destinationsById);

    assert.equal(knownLow.status, 'known');
    assert.equal(knownLow.score, 4);
    assert.equal(tierForScore(knownLow.score), 'low');

    assert.equal(missing.status, 'unknown');
    assert.equal(missing.score, null);
    assert.equal(missing.stubOracleScore, STUB_DEFAULT_SCORE);
    assert.notEqual(missing.status, 'known');
    assert.notEqual('unscored', 'low');
  });
});

describe('evaluateTransaction', () => {
  it('evaluates a valid payment end to end', () => {
    const { scores, destinationsById } = loadScoresAndDestinations();
    const result = evaluateTransaction({
      fixture: 'valid-payment.xdr',
      xdr: buildPaymentXdr(SUSPICIOUS),
      scores,
      destinationsById,
    });

    assert.equal(result.completed, true);
    assert.equal(result.failures.length, 0);
    assert.equal(result.destinations.length, 1);
    assert.equal(result.destinations[0].destination, SUSPICIOUS);
    assert.equal(result.destinations[0].expectedLabel, 'suspicious');
    assert.equal(result.destinations[0].derivedTier, 'high');
    assert.equal(result.destinations[0].score, 55);
    assert.equal(result.destinations[0].comparison.match, true);
  });

  it('marks unknown destinations as unscored, not low, and fails at lookup', () => {
    const { scores, destinationsById } = loadScoresAndDestinations();
    const unknown = Keypair.random().publicKey();
    const result = evaluateTransaction({
      fixture: 'unknown-dest.xdr',
      xdr: buildPaymentXdr(unknown),
      scores,
      destinationsById,
    });

    assert.equal(result.completed, false);
    assert.equal(result.destinations[0].lookupStatus, 'unknown');
    assert.equal(result.destinations[0].derivedTier, 'unscored');
    assert.equal(result.destinations[0].score, null);
    assert.equal(result.destinations[0].stubOracleScore, 0);
    assert.equal(result.destinations[0].comparison.distinctFromLow, true);
    assert.notEqual(result.destinations[0].derivedTier, 'low');
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0].fixture, 'unknown-dest.xdr');
    assert.equal(result.failures[0].stage, 'lookup');
  });

  it('fails malformed XDR at the decode stage and names the fixture', () => {
    const { scores, destinationsById } = loadScoresAndDestinations();
    const result = evaluateTransaction({
      fixture: 'malformed.xdr',
      xdr: 'not-valid-xdr',
      scores,
      destinationsById,
    });

    assert.equal(result.completed, false);
    assert.equal(result.destinations.length, 0);
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0].fixture, 'malformed.xdr');
    assert.equal(result.failures[0].stage, 'decode');
    assert.ok(result.failures[0].message.length > 0);
  });

  it('treats extractDestination null as decode-or-empty, while staged decode distinguishes malformed input', () => {
    assert.equal(extractDestination('not-valid-xdr'), null);
    const decoded = decodeTransactionXdr('not-valid-xdr');
    assert.equal(decoded.ok, false);
  });

  it('reports an explicit compare failure when label and tier disagree', () => {
    const destinationsById = createDestinationIndex([
      { id: CLEAN, type: 'account', address: CLEAN, label: 'clean' },
    ]);
    const scores = { [CLEAN]: 92 };
    const result = evaluateLabelledDestination({
      fixture: 'mismatch',
      destinationId: CLEAN,
      scores,
      destinationsById,
    });

    assert.equal(result.completed, false);
    assert.equal(result.failures[0].stage, 'compare');
    assert.equal(result.failures[0].fixture, 'mismatch');
    assert.equal(result.destinations[0].derivedTier, 'critical');
    assert.equal(result.destinations[0].expectedLabel, 'clean');
  });
});

describe('evaluateRepo', () => {
  it('evaluates every current transaction fixture end to end', () => {
    const report = evaluateRepo(root);
    const names = report.transactions.map((result) => result.fixture).sort();

    assert.deepEqual(names, ['change_trust.xdr', 'path_payment.xdr', 'payment.xdr']);
    assert.equal(report.ok, true);
    assert.equal(report.failures.length, 0);
    assert.equal(report.summary.transactions, 3);
    assert.equal(report.summary.labelledDestinations, 12);
    assert.equal(report.fixtureRelease, '0.1.0');

    const payment = report.transactions.find((result) => result.fixture === 'payment.xdr');
    assert.equal(payment.destinations[0].expectedLabel, 'suspicious');
    assert.equal(payment.destinations[0].derivedTier, 'high');
    assert.equal(payment.destinations[0].comparison.match, true);

    const pathPayment = report.transactions.find((result) => result.fixture === 'path_payment.xdr');
    assert.equal(pathPayment.destinations[0].expectedLabel, 'malicious');
    assert.equal(pathPayment.destinations[0].derivedTier, 'critical');

    const changeTrust = report.transactions.find((result) => result.fixture === 'change_trust.xdr');
    assert.equal(changeTrust.completed, true);
    assert.equal(changeTrust.destinations.length, 0);
    assert.equal(changeTrust.failures.length, 0);
  });
});
