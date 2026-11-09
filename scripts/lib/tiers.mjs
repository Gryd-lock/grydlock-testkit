// Score -> tier contract, mirrored from grydlock-extension `src/lib/tiers.ts`
// (TIERS: low <= 20, elevated <= 50, high <= 75, critical <= 100, plus an
// `unscored` sentinel when no score exists). Keep in sync with that file.
//
// The evaluation maps the extension's four display tiers onto the testkit's
// three ground-truth labels:
//   low                -> clean       (no warning)
//   elevated, high     -> suspicious  (warning)
//   critical           -> malicious   (strong warning)
//   unscored           -> unscored    (counted as "no warning" for recall/FPR,
//                                      and reported separately as coverage)

export const TIER_BANDS = Object.freeze([
  { tier: 'low', max: 20 },
  { tier: 'elevated', max: 50 },
  { tier: 'high', max: 75 },
  { tier: 'critical', max: 100 }
]);

export const TIER_TO_LABEL = Object.freeze({
  low: 'clean',
  elevated: 'suspicious',
  high: 'suspicious',
  critical: 'malicious',
  unscored: 'unscored'
});

export const LABEL_RANK = Object.freeze({ unscored: -1, clean: 0, suspicious: 1, malicious: 2 });

export function tierForScore(score) {
  if (score === null || score === undefined || !Number.isFinite(score)) return 'unscored';
  const clamped = Math.max(0, Math.min(100, score));
  return TIER_BANDS.find(({ max }) => clamped <= max).tier;
}

export function labelForScore(score) {
  return TIER_TO_LABEL[tierForScore(score)];
}
