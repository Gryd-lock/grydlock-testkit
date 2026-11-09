import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeMetrics, percentile, latencySummary } from '../scripts/lib/metrics.mjs';
import { tierForScore, labelForScore } from '../scripts/lib/tiers.mjs';
import { fixturesOracle, runEvaluation, renderMarkdown, targetScVal, oracleFromSpec } from '../scripts/eval.mjs';
import { scValToNative } from '@stellar/stellar-sdk';
import { root } from './helpers.mjs';

test('tiers: mirror grydlock-extension boundaries', () => {
  assert.equal(tierForScore(0), 'low');
  assert.equal(tierForScore(20), 'low');
  assert.equal(tierForScore(21), 'elevated');
  assert.equal(tierForScore(50), 'elevated');
  assert.equal(tierForScore(51), 'high');
  assert.equal(tierForScore(75), 'high');
  assert.equal(tierForScore(76), 'critical');
  assert.equal(tierForScore(100), 'critical');
  assert.equal(tierForScore(null), 'unscored');
  assert.equal(tierForScore(150), 'critical');
});

test('tiers: map onto ground-truth labels', () => {
  assert.equal(labelForScore(5), 'clean');
  assert.equal(labelForScore(40), 'suspicious');
  assert.equal(labelForScore(60), 'suspicious');
  assert.equal(labelForScore(90), 'malicious');
  assert.equal(labelForScore(null), 'unscored');
});

test('metrics: per-tier precision/recall and warning FPR on a hand-computed example', () => {
  const items = [
    { label: 'clean', predicted: 'clean', risk_pattern: 'none' },
    { label: 'clean', predicted: 'suspicious', risk_pattern: 'adversarial-clean' }, // FP
    { label: 'clean', predicted: 'unscored', risk_pattern: 'none' },
    { label: 'suspicious', predicted: 'suspicious', risk_pattern: 'pass-through' },
    { label: 'malicious', predicted: 'malicious', risk_pattern: 'sweep' },
    { label: 'malicious', predicted: 'suspicious', risk_pattern: 'sweep' },
    { label: 'malicious', predicted: 'clean', risk_pattern: 'cold-start' } // FN
  ];
  const m = computeMetrics(items);
  assert.equal(m.n, 7);
  assert.equal(m.unscored, 1);
  assert.equal(m.perTier.clean.support, 3);
  assert.equal(m.perTier.clean.precision, 1 / 2); // predicted clean: 2, correct 1
  assert.equal(m.perTier.clean.recall, 1 / 3);
  assert.equal(m.perTier.suspicious.precision, 1 / 3);
  assert.equal(m.perTier.suspicious.recall, 1);
  assert.equal(m.perTier.malicious.precision, 1);
  assert.equal(m.perTier.malicious.recall, 1 / 3);
  assert.deepEqual(
    { tp: m.warn.tp, fp: m.warn.fp, fn: m.warn.fn, tn: m.warn.tn },
    { tp: 3, fp: 1, fn: 1, tn: 2 }
  );
  assert.equal(m.warn.falsePositiveRate, 1 / 3);
  assert.equal(m.warn.recall, 3 / 4);
  assert.equal(m.byRiskPattern.sweep.support, 2);
  assert.equal(m.byRiskPattern.sweep.warned, 2);
});

test('metrics: undefined ratios are null, not NaN', () => {
  const m = computeMetrics([{ label: 'clean', predicted: 'clean', risk_pattern: 'none' }]);
  assert.equal(m.perTier.malicious.precision, null);
  assert.equal(m.perTier.malicious.recall, null);
  assert.equal(m.warn.precision, null);
});

test('latency: nearest-rank percentiles', () => {
  const v = [5, 1, 4, 2, 3, 6, 7, 8, 9, 10];
  assert.equal(percentile(v, 50), 5);
  assert.equal(percentile(v, 95), 10);
  assert.equal(percentile([], 50), null);
  assert.deepEqual(latencySummary([2, 1]), { n: 2, p50: 1, p95: 2, max: 2 });
});

test('soroban oracle: Target encoding for accounts and assets', () => {
  const g = 'GD7XPB2A7CG5Z4ICV24B3LXCRHAEJRFEK4OEW3ZIOQAPJOHAXBB7QHGE';
  assert.deepEqual(scValToNative(targetScVal(g)), ['Address', g]);
  const issuer = 'GAJLLIIPHII6OCG4KQJIGPCHVN6DNCRBXHX6DEUTPE7MQ6OONAYBRLET';
  assert.deepEqual(scValToNative(targetScVal(`SCAM:${issuer}`)), ['Asset', 'SCAM', issuer]);
  assert.throws(() => oracleFromSpec('bogus'), /unknown --oracle/);
});

test('eval: fixtures oracle scores every fixture end to end, offline', async () => {
  const report = await runEvaluation(fixturesOracle(root));
  const { overall, destinations, transactions } = report.metrics;
  assert.equal(overall.n, destinations.n + transactions.n);
  assert.ok(destinations.n >= 60, 'expected >= 60 destinations');
  assert.ok(transactions.n >= 25, 'expected >= 25 transactions');
  // every destination has a stub score, so destination coverage is total
  assert.equal(destinations.coverage, 1);
  for (const tier of ['clean', 'suspicious', 'malicious']) {
    assert.ok(overall.perTier[tier].support > 0, `no ${tier} fixtures`);
  }
  assert.ok(report.latencyMs.oracleCall.n > 0);
  const md = renderMarkdown(report);
  assert.match(md, /False-positive rate/);
  assert.match(md, /Per tier/);
});
