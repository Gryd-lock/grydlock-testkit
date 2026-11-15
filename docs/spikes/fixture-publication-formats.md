# Spike: Evaluate Fixture Publication Formats for Downstream Consumers

**Category:** Spike · **Impact:** High · **Cross-repo:** `grydlock-testkit`, `grydlock-oracle-adapter`, `grydlock-extension`, `grydlock-research`

## Question

Should `grydlock-testkit` fixtures be distributed to downstream consumers (`grydlock-oracle-adapter`, `grydlock-extension`, and `grydlock-research`) as Git tags, GitHub Release archives, an npm/GitHub Packages tarball with JSON subpath exports, or a dedicated generated-code data package?

## Recommendation

Adopt a **Dual-Channel Immutable Tarball + ESM/Subpath-Export Package Architecture (Option 2 as primary interface, backed by Option 1 release tarballs + SHA-256 sidecars)**:

1. **Single canonical package (`grydlock-testkit`) with explicit `package.json#exports`:** Keep `index.mjs` + `index.d.ts` (zero runtime dependencies) alongside direct JSON/XDR subpath exports (`grydlock-testkit/destinations.json`, `grydlock-testkit/scores.json`, `grydlock-testkit/transactions/*`, `grydlock-testkit/scenarios/*`) as already wired in `package.json`.
2. **Primary consumer installation channel — Release tarball URL + SHA-256 integrity (`package-lock.json` `integrity` field):** Downstream repositories install the versioned GitHub Release tarball (`https://github.com/Gryd-lock/grydlock-testkit/releases/download/vX.Y.Z/grydlock-testkit-X.Y.Z.tgz`) or `@gryd-lock/grydlock-testkit@X.Y.Z`. Unlike GitHub Packages (which requires a `read:packages` PAT even for public repos in CI), the release `.tgz` URL works unauthenticated in every CI runner and locks a cryptographic `sha512-...` digest inside the consumer's `package-lock.json`.
3. **Eliminate manual JSON vendoring in `grydlock-oracle-adapter`:** Replace manual copy-pasting of `destinations.json` / `scores.json` and generated text modules with a deterministic build/sync script (or direct `import { loadScores, loadDestinations } from 'grydlock-testkit'`) guarded by `.github/workflows/consumer-contract-test.yml`.
4. **Defer standalone generated-module packages until >5,000 fixtures:** At the current corpus scale (73 destinations, 41 XDRs, ~95 KB uncompressed / ~22 KB `.tgz`), raw JSON + ESM loaders load in `< 2 ms` and add minimal bundle weight.

---

## 1. Current State & Pain Points Across Consumers

Today, `grydlock-testkit` is consumed by three sibling repositories with different runtime constraints:

| Consumer repo | Runtime environment | What it reads from `grydlock-testkit` | Current integration pain point |
|---|---|---|---|
| `grydlock-oracle-adapter` | Node.js + TypeScript library / bundler-targeted ESM (`StubOracle`) | `scores.json` and `destinations.json` | Historically vendored raw JSON and hand-synced generated TS modules; manual copies drift whenever `generate:testnet` re-mints personas or updates scores. |
| `grydlock-extension` | Browser extension (MV3 service worker + UI) & Node demo server | `scores.json` (via `StubOracle` in browser) and `transactions/*.xdr` + `transactions/index.json` (in demo server / E2E tests) | MV3 service worker cannot call `node:fs` (`index.mjs`), so browser code needs static JSON/ESM imports (`grydlock-testkit/scores.json`), while the demo server uses filesystem subpath resolution. |
| `grydlock-research` | Node.js CLI / evaluation scripts | `destinations.json`, `scores.json`, `transactions/*.xdr`, `scenarios/*.json`, `dataset/testnet-run.json` | Needs strict version pinning and cryptographic checksum verification so published accuracy/FPR tables can be reproduced byte-for-byte months later. |

---

## 2. Comparison Matrix of Five Publication Formats

We evaluated five candidate distribution formats across the six evaluation criteria defined in Issue #71:

