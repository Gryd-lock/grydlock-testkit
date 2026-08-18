#!/usr/bin/env node
/**
 * generate-manifest.mjs
 *
 * Computes SHA-256 hashes for all input files and writes evaluation-manifest.json.
 *
 * Usage:
 *   npm run generate-manifest
 *
 * The generated manifest is committed to the repository. It must be regenerated
 * (and the updated file committed) whenever any input file changes.
 *
 * Versioning rules:
 *   manifestVersion  — bump the major when the manifest schema changes shape.
 *   fixtureRelease   — mirrors package.json "version"; bump with dataset releases.
 *   mappingVersion   — bump whenever tier threshold boundaries change.
 *   evaluatorVersion — semver range; tighten when evaluation methodology requires it.
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Compute the SHA-256 hex digest of a file on disk. */
function sha256File(relPath) {
  const abs = resolve(root, relPath);
  const buf = readFileSync(abs);
  return createHash('sha256').update(buf).digest('hex');
}

/** Resolve a value from the current manifest if it exists, else return the fallback. */
function preserve(current, key, fallback) {
  return current?.[key] ?? fallback;
}

// ---------------------------------------------------------------------------
// Read current state
// ---------------------------------------------------------------------------

const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf-8'));

let currentManifest = null;
const manifestPath = resolve(root, 'evaluation-manifest.json');
try {
  currentManifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
} catch {
  // No existing manifest — first generation.
}

// Determine git HEAD commit (falls back gracefully outside a git repo).
let sourceCommit = 'unknown';
try {
  sourceCommit = execSync('git rev-parse HEAD', { cwd: root }).toString().trim();
} catch {
  // Running outside a git checkout (e.g. downloaded zip).
}

// ---------------------------------------------------------------------------
// Input files
// ---------------------------------------------------------------------------

const INPUT_FILES = [
  { key: 'destinations',             path: 'destinations.json' },
  { key: 'scores',                   path: 'scores.json' },
  { key: 'transaction_payment',      path: 'transactions/payment.xdr' },
  { key: 'transaction_path_payment', path: 'transactions/path_payment.xdr' },
  { key: 'transaction_change_trust', path: 'transactions/change_trust.xdr' },
  { key: 'transaction_fee_bump',     path: 'transactions/fee_bump_payment.xdr' },
  { key: 'transaction_index',        path: 'transactions/index.json' },
];

const inputs = {};
for (const { key, path } of INPUT_FILES) {
  inputs[key] = { path, sha256: sha256File(path) };
}

// ---------------------------------------------------------------------------
// Derive expected counts from the current destinations.json
// ---------------------------------------------------------------------------

const destinations = JSON.parse(
  readFileSync(resolve(root, 'destinations.json'), 'utf-8')
).destinations;

const labelCounts = { clean: 0, suspicious: 0, malicious: 0 };
for (const d of destinations) {
  if (labelCounts[d.label] !== undefined) labelCounts[d.label]++;
}

const expectedCounts = {
  total:      destinations.length,
  clean:      labelCounts.clean,
  suspicious: labelCounts.suspicious,
  malicious:  labelCounts.malicious,
};

// ---------------------------------------------------------------------------
// Assemble manifest
// ---------------------------------------------------------------------------

// Preserve version fields that require human decision when changed.
// New fields use sensible defaults that match the initial release baseline.
const manifest = {
  _comment:
    'Provenance manifest for the grydlock-testkit evaluation dataset. ' +
    'Regenerate with: npm run generate-manifest. Verify with: npm run verify-manifest.',

  manifestVersion:  preserve(currentManifest, 'manifestVersion',  '1.0.0'),
  fixtureRelease:   pkg.version,
  sourceCommit,
  generatedAt:      new Date().toISOString(),

  inputs,

  // mappingVersion tracks tier threshold changes independently of the fixture release.
  mappingVersion:   preserve(currentManifest, 'mappingVersion', '1.0.0'),
  tierThresholds:   preserve(currentManifest, 'tierThresholds', {
    clean:      { max: 29 },
    suspicious: { min: 30, max: 69 },
    malicious:  { min: 70 },
  }),

  expectedCounts,

  // Minimum grydlock-research version required to evaluate this dataset.
  evaluatorVersion: preserve(currentManifest, 'evaluatorVersion', '>=0.1.0'),

  resultSchema: { $ref: 'EVALUATION_RESULT_SCHEMA.json' },
};

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');

console.log('evaluation-manifest.json written.');
console.log('  fixtureRelease : ' + manifest.fixtureRelease);
console.log('  sourceCommit   : ' + manifest.sourceCommit);
console.log('  generatedAt    : ' + manifest.generatedAt);
console.log('  expectedCounts : ' + JSON.stringify(manifest.expectedCounts));
console.log('  inputs hashed  : ' + Object.keys(inputs).join(', '));
