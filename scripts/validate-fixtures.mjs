import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const destinations = JSON.parse(readFileSync(root + '/destinations.json', 'utf-8')).destinations;
const scores = JSON.parse(readFileSync(root + '/scores.json', 'utf-8'));

const VALID_LABELS = new Set(['clean', 'suspicious', 'malicious']);
const VALID_RISK_PATTERNS = new Set([
  'sweep', 'phishing-drainer', 'rug-pull', 'pass-through',
  'scam-trustline', 'signer-takeover', 'memo-impersonation',
  'sponsored-mule', 'cold-start', 'adversarial-clean', 'none'
]);

/**
 * Score bands per label as documented in CONTRIBUTING.md.
 * Gaps (26–39 and 71–74) are intentionally unused — do not fill them.
 */
export const SCORE_BANDS = {
  clean:      { min: 0,  max: 25  },
  suspicious: { min: 40, max: 70  },
  malicious:  { min: 75, max: 100 },
};

/**
 * Return a human-readable range string for a label, e.g. "0–25".
 * @param {string} label
 * @returns {string}
 */
export function bandRangeLabel(label) {
  const band = SCORE_BANDS[label];
  return band ? `${band.min}–${band.max}` : 'unknown';
}

/**
 * Check whether a numeric score falls within the expected band for a given label.
 * @param {string} label  - one of 'clean' | 'suspicious' | 'malicious'
 * @param {number} score  - integer 0–100
 * @returns {boolean}
 */
export function scoreMatchesBand(label, score) {
  const band = SCORE_BANDS[label];
  if (!band) return false;
  return score >= band.min && score <= band.max;
}

const errors = [];

for (const d of destinations) {
  if (!VALID_LABELS.has(d.label)) {
    errors.push(d.id + ': invalid label "' + d.label + '"');
  }
  if (!d.risk_pattern) {
    errors.push(d.id + ': missing risk_pattern');
  } else if (!VALID_RISK_PATTERNS.has(d.risk_pattern)) {
    errors.push(d.id + ': invalid risk_pattern "' + d.risk_pattern + '"');
  }
  if (!(d.id in scores)) {
    errors.push(d.id + ': missing entry in scores.json');
  }
}

for (const [id, score] of Object.entries(scores)) {
  if (typeof score !== 'number' || !Number.isInteger(score) || score < 0 || score > 100) {
    errors.push(id + ': score ' + score + ' is not an integer in 0–100');
    continue; // skip band check when score itself is invalid
  }
  if (!destinations.some((d) => d.id === id)) {
    errors.push(id + ': present in scores.json but not in destinations.json');
    continue;
  }

  const dest = destinations.find((d) => d.id === id);
  if (dest && VALID_LABELS.has(dest.label)) {
    if (!scoreMatchesBand(dest.label, score)) {
      errors.push(
        `${id}: score ${score} is outside the expected band for label "${dest.label}" ` +
        `(expected ${bandRangeLabel(dest.label)})`
      );
    }
  }
}

// Golden-file assertions
let expectedCounts;
try {
  expectedCounts = JSON.parse(
    readFileSync(`${root}/scripts/__fixtures__/expected-counts.json`, 'utf-8')
  );
} catch (err) {
  errors.push(`expected-counts.json error: ${err.message}`);
}

if (expectedCounts) {
  // Total destination count check
  if (destinations.length < expectedCounts.minTotal) {
    errors.push(
      `Total destination count (${destinations.length}) is below the expected minimum of ${expectedCounts.minTotal}`
    );
  }

  // Count of each label check
  const labelCounts = { clean: 0, suspicious: 0, malicious: 0 };
  for (const d of destinations) {
    if (labelCounts[d.label] !== undefined) {
      labelCounts[d.label]++;
    }
  }

  if (labelCounts.clean < expectedCounts.minClean) {
    errors.push(
      `Clean destination count (${labelCounts.clean}) is below the expected minimum of ${expectedCounts.minClean}`
    );
  }
  if (labelCounts.suspicious < expectedCounts.minSuspicious) {
    errors.push(
      `Suspicious destination count (${labelCounts.suspicious}) is below the expected minimum of ${expectedCounts.minSuspicious}`
    );
  }
  if (labelCounts.malicious < expectedCounts.minMalicious) {
    errors.push(
      `Malicious destination count (${labelCounts.malicious}) is below the expected minimum of ${expectedCounts.minMalicious}`
    );
  }

  // Must-exist original 11 seed fixtures check
  const existingIds = new Set(destinations.map((d) => d.id));
  for (const id of expectedCounts.mustExist) {
    if (!existingIds.has(id)) {
      errors.push(`Required seed fixture ID "${id}" is missing from destinations.json`);
    }
  }
}

if (errors.length > 0) {
  console.error('Fixture validation failed:\n' + errors.map((e) => '  - ' + e).join('\n'));
  process.exit(1);
}

const patternCounts = {};
for (const d of destinations) {
  const p = d.risk_pattern || 'unknown';
  patternCounts[p] = (patternCounts[p] || 0) + 1;
}

console.log('Fixture validation passed: ' + destinations.length + ' destinations, ' + Object.keys(scores).length + ' scores.');
console.log('Risk pattern distribution: ' + JSON.stringify(patternCounts));