| Criterion | 1. Raw Git Tag / Submodule Clone | 2. Release `.tgz` + Dual ESM/Subpath JSON Package (Recommended) | 3. GitHub Packages / npm Registry Only | 4. Standalone Generated-Code Package (`@gryd-lock/fixtures-esm`) | 5. Content-Addressed Manifest Archive (`.tar.gz` + SHA-256 index) |
|---|---|---|---|---|---|
| **Reproducibility** | ⚠️ Medium — tags can be force-moved unless tag protection is enforced; `npm ci` on a `git+https://` URL runs lifecycle scripts and packs on the fly. | ✅ High — immutable release `.tgz` built once by `.github/workflows/release.yml` with an attached `.tgz.sha256` sidecar and `package-lock.json` `sha512` integrity pin. | ✅ High — registry tarballs are immutable once published. | ✅ High | ✅ Very High — every individual file and the archive itself are addressed by SHA-256. |
| **Verification & Integrity** | ❌ Weak — relies on commit SHA only; no per-artifact checksum file. | ✅ Strong — double verification: npm `integrity` (`sha512`) at install time + `.tgz.sha256` release asset verification in CI. | ✅ Strong — npm registry `shasum` / `integrity`. | ✅ Strong | ✅ Strongest — cryptographic manifest over every fixture file. |
| **Consumer Ergonomics** | ❌ Poor — requires submodule commands or `git` in container images; downloads full repo history/tests. | ✅ Excellent — standard `npm i`, works unauthenticated in CI, supports both `import { loadScores } from 'grydlock-testkit'` (Node) and `import scores from 'grydlock-testkit/scores.json' with { type: 'json' }` (Bundlers/MV3). | ⚠️ Friction on GitHub Packages — GitHub Packages requires `NODE_AUTH_TOKEN` with `read:packages` even for public packages. | ⚠️ Medium — requires a codegen build step before publishing and strips non-JS files unless duplicated. | ❌ Poor — requires custom download/unpack script in every consumer repo instead of `npm ci`. |
| **Breaking-Change Detection** | ❌ Silent — consumer breaks only when someone manually bumps the submodule SHA. | ✅ Automated — `.github/workflows/consumer-contract-test.yml` packs the candidate `.tgz` and runs consumer tests before any tag is cut. | ✅ Automated with contract workflow. | ⚠️ Schema changes in generated TS types can break downstream `tsc` builds. | ❌ Custom loader required. |
| **Bundle & Size Impact** | ❌ Clones entire repo (~600+ KB with tests, scripts, reports). | ✅ Minimal — `package.json#files` ships only the dataset, loaders, and docs (~22 KB compressed `.tgz`, `0` runtime dependencies). | ✅ Minimal (~22 KB `.tgz`). | ✅ Minimal — tree-shakeable ESM exports, though duplicates JSON if raw files are also needed. | ✅ Minimal (~20 KB). |
| **Browser / MV3 Compatibility** | ❌ Poor | ✅ Full — bundlers (Vite/Webpack/esbuild) inline `grydlock-testkit/scores.json` and `destinations.json` directly via `package.json#exports` without importing `node:fs` from `index.mjs`. | ✅ Full | ✅ Full — pure ESM constants (`export const SCORES = ...`) work in every runtime without JSON import assertions. | ❌ Requires build-time fetch/unpack plugin. |
| **Maintenance Cost** | ⚠️ Medium (manual syncs) | ✅ Low — already 90% implemented in `package.json` and `.github/workflows/release.yml`. | ⚠️ Medium (`NPM_TOKEN` / PAT management) | ❌ High — maintaining a separate codegen pipeline and second package repo. | ❌ High — custom downloader tooling. |

---

## 3. Prototypes: Consumer Installation, Browser-Safe Loading & Integrity Verification

We constructed and verified two complementary prototypes against `grydlock-testkit@0.2.0`:

### Prototype A — Zero-Vendor Dual-Runtime Consumer Loader (Node.js + Browser/MV3 Bundler)

Because `index.mjs` imports `node:fs`, importing the package root (`import { loadScores } from 'grydlock-testkit'`) works in Node.js (`grydlock-research` and `grydlock-extension` demo server) but fails inside a browser extension MV3 service worker unless `node:fs` is shimmed.

By leveraging the subpath exports already declared in `package.json#exports` (`./scores.json`, `./destinations.json`, `./transactions/index.json`), `grydlock-oracle-adapter` can eliminate manual file vendoring and load fixtures directly from `node_modules/grydlock-testkit` in both Node and browser bundlers:

```js
// Prototype A1: Browser / MV3 & Bundler-safe static subpath import (grydlock-oracle-adapter)
// Resolves via package.json#exports["./scores.json"] -> "./scores.json" (zero node:fs dependency)
import scores from 'grydlock-testkit/scores.json' with { type: 'json' };
import destinationsDoc from 'grydlock-testkit/destinations.json' with { type: 'json' };
import pkg from 'grydlock-testkit/package.json' with { type: 'json' };

export class StubOracle {
  readonly datasetVersion = pkg.version;
  private readonly scoreById = new Map(Object.entries(scores));
  private readonly idByAddress = new Map(
    destinationsDoc.destinations.map((d) => [d.address, d.id])
  );

  getScoreById(id) {
    return this.scoreById.get(id) ?? null; // null = unscored (distinct from score 0)
  }

  getScoreByAddress(address) {
    const id = this.idByAddress.get(address);
    return id ? this.getScoreById(id) : null;
  }
}
```

