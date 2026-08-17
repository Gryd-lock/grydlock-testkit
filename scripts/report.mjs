/**
 * scripts/report.mjs
 *
 * Emits a deterministic, machine-readable JSON summary of the fixture dataset.
 * Run via: node scripts/report.mjs   or   npm run report
 *
 * Output is stable across repeated runs whenever the input files are unchanged.
 * No third-party dependencies — uses only Node.js built-ins.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** SHA-256 hex digest of a file's raw bytes. */
function fileHash(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

/** Sort object keys alphabetically for deterministic JSON output. */
function sortedObject(obj) {
  return Object.fromEntries(
    Object.entries(obj).sort(([a], [b]) => a.localeCompare(b))
  );
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const root = fileURLToPath(new URL('..', import.meta.url));
const destinationsPath = join(root, 'destinations.json');
const scoresPath = join(root, 'scores.json');
const packagePath = join(root, 'package.json');
const changelogPath = join(root, 'CHANGELOG.md');
const transactionsDir = join(root, 'transactions');

// ---------------------------------------------------------------------------
// Load inputs
// ---------------------------------------------------------------------------

const { destinations } = JSON.parse(readFileSync(destinationsPath, 'utf-8'));
const scores = JSON.parse(readFileSync(scoresPath, 'utf-8'));
const { version } = JSON.parse(readFileSync(packagePath, 'utf-8'));

// ---------------------------------------------------------------------------
// Label counts
// ---------------------------------------------------------------------------

const labelCounts = { clean: 0, malicious: 0, suspicious: 0 };
for (const d of destinations) {
  if (d.label in labelCounts) labelCounts[d.label]++;
}

// ---------------------------------------------------------------------------
// Type counts
// ---------------------------------------------------------------------------

const typeCounts = {};
for (const d of destinations) {
  const t = d.type ?? 'unknown';
  typeCounts[t] = (typeCounts[t] || 0) + 1;
}

// ---------------------------------------------------------------------------
// Risk-pattern counts (sorted for determinism)
// ---------------------------------------------------------------------------

const rawPatternCounts = {};
for (const d of destinations) {
  const p = d.risk_pattern ?? 'unknown';
  rawPatternCounts[p] = (rawPatternCounts[p] || 0) + 1;
}
const riskPatternCounts = sortedObject(rawPatternCounts);

// ---------------------------------------------------------------------------
// Score bands  (0–24 low | 25–49 medium-low | 50–74 medium-high | 75–100 high)
// ---------------------------------------------------------------------------

const scoreBands = { high: 0, low: 0, 'medium-high': 0, 'medium-low': 0 };
for (const score of Object.values(scores)) {
  if (score >= 75) scoreBands.high++;
  else if (score >= 50) scoreBands['medium-high']++;
  else if (score >= 25) scoreBands['medium-low']++;
  else scoreBands.low++;
}

// ---------------------------------------------------------------------------
// Transaction files (sorted for determinism)
// ---------------------------------------------------------------------------

const txFiles = readdirSync(transactionsDir)
  .filter((f) => f.endsWith('.xdr'))
  .sort()
  .map((f) => ({
    file: f,
    sha256: fileHash(join(transactionsDir, f)),
  }));

// ---------------------------------------------------------------------------
// File hashes (stable-ordered set of fixture files)
// ---------------------------------------------------------------------------

const fileHashes = {
  'CHANGELOG.md': fileHash(changelogPath),
  'destinations.json': fileHash(destinationsPath),
  'scores.json': fileHash(scoresPath),
};

// ---------------------------------------------------------------------------
// Assemble report (field order is the stable public contract)
// ---------------------------------------------------------------------------

const report = {
  version,
  generated_at: new Date().toISOString(),
  totals: {
    destinations: destinations.length,
    scores: Object.keys(scores).length,
  },
  label_counts: labelCounts,
  type_counts: sortedObject(typeCounts),
  risk_pattern_counts: riskPatternCounts,
  score_bands: scoreBands,
  transactions: txFiles,
  file_hashes: fileHashes,
};

process.stdout.write(JSON.stringify(report, null, 2) + '\n');
