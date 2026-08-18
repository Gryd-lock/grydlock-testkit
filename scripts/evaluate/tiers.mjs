/**
 * Score → warning-tier mapping from grydlock-research (Warning Tiers) and
 * grydlock-extension `src/lib/tiers.ts` (`tierForScore`).
 *
 * | Score   | Tier      |
 * |---------|-----------|
 * | 0–20    | low       |
 * | 21–50   | elevated  |
 * | 51–75   | high      |
 * | 76–100  | critical  |
 *
 * Unknown / missing scores use `unscored`, which must stay distinct from `low`.
 */

export const RESEARCH_TIERS = [
  { max: 20, tier: 'low' },
  { max: 50, tier: 'elevated' },
  { max: 75, tier: 'high' },
  { max: 100, tier: 'critical' },
];

/**
 * Ground-truth fixture labels vs derived research tiers.
 *
 * CONTRIBUTING.md score bands overlap adjacent research tiers, so the
 * comparison is an explicit allow-list rather than a 1:1 rename:
 *   clean      0–25   → low | elevated
 *   suspicious 40–70  → elevated | high
 *   malicious  75–100 → high | critical  (75 is high; 76+ is critical)
 */
export const LABEL_ALLOWED_TIERS = {
  clean: ['low', 'elevated'],
  suspicious: ['elevated', 'high'],
  malicious: ['high', 'critical'],
};

export function tierForScore(score) {
  const clamped = Math.max(0, Math.min(100, score));
  const match = RESEARCH_TIERS.find(({ max }) => clamped <= max);
  return match.tier;
}

export function compareLabelAndTier(expectedLabel, derivedTier) {
  const allowedTiers = LABEL_ALLOWED_TIERS[expectedLabel] ?? [];
  const match = allowedTiers.includes(derivedTier);
  return {
    expectedLabel,
    derivedTier,
    allowedTiers,
    match,
  };
}
