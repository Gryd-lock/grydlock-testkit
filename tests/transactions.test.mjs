import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, cpSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { validateTransactionIndex } from '../scripts/validate-transactions.mjs';
import { StrKey } from '@stellar/stellar-sdk';

import { decodeEnvelope, extractCounterparties, baseAccount } from '../scripts/lib/stellar.mjs';
import { root } from './helpers.mjs';

const index = JSON.parse(readFileSync(join(root, 'transactions/index.json'), 'utf-8'));
const destinations = JSON.parse(readFileSync(join(root, 'destinations.json'), 'utf-8')).destinations;
const destIds = new Set(destinations.map((d) => d.id));

function copyRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'testkit-'));
  for (const p of ['transactions', 'destinations.json', 'scores.json']) cpSync(join(root, p), join(dir, p), { recursive: true });
  return dir;
}

test('transactions: the committed index validates cleanly', () => {
  const { errors } = validateTransactionIndex(root);
  assert.deepEqual(errors, []);
});

test('transactions: a tampered XDR is caught by the hash check', () => {
  const dir = copyRepo();
  const f = index.fixtures.find((x) => x.id === 'payment');
  // swap in a different (valid) envelope under the same id
  const other = readFileSync(join(root, 'transactions/path_payment.xdr'), 'utf-8');
  writeFileSync(join(dir, f.file), other);
  const { errors } = validateTransactionIndex(dir);
  assert.ok(errors.some((e) => e.startsWith('payment:') && e.includes('stellarHashTestnet')), errors.join('\n'));
});

test('transactions: an unindexed .xdr file is reported', () => {
  const dir = copyRepo();
  writeFileSync(join(dir, 'transactions/orphan.xdr'), readFileSync(join(root, 'transactions/payment.xdr'), 'utf-8'));
  const { errors } = validateTransactionIndex(dir);
  assert.ok(errors.some((e) => e.includes('orphan.xdr is not listed')));
});

test('transactions: an invalid label is reported', () => {
  const dir = copyRepo();
  const idx = JSON.parse(readFileSync(join(dir, 'transactions/index.json'), 'utf-8'));
  idx.fixtures[0].label = 'risky';
  writeFileSync(join(dir, 'transactions/index.json'), JSON.stringify(idx));
  const { errors } = validateTransactionIndex(dir);
  assert.ok(errors.some((e) => e.includes('invalid label "risky"')));
});

test('transactions: every testnet fixture has a verifiable stellar.expert link', () => {
  const testnet = index.fixtures.filter((f) => f.provenance.kind === 'testnet');
  assert.ok(testnet.length >= 25, `expected >= 25 testnet fixtures, got ${testnet.length}`);
  for (const f of testnet) {
    assert.equal(f.provenance.explorer, `https://stellar.expert/explorer/testnet/tx/${f.stellarHashTestnet}`);
    assert.equal(f.signed, false);
  }
});

test('transactions: required categories are all covered', () => {
  const ops = (f) => f.operations.map((o) => o.type);
  const has = (pred) => index.fixtures.some(pred);
  assert.ok(has((f) => f.label === 'clean' && ops(f).includes('payment')), 'clean payment');
  assert.ok(has((f) => ops(f).some((t) => t.startsWith('pathPayment'))), 'path payment');
  assert.ok(has((f) => f.envelopeType === 'envelopeTypeTxFeeBump' && f.provenance.kind === 'testnet'), 'fee bump');
  assert.ok(has((f) => f.risk_pattern === 'signer-takeover' && ops(f).includes('setOptions')), 'setOptions signer takeover');
  assert.ok(has((f) => f.risk_pattern === 'account-merge-drain' && ops(f).includes('accountMerge')), 'account merge drain');
  assert.ok(has((f) => f.risk_pattern === 'scam-trustline' && ops(f).includes('changeTrust')), 'scam trustline');
  assert.ok(has((f) => f.risk_pattern === 'clawback-enabled'), 'clawback-enabled asset');
  assert.ok(has((f) => f.operations.some((o) => o.type === 'invokeHostFunction' && o.method === 'approve') && f.label === 'malicious'), 'soroban approve to unknown spender');
  assert.ok(has((f) => f.operations.some((o) => o.type === 'invokeHostFunction' && o.method === 'transfer')), 'soroban token transfer');
  assert.ok(has((f) => f.operations.length >= 2 && f.label === 'malicious'), 'malicious multi-op bundle');
  assert.ok(has((f) => ops(f).includes('claimClaimableBalance')), 'claimable balance');
});

test('transactions: testnet fixtures only reference labelled or internal counterparties', () => {
  const run = JSON.parse(readFileSync(join(root, 'dataset/testnet-run.json'), 'utf-8'));
  const internal = new Set(Object.values(run.personas).map((p) => p.address));
  const systemContracts = new Set([run.contracts.native]);
  for (const f of index.fixtures.filter((x) => x.provenance.kind === 'testnet')) {
    for (const id of f.counterparties) {
      assert.ok(destIds.has(id) || internal.has(id) || systemContracts.has(id), `${f.id}: unknown counterparty ${id}`);
    }
  }
});

test('extraction: fee-bump exposes the fee source and the inner destination', () => {
  const tx = decodeEnvelope(readFileSync(join(root, 'transactions/fee_bump_payment.xdr'), 'utf-8'));
  assert.deepEqual(extractCounterparties(tx), [
    'GA4HFFSHZ7PADQWOFCZGYV2HE437LQ2WDILWCGC33BMJUQ6OBO5HKI5D',
    'GCRNKXJJLZNDLK2EWPX25JISTORCXCF2HYUXMYKF7XWKHMEOHCXVGP4J'
  ]);
});

test('extraction: muxed addresses are scored under their base account', () => {
  const g = 'GCRRYBV5IY7DSI54DKW33ZELC2LWYCAHC43TXAM2A2HTFN5GWOFWXPC2';
  // M-address for g with id 1, built from the raw key
  const raw = Buffer.concat([StrKey.decodeEd25519PublicKey(g), Buffer.from([0, 0, 0, 0, 0, 0, 0, 1])]);
  assert.equal(baseAccount(StrKey.encodeMed25519PublicKey(raw)), g);
  assert.equal(baseAccount(g), g);
});

test('transactions: ids are servable by grydlock-extension demo server (/^[a-z_]+$/)', () => {
  for (const f of index.fixtures) assert.match(f.id, /^[a-z_]+$/, `${f.id} would 404 in the extension demo`);
});
