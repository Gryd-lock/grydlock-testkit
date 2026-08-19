// Shared vocabulary for Gryd Lock fixtures.
//
// These constants are the single source of truth for the label (risk tier)
// and risk-pattern (warning category) taxonomies used by both the point-fixture
// validator (scripts/validate-fixtures.mjs) and the scenario system
// (scripts/lib/scenario.mjs).

export const VALID_LABELS = ['clean', 'suspicious', 'malicious'];

export const VALID_RISK_PATTERNS = [
  'sweep',
  'phishing-drainer',
  'rug-pull',
  'pass-through',
  'scam-trustline',
  'signer-takeover',
  'memo-impersonation',
  'sponsored-mule',
  'cold-start',
  'adversarial-clean',
  'none'
];

// Risk patterns that represent an actual warning signal. `none` is a
// destination with no red flags and therefore never produces a warning.
export const WARNING_RISK_PATTERNS = VALID_RISK_PATTERNS.filter((p) => p !== 'none');

// Deterministic tier ordering used by the scenario replay's synthetic state
// machine. A participant's tier escalates monotonically (clean < suspicious <
// malicious) as it interacts with riskier destinations.
export const TIER_RANK = Object.freeze({
  clean: 0,
  suspicious: 1,
  malicious: 2
});
