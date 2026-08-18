import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Networks } from '@stellar/stellar-sdk';
import { decodeTransactionXdr, extractDecodedDestination } from './decode.mjs';
import { createDestinationIndex, stubLookup } from './stub-oracle.mjs';
import { compareLabelAndTier, tierForScore } from './tiers.mjs';

function failure(fixture, stage, message, extra = {}) {
  return { fixture, stage, message, ...extra };
}

function evaluateLookup(fixture, target, scores, destinationsById) {
  const lookup = stubLookup(target, scores, destinationsById);

  if (lookup.status === 'unknown') {
    return {
      destination: target,
      lookupStatus: 'unknown',
      score: null,
      stubOracleScore: lookup.stubOracleScore,
      expectedLabel: null,
      derivedTier: 'unscored',
      comparison: {
        expectedLabel: null,
        derivedTier: 'unscored',
        allowedTiers: [],
        match: false,
        distinctFromLow: true,
      },
      failures: [
        failure(
          fixture,
          'lookup',
          `unknown destination ${target} (distinct from low-risk; StubOracle would return ${lookup.stubOracleScore})`,
          { destination: target, stubOracleScore: lookup.stubOracleScore, derivedTier: 'unscored' },
        ),
      ],
    };
  }

  const derivedTier = tierForScore(lookup.score);
  if (!lookup.expectedLabel) {
    return {
      destination: target,
      lookupStatus: 'known',
      score: lookup.score,
      stubOracleScore: lookup.stubOracleScore,
      expectedLabel: null,
      derivedTier,
      comparison: null,
      failures: [
        failure(
          fixture,
          'lookup',
          `score exists for ${target} but destinations.json has no matching label`,
          { destination: target, score: lookup.score, derivedTier },
        ),
      ],
    };
  }

  const comparison = compareLabelAndTier(lookup.expectedLabel, derivedTier);
  const failures = comparison.match
    ? []
    : [
        failure(
          fixture,
          'compare',
          `label "${lookup.expectedLabel}" is not compatible with derived tier "${derivedTier}" (allowed: ${comparison.allowedTiers.join(', ')})`,
          {
            destination: target,
            score: lookup.score,
            expectedLabel: lookup.expectedLabel,
            derivedTier,
            allowedTiers: comparison.allowedTiers,
          },
        ),
      ];

  return {
    destination: target,
    lookupStatus: 'known',
    score: lookup.score,
    stubOracleScore: lookup.stubOracleScore,
    expectedLabel: lookup.expectedLabel,
    derivedTier,
    comparison,
    failures,
  };
}

function uniqueDestinations(extracted) {
  const items = [];
  const seen = new Set();
  for (const item of extracted) {
    if (seen.has(item.destination)) continue;
    seen.add(item.destination);
    items.push(item);
  }
  return items;
}

export function evaluateTransaction({ fixture, xdr, scores, destinationsById, networkPassphrase = Networks.TESTNET }) {
  const result = {
    fixture,
    completed: false,
    destinations: [],
    failures: [],
  };

  const decoded = decodeTransactionXdr(xdr, networkPassphrase);
  if (!decoded.ok) {
    result.failures.push(failure(fixture, 'decode', decoded.error));
    return result;
  }

  const extracted = extractDecodedDestination(decoded.tx);
  const items = extracted?.destinations ?? [];
  result.memo = extracted?.memo;

  if (items.length === 0) {
    result.completed = true;
    return result;
  }

  for (const item of uniqueDestinations(items)) {
    const scored = evaluateLookup(fixture, item.destination, scores, destinationsById);
    scored.asset = item.asset;
    result.destinations.push(scored);
    result.failures.push(...scored.failures);
  }

  result.completed = result.failures.length === 0;
  return result;
}

export function evaluateLabelledDestination({ fixture, destinationId, scores, destinationsById }) {
  const scored = evaluateLookup(fixture, destinationId, scores, destinationsById);
  return {
    fixture,
    completed: scored.failures.length === 0,
    destinations: [scored],
    failures: scored.failures,
  };
}