```js
// Prototype A2: Node.js / Research / Demo-server loader (uses index.mjs)
import assert from 'node:assert/strict';
import {
  datasetVersion,
  NETWORK_PASSPHRASE,
  loadDestinations,
  loadScores,
  loadTransactions,
  readTransactionXdr
} from 'grydlock-testkit';

const { destinations } = loadDestinations();
const scores = loadScores();
const txIndex = loadTransactions();
const sampleXdr = readTransactionXdr(txIndex.fixtures[0].id);

assert.equal(txIndex.passphrase, NETWORK_PASSPHRASE);
assert.equal(destinations.length, Object.keys(scores).length);
assert.ok(sampleXdr.length > 0);
```

**Measured package footprint (`npm pack --dry-run` on v0.2.0):**
- Packed files: `index.mjs`, `index.d.ts`, `destinations.json`, `scores.json`, `transactions/*.xdr`, `transactions/index.json`, `scenarios/*.json`, `dataset/testnet-run.json`, `docs/LABELS.md`, `docs/FIXTURES.md`, `reports/baseline-*`, `CHANGELOG.md`.
- Excluded from consumer installs: `scripts/`, `tests/`, `.github/`, `docs/spikes/` (kept out of `package.json#files` so downstream `node_modules` stays lean and never pulls in `@stellar/stellar-sdk` devDependencies).

---

### Prototype B — Deterministic Content-Addressed Tarball & Manifest Verification

To give downstream consumers (`grydlock-oracle-adapter` and `grydlock-research`) cryptographic proof that an installed `grydlock-testkit` package matches the exact published release asset and has not been mutated locally:

```js
// Prototype B: Consumer-side integrity verification (can run in consumer pretest)
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { paths, datasetVersion, loadDestinations, loadScores, loadTransactions } from 'grydlock-testkit';

function sha256File(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

export function computeDatasetFingerprint() {
  const files = {
    'destinations.json': sha256File(paths.destinations),
    'scores.json': sha256File(paths.scores),
    'transactions/index.json': sha256File(paths.transactionIndex)
  };
  const composite = createHash('sha256')
    .update(JSON.stringify({ version: datasetVersion, files }))
    .digest('hex');

  return {
    version: datasetVersion,
    destinationsCount: loadDestinations().destinations.length,
    scoresCount: Object.keys(loadScores()).length,
    transactionsCount: loadTransactions().fixtures.length,
    files,
    compositeSha256: composite
  };
}
```

#### Consumer installation & verification workflow

```sh
# 1. Install pinned release tarball (no auth token required in CI or local dev)
npm install --save-exact \
  https://github.com/Gryd-lock/grydlock-testkit/releases/download/v0.2.0/grydlock-testkit-0.2.0.tgz

# 2. Verify release tarball SHA-256 against the GitHub Release .sha256 sidecar
curl -sSfL https://github.com/Gryd-lock/grydlock-testkit/releases/download/v0.2.0/grydlock-testkit-0.2.0.tgz -o /tmp/testkit.tgz
curl -sSfL https://github.com/Gryd-lock/grydlock-testkit/releases/download/v0.2.0/grydlock-testkit-0.2.0.tgz.sha256 -o /tmp/testkit.tgz.sha256
(cd /tmp && sha256sum -c testkit.tgz.sha256)
```

---

## 4. Versioning, Compatibility & Rollback Implications

Because `grydlock-testkit` is a **data + schema package**, standard SemVer (`MAJOR.MINOR.PATCH`) must be mapped explicitly to data and schema changes:

