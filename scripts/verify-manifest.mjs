#!/usr/bin/env node
/**
 * verify-manifest.mjs
 *
 * Validates evaluation-manifest.json against the current state of the repo.
 *
 * Checks:
 *   1. Manifest file exists and is valid JSON.
 *   2. Required top-level fields are present and well-typed.
 *   3. fixtureRelease matches package.json version.
 *   4. Every input file listed in manifest.inputs exists on disk and its
 *      SHA-256 matches the recorded hash (altered-input detection).
 *   5. expectedCounts match the actual label distribution in destinations.json.
 *   6. tierThresholds are internally consistent (no gap or overlap).
 *
 * Exit codes:
 *   0 — manifest is valid and all hashes match.
 *   1 — one or more checks failed (details printed to stderr).
 *
 * Usage:
 *   npm run verify-manifest
 */

import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const errors = [];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fail(msg) {
  errors.push(msg);
}

function sha256File(absPath) {
  const buf = readFileSync(absPath);
  return createHash('sha256').update(buf).digest('hex');
}

// ---------------------------------------------------------------------------
// 1. Load manifest
// ---------------------------------------------------------------------------

const manifestPath = resolve(root, 'evaluation-manifest.json');
if (!existsSync(manifestPath)) {
  console.error('FAIL: evaluation-manifest.json not found. Run: npm run generate-manifest');
  process.exit(1);
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
} catch (err) {
  console.error('FAIL: evaluation-manifest.json is not valid JSON: ' + err.message);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 2. Required fields presence and types
// ---------------------------------------------------------------------------

const SEMVER_RE = /^\d+\.\d+\.\d+$/;

const REQUIRED_FIELDS = [
  ['manifestVersion',  'string'],
  ['fixtureRelease',   'string'],
  ['sourceCommit',     'string'],
  ['generatedAt',      'string'],
  ['inputs',           'object'],
  ['mappingVersion',   'string'],
  ['tierThresholds',   'object'],
  ['expectedCounts',   'object'],
  ['evaluatorVersion', 'string'],
  ['resultSchema',     'object'],
];

for (const [field, type] of REQUIRED_FIELDS) {
  if (manifest[field] === undefined) {
    fail(`Missing required field: ${field}`);
  } else if (typeof manifest[field] !== type) {
    fail(`Field "${field}" must be a ${type}, got ${typeof manifest[field]}`);
  }
}

if (manifest.manifestVersion && !SEMVER_RE.test(manifest.manifestVersion)) {
  fail(`manifestVersion "${manifest.manifestVersion}" is not a valid semver string`);
}
if (manifest.fixtureRelease && !SEMVER_RE.test(manifest.fixtureRelease)) {
  fail(`fixtureRelease "${manifest.fixtureRelease}" is not a valid semver string`);
}
if (manifest.mappingVersion && !SEMVER_RE.test(manifest.mappingVersion)) {
  fail(`mappingVersion "${manifest.mappingVersion}" is not a valid semver string`);
}
if (manifest.generatedAt && isNaN(Date.parse(manifest.generatedAt))) {
  fail(`generatedAt "${manifest.generatedAt}" is not a valid ISO-8601 datetime`);
}

// ---------------------------------------------------------------------------
// 3. fixtureRelease matches package.json
// ---------------------------------------------------------------------------

let pkg;
try {
  pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf-8'));
} catch (err) {
  fail('Could not read package.json: ' + err.message);
}

if (pkg && manifest.fixtureRelease !== pkg.version) {
  fail(
    `fixtureRelease "${manifest.fixtureRelease}" does not match package.json version "${pkg.version}". ` +
    'Run: npm run generate-manifest'
  );
}

// ---------------------------------------------------------------------------
// 4. Input file hashes (altered-input detection)
// ---------------------------------------------------------------------------

if (manifest.inputs && typeof manifest.inputs === 'object') {
  for (const [key, entry] of Object.entries(manifest.inputs)) {
    if (typeof entry !== 'object' || !entry.path || !entry.sha256) {
      fail(`inputs.${key}: entry must have "path" and "sha256" fields`);
      continue;
    }

    const absPath = resolve(root, entry.path);

    if (!existsSync(absPath)) {
      fail(`inputs.${key}: file not found at "${entry.path}"`);
      continue;
    }

    let actualHash;
    try {
      actualHash = sha256File(absPath);
    } catch (err) {
      fail(`inputs.${key}: could not hash "${entry.path}": ${err.message}`);
      continue;
    }

    if (actualHash !== entry.sha256) {
      fail(
        `inputs.${key}: hash mismatch for "${entry.path}"\n` +
        `  expected : ${entry.sha256}\n` +
        `  actual   : ${actualHash}\n` +
        '  → file has been modified since the manifest was generated. ' +
        'Run: npm run generate-manifest'
      );
    }
  }
} else {
  fail('manifest.inputs must be a non-null object');
}

// ---------------------------------------------------------------------------
// 5. expectedCounts match actual destinations.json label distribution
// ---------------------------------------------------------------------------

let destinations = [];
try {
  destinations = JSON.parse(
    readFileSync(resolve(root, 'destinations.json'), 'utf-8')
  ).destinations;
} catch (err) {
  fail('Could not read destinations.json: ' + err.message);
}

if (destinations.length > 0 && manifest.expectedCounts) {
  const labelCounts = { clean: 0, suspicious: 0, malicious: 0 };
  for (const d of destinations) {
    if (labelCounts[d.label] !== undefined) labelCounts[d.label]++;
  }

  const ec = manifest.expectedCounts;
  if (ec.total !== destinations.length) {
    fail(
      `expectedCounts.total=${ec.total} but destinations.json has ${destinations.length} entries. ` +
      'Run: npm run generate-manifest'
    );
  }
  for (const label of ['clean', 'suspicious', 'malicious']) {
    if (ec[label] !== labelCounts[label]) {
      fail(
        `expectedCounts.${label}=${ec[label]} but destinations.json has ${labelCounts[label]} ${label} entries. ` +
        'Run: npm run generate-manifest'
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 6. tierThresholds internal consistency
// ---------------------------------------------------------------------------

if (manifest.tierThresholds) {
  const t = manifest.tierThresholds;
  if (
    t.clean && t.suspicious &&
    typeof t.clean.max === 'number' && typeof t.suspicious.min === 'number' &&
    t.suspicious.min !== t.clean.max + 1
  ) {
    fail(
      `tierThresholds gap/overlap: clean.max=${t.clean.max} but suspicious.min=${t.suspicious.min}. ` +
      'Expected suspicious.min === clean.max + 1 for contiguous tiers.'
    );
  }
  if (
    t.suspicious && t.malicious &&
    typeof t.suspicious.max === 'number' && typeof t.malicious.min === 'number' &&
    t.malicious.min !== t.suspicious.max + 1
  ) {
    fail(
      `tierThresholds gap/overlap: suspicious.max=${t.suspicious.max} but malicious.min=${t.malicious.min}. ` +
      'Expected malicious.min === suspicious.max + 1 for contiguous tiers.'
    );
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

if (errors.length > 0) {
  console.error('Manifest verification FAILED:\n' + errors.map((e) => '  ✗ ' + e).join('\n'));
  process.exit(1);
}

console.log('Manifest verification passed.');
console.log('  manifestVersion  : ' + manifest.manifestVersion);
console.log('  fixtureRelease   : ' + manifest.fixtureRelease);
console.log('  sourceCommit     : ' + manifest.sourceCommit);
console.log('  generatedAt      : ' + manifest.generatedAt);
console.log('  mappingVersion   : ' + manifest.mappingVersion);
console.log('  expectedCounts   : ' + JSON.stringify(manifest.expectedCounts));
console.log('  inputs verified  : ' + Object.keys(manifest.inputs).join(', '));