export function loadFixtureCorpus(root) {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
  const destinationsDoc = JSON.parse(readFileSync(join(root, 'destinations.json'), 'utf-8'));
  const scores = JSON.parse(readFileSync(join(root, 'scores.json'), 'utf-8'));
  const destinations = destinationsDoc.destinations;
  const destinationsById = createDestinationIndex(destinations);

  const transactionsDir = join(root, 'transactions');
  const transactionFiles = readdirSync(transactionsDir)
    .filter((name) => name.endsWith('.xdr'))
    .sort();

  const transactions = transactionFiles.map((name) => ({
    fixture: name,
    xdr: readFileSync(join(transactionsDir, name), 'utf-8'),
  }));

  return {
    fixtureRelease: pkg.version,
    destinations,
    scores,
    destinationsById,
    transactions,
  };
}

export function evaluateRepo(root) {
  const corpus = loadFixtureCorpus(root);
  const { fixtureRelease, destinations, scores, destinationsById, transactions } = corpus;

  const transactionResults = transactions.map((tx) =>
    evaluateTransaction({
      fixture: tx.fixture,
      xdr: tx.xdr,
      scores,
      destinationsById,
    }),
  );

  const labelResults = destinations.map((destination) =>
    evaluateLabelledDestination({
      fixture: `destinations.json:${destination.id}`,
      destinationId: destination.id,
      scores,
      destinationsById,
    }),
  );

  const failures = [...transactionResults, ...labelResults].flatMap((result) => result.failures);
  const unknownCount = [...transactionResults, ...labelResults]
    .flatMap((result) => result.destinations)
    .filter((destination) => destination.lookupStatus === 'unknown').length;

  return {
    ok: failures.length === 0,
    fixtureRelease,
    source: 'working-tree',
    contracts: {
      decoder: 'grydlock-extension extractDestination',
      oracle: 'grydlock-oracle-adapter StubOracle',
      tiers: 'grydlock-research warning tiers',
    },
    summary: {
      transactions: transactionResults.length,
      labelledDestinations: labelResults.length,
      unknownDestinations: unknownCount,
      failures: failures.length,
    },
    transactions: transactionResults,
    labels: labelResults,
    failures,
  };
}

export function formatReport(report) {
  const lines = [
    `Gryd Lock evaluation  (fixtures ${report.fixtureRelease}, ${report.source})`,
    `decoder: ${report.contracts.decoder}`,
    `oracle:  ${report.contracts.oracle}`,
    `tiers:   ${report.contracts.tiers}`,
    '',
    'Transactions',
  ];

  for (const result of report.transactions) {
    if (result.failures.some((item) => item.stage === 'decode')) {
      const decodeFailure = result.failures.find((item) => item.stage === 'decode');
      lines.push(`  ${result.fixture}  FAIL decode  ${decodeFailure.message}`);
      continue;
    }

    if (result.destinations.length === 0) {
      lines.push(`  ${result.fixture}  ok  extract 0 destinations`);
      continue;
    }

    for (const destination of result.destinations) {
      const comparison = destination.comparison;
      const comparisonText = comparison
        ? `label ${comparison.expectedLabel} → tier ${comparison.derivedTier} (${comparison.match ? 'match' : 'mismatch'})`
        : `tier ${destination.derivedTier}`;
      const status = destination.failures.length === 0 ? 'ok' : 'FAIL';
      lines.push(
        `  ${result.fixture}  ${status}  ${destination.destination}  score ${destination.score ?? 'n/a'}  ${comparisonText}`,
      );
    }
  }

  lines.push('', 'Labelled destinations');
  for (const result of report.labels) {
    const destination = result.destinations[0];
    const status = result.completed ? 'ok' : 'FAIL';
    lines.push(
      `  ${status}  ${destination.destination}  score ${destination.score}  label ${destination.expectedLabel} → tier ${destination.derivedTier}`,
    );
  }

  lines.push('');
  if (report.failures.length > 0) {
    lines.push('Failures');
    for (const item of report.failures) {
      lines.push(`  [${item.stage}] ${item.fixture}: ${item.message}`);
    }
    lines.push('');
  }

  const verdict = report.ok ? 'OK' : 'FAILED';
  lines.push(
    `${verdict}  ${report.summary.transactions} transactions, ${report.summary.labelledDestinations} labels, ${report.summary.failures} failures`,
  );
  return lines.join('\n');
}
