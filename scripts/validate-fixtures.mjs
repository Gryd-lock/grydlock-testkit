import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { VALID_LABELS, VALID_RISK_PATTERNS } from './lib/taxonomy.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const destinations = JSON.parse(readFileSync(root + '/destinations.json', 'utf-8')).destinations;
const scores = JSON.parse(readFileSync(root + '/scores.json', 'utf-8'));

const VALID_LABEL_SET = new Set(VALID_LABELS);
const VALID_RISK_PATTERN_SET = new Set(VALID_RISK_PATTERNS);
const errors = [];

for (const d of destinations) {
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

// ---------------------------------------------------------------------------
// Manifest cross-check
// Verify that evaluation-manifest.json exists and its expectedCounts agree
// with the destinations we just validated. Full hash verification is done by
// scripts/verify-manifest.mjs; here we only check the counts to keep the
// validate step fast and free of I/O on every binary fixture.
// ---------------------------------------------------------------------------

const manifestPath = `${root}/evaluation-manifest.json`;
if (!existsSync(manifestPath)) {
  errors.push(
    'evaluation-manifest.json is missing. Run: npm run generate-manifest'
  );
} else {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  } catch (err) {
    errors.push(`evaluation-manifest.json is not valid JSON: ${err.message}`);
    manifest = null;
  }

  if (manifest) {
    // fixtureRelease must match package.json version.
    let pkgVersion;
    try {
      pkgVersion = JSON.parse(readFileSync(`${root}/package.json`, 'utf-8')).version;
    } catch {
      /* ignore — package.json absence is caught elsewhere */
    }
    if (pkgVersion && manifest.fixtureRelease !== pkgVersion) {
      errors.push(
        `evaluation-manifest.json fixtureRelease="${manifest.fixtureRelease}" ` +
        `does not match package.json version="${pkgVersion}". ` +
        'Run: npm run generate-manifest'
      );
    }

    // expectedCounts must agree with the current label distribution.
    if (manifest.expectedCounts) {
      const ec = manifest.expectedCounts;
      const labelCounts = { clean: 0, suspicious: 0, malicious: 0 };
      for (const d of destinations) {
        if (labelCounts[d.label] !== undefined) labelCounts[d.label]++;
      }

      if (typeof ec.total === 'number' && ec.total !== destinations.length) {
        errors.push(
          `evaluation-manifest.json expectedCounts.total=${ec.total} but ` +
          `destinations.json has ${destinations.length} entries. ` +
          'Run: npm run generate-manifest'
        );
      }
      for (const label of ['clean', 'suspicious', 'malicious']) {
        if (typeof ec[label] === 'number' && ec[label] !== labelCounts[label]) {
          errors.push(
            `evaluation-manifest.json expectedCounts.${label}=${ec[label]} but ` +
            `destinations.json has ${labelCounts[label]} ${label} entries. ` +
            'Run: npm run generate-manifest'
          );
        }
      }
    } else {
      errors.push('evaluation-manifest.json is missing expectedCounts field.');
    }

    // Verify SHA-256 hashes for the two JSON fixture files (fast, text-only).
    // XDR binary files are covered by verify-manifest (run separately in CI).
    const HASH_TARGETS = [
      { key: 'destinations', path: 'destinations.json' },
      { key: 'scores',       path: 'scores.json' },
    ];
    for (const { key, path } of HASH_TARGETS) {
      const entry = manifest.inputs?.[key];
      if (!entry) {
        errors.push(`evaluation-manifest.json missing inputs.${key}`);
        continue;
      }
      try {
        const actual = createHash('sha256')
          .update(readFileSync(`${root}/${path}`))
          .digest('hex');
        if (actual !== entry.sha256) {
          errors.push(
            `inputs.${key} hash mismatch for "${path}" — file changed since manifest was generated. ` +
            'Run: npm run generate-manifest'
          );
        }
      } catch (err) {
        errors.push(`Could not hash "${path}": ${err.message}`);
      }
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
