import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  VALID_LABELS,
  VALID_RISK_PATTERNS,
  VALID_PROVENANCE_KINDS,
  VALID_DESTINATION_TYPES,
  SCORE_BANDS
} from './lib/taxonomy.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const destinations = JSON.parse(readFileSync(root + '/destinations.json', 'utf-8')).destinations;
const scores = JSON.parse(readFileSync(root + '/scores.json', 'utf-8'));

const VALID_LABEL_SET = new Set(VALID_LABELS);
const VALID_RISK_PATTERN_SET = new Set(VALID_RISK_PATTERNS);
const VALID_FIXTURE_STATUSES = new Set(['synthetic-only']);
const errors = [];

export function validateFixtureStatus(destination) {
  if (!Object.hasOwn(destination, 'fixture_status')) return 'missing fixture_status';
  if (!VALID_FIXTURE_STATUSES.has(destination.fixture_status)) {
    return `invalid fixture_status \"${destination.fixture_status}\"`;
  }
  return null;
}

export function validateDestinationMetadata(d) {
  const problems = [];
  if (!VALID_DESTINATION_TYPES.includes(d.type)) problems.push(`invalid type "${d.type}"`);
  if (typeof d.notes !== 'string' || d.notes.length === 0) problems.push('missing notes');
  if (typeof d.rationale !== 'string' || d.rationale.length < 20) problems.push('missing or too-short rationale');
  const kind = d.provenance?.kind;
  if (!VALID_PROVENANCE_KINDS.includes(kind)) problems.push(`invalid provenance.kind "${kind}"`);
  if (kind === 'testnet') {
    if (!Array.isArray(d.provenance.evidence_txs)) problems.push('testnet provenance needs evidence_txs');
    if (!String(d.provenance.explorer ?? '').startsWith('https://stellar.expert/explorer/testnet/')) {
      problems.push('testnet provenance needs a stellar.expert testnet explorer URL');
    }
  }
  return problems;
}

export function validateScoreBand(d, score) {
  const band = SCORE_BANDS[d.label];
  if (!band || typeof score !== 'number') return null;
  const [lo, hi] = band;
  if (score >= lo && score <= hi) return null;
  if (typeof d.score_rationale === 'string' && d.score_rationale.length >= 20) return null;
  return `score ${score} is outside the ${d.label} band ${lo}-${hi}; add a score_rationale explaining the deliberate deviation`;
}

const seenIds = new Set();
for (const d of destinations) {
  if (seenIds.has(d.id)) errors.push(d.id + ': duplicate id');
  seenIds.add(d.id);
  for (const problem of validateDestinationMetadata(d)) errors.push(d.id + ': ' + problem);
  const bandError = validateScoreBand(d, scores[d.id]);
  if (bandError) errors.push(d.id + ': ' + bandError);
  const fixtureStatusError = validateFixtureStatus(d);
  if (fixtureStatusError) errors.push(d.id + ': ' + fixtureStatusError);
  if (!VALID_LABEL_SET.has(d.label)) {
    errors.push(d.id + ': invalid label "' + d.label + '"');
  }
  if (!d.risk_pattern) {
    errors.push(d.id + ': missing risk_pattern');
  } else if (!VALID_RISK_PATTERN_SET.has(d.risk_pattern)) {
    errors.push(d.id + ': invalid risk_pattern "' + d.risk_pattern + '"');
  }
  if (!(d.id in scores)) {
    errors.push(d.id + ': missing entry in scores.json');
  }
}

for (const [id, score] of Object.entries(scores)) {
  if (typeof score !== 'number' || score < 0 || score > 100) {
    errors.push(id + ': score ' + score + ' out of range 0-100');
  }
  if (!destinations.some((d) => d.id === id)) {
    errors.push(id + ': present in scores.json but not in destinations.json');
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