| Change type in `grydlock-testkit` | SemVer bump | Impact on `grydlock-oracle-adapter` | Impact on `grydlock-extension` | Impact on `grydlock-research` |
|---|---|---|---|---|
| **Docs, validator internals, or spike reports** (no fixture/score changes) | `PATCH` (`0.2.x`) | None — identical dataset fingerprint. | None | None |
| **Additive fixtures** (new destinations in `destinations.json` + `scores.json`, new `transactions/*.xdr`, new `scenarios/*.json`) or **testnet regeneration** (`npm run generate:testnet`) | `MINOR` (`0.x.0`) | Safe if lookups are by `id` or dynamic iteration; any test asserting exact total count (`length === 12`) must use `>= 12`. | Safe — new `.xdr` files are discovered via `transactions/index.json`. | Produces a new baseline report (`reports/baseline-fixtures.md`); research papers pin the minor version used. |
| **Rescoring an existing destination across a tier boundary** (`0–20`, `21–50`, `51–75`, `76–100`) or changing an existing fixture's `label` | `MINOR` (during `0.y.z` pre-1.0) / `MAJOR` (from `1.0.0+`) | May alter hardcoded score assertions in adapter unit tests (`consumer-contract-test.yml` catches this pre-release). | May change expected warning tier for a pinned demo fixture ID. | Alters confusion matrix; requires `CHANGELOG.md` entry under `[Unreleased]`. |
| **Breaking schema change** (renaming/removing fields in `destinations.json`, `transactions/index.json`, or removing an exported function/subpath in `package.json#exports`) | `MAJOR` (`X.0.0`) | Requires synchronized consumer PR before bumping dependency. | Requires synchronized consumer PR. | Requires synchronized consumer PR. |

### Rollback procedure

If a published dataset version (`v0.3.0`) introduces an unintended label/score regression discovered after release:
1. **Downstream rollback is a single-line dependency revert:** Because consumers pin the immutable release tarball URL (`.../releases/download/v0.2.0/grydlock-testkit-0.2.0.tgz`) in `package.json` and `package-lock.json`, rolling back in `grydlock-oracle-adapter` or `grydlock-extension` requires only reverting that URL and running `npm ci` — previous GitHub Release tarballs remain permanently addressable.
2. **Forward fix in `grydlock-testkit`:** Never delete or overwrite an existing `vX.Y.Z` tag or release tarball (doing so breaks npm lockfile integrity hashes for anyone who already installed it). Instead, revert or fix the fixture on `main` and cut `v0.3.1`.

---

## 5. Why Rejected Alternatives Were Ruled Out

1. **Tracking `main` via `git+https://github.com/Gryd-lock/grydlock-testkit.git#main`:**
   - *Rejected because:* Breaks build reproducibility immediately whenever a new fixture lands on `main`, clones non-packaged dev files (`scripts/`, `tests/`), and bypasses the `.tgz.sha256` release verification gate.
2. **Git submodules (`vendor/grydlock-testkit`):**
   - *Rejected because:* Submodules complicate CI checkout (`submodules: recursive`), do not integrate with `package.json#exports` module resolution, and encourage relative-path reaches into internal files (`../../vendor/grydlock-testkit/...`) that bypass the public package contract.
3. **Manual copy-pasting of `destinations.json` / `scores.json` into `grydlock-oracle-adapter`:**
   - *Rejected because:* Guarantees silent version drift between the dataset evaluated in `grydlock-testkit` and the dataset bundled into `StubOracle`, and duplicates 73+ destination records across repositories.
4. **Publishing a separate generated-ESM-only package (`@gryd-lock/fixtures-js`) right now:**
   - *Rejected because:* At 73 destinations (~22 KB compressed tarball), JSON subpath exports (`grydlock-testkit/scores.json`) already inline cleanly into Vite/esbuild/tsup browser bundles without a separate build artifact. As documented in the dataset-scaling analysis, a derived packed/gzipped artifact only becomes worthwhile above **~2,500–5,000 entries**.

---

## 6. Migration Plan & Risks

| Step | Action | Owner | Risk & Mitigation |
|---|---|---|---|
| **Step 1** | Keep `release.yml` publishing both the GitHub Release `.tgz` + `.tgz.sha256` asset and the package exports defined in `package.json`. | `grydlock-testkit` | Already active as of `v0.2.0`. |
| **Step 2** | Add a browser-bundler safety check to `tests/` verifying that `package.json#exports` exposes `./destinations.json`, `./scores.json`, and `./transactions/*` without requiring `index.mjs` (`node:fs`). | `grydlock-testkit` | Prevents accidental removal of JSON subpath exports needed by MV3 bundlers. |
| **Step 3** | Migrate `grydlock-oracle-adapter` to depend on the pinned `grydlock-testkit-0.2.0.tgz` release tarball and import `grydlock-testkit/scores.json` + `grydlock-testkit/destinations.json` directly instead of vendoring copied JSON files. | `grydlock-oracle-adapter` | Update `ORACLE_ADAPTER_REF` in `.github/workflows/consumer-contract-test.yml` once the adapter PR merges. |
| **Step 4** | Pin `grydlock-testkit-0.2.0.tgz` in `grydlock-extension` and `grydlock-research` with `npm ci` lockfile integrity verification. | `grydlock-extension`, `grydlock-research` | Eliminates cross-repo fixture skew across all four Gryd Lock repositories. |
