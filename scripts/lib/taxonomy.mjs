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
  'account-merge-drain',
  'clawback-enabled',
  'soroban-approval-drain',
  'claimable-balance-spam',
  'none'
];

// Where a fixture came from. `testnet` fixtures were executed on Stellar
// testnet by scripts/testnet/generate.mjs and carry a verifiable tx hash;
// `offline-synthetic` fixtures are the original hand-made seed set whose
// addresses were never funded.
export const VALID_PROVENANCE_KINDS = ['testnet', 'offline-synthetic'];

export const VALID_DESTINATION_TYPES = ['account', 'asset', 'contract'];

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

// Expected stub-score band per label (CONTRIBUTING.md rubric). A score outside
// its label's band is allowed only with a `score_rationale` explaining the
// deliberate deviation (e.g. a modelled oracle blind spot).
export const SCORE_BANDS = Object.freeze({
  clean: [0, 25],
  suspicious: [40, 70],
  malicious: [75, 100]
});
