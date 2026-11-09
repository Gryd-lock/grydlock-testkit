// Pure scoring metrics for the evaluation runner. No I/O.
//
// Each evaluated item is { id, label, predicted, risk_pattern } where `label`
// is ground truth (clean | suspicious | malicious) and `predicted` is the tier
// the oracle path produced, already mapped onto labels (see tiers.mjs), or
// `unscored`.

import { VALID_LABELS } from './taxonomy.mjs';

const WARN = new Set(['suspicious', 'malicious']);
const ratio = (num, den) => (den === 0 ? null : num / den);

export function computeMetrics(items) {
  const predictedKeys = [...VALID_LABELS, 'unscored'];
  const confusion = Object.fromEntries(
    VALID_LABELS.map((l) => [l, Object.fromEntries(predictedKeys.map((p) => [p, 0]))])
  );
  for (const it of items) confusion[it.label][it.predicted] += 1;

  const perTier = {};
  for (const tier of VALID_LABELS) {
    const tp = confusion[tier][tier];
    const support = Object.values(confusion[tier]).reduce((a, b) => a + b, 0);
    const predictedAs = VALID_LABELS.reduce((s, l) => s + confusion[l][tier], 0);
    const precision = ratio(tp, predictedAs);
    const recall = ratio(tp, support);
    const f1 = precision === null || recall === null || precision + recall === 0
      ? null
      : (2 * precision * recall) / (precision + recall);
    perTier[tier] = { support, predicted: predictedAs, tp, precision, recall, f1 };
  }

  // Binary "did the user get a warning" view. Unscored counts as no warning.
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (const it of items) {
    const positive = WARN.has(it.label);
    const warned = WARN.has(it.predicted);
    if (positive && warned) tp++;
    else if (!positive && warned) fp++;
    else if (positive && !warned) fn++;
    else tn++;
  }
  const warn = {
    tp, fp, fn, tn,
    precision: ratio(tp, tp + fp),
    recall: ratio(tp, tp + fn),
    falsePositiveRate: ratio(fp, fp + tn),
    falseNegativeRate: ratio(fn, tp + fn)
  };

  const unscored = items.filter((it) => it.predicted === 'unscored').length;
  const exact = items.filter((it) => it.predicted === it.label).length;

  const byRiskPattern = {};
  for (const it of items) {
    const b = (byRiskPattern[it.risk_pattern] ??= { support: 0, exact: 0, warned: 0, unscored: 0, label: new Set() });
    b.support++;
    if (it.predicted === it.label) b.exact++;
    if (WARN.has(it.predicted)) b.warned++;
    if (it.predicted === 'unscored') b.unscored++;
    b.label.add(it.label);
  }
  for (const b of Object.values(byRiskPattern)) b.label = [...b.label].sort().join('/');

  return {
    n: items.length,
    accuracy: ratio(exact, items.length),
    coverage: ratio(items.length - unscored, items.length),
    unscored,
    perTier,
    warn,
    confusion,
    byRiskPattern
  };
}

// Nearest-rank percentile over a list of numbers (ms).
export function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.max(0, Math.min(sorted.length - 1, rank - 1))];
}

export function latencySummary(values) {
  return {
    n: values.length,
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    max: values.length ? Math.max(...values) : null
  };
}
