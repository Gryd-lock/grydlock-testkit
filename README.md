# Gryd Lock Testkit

[![Built on Stellar](https://img.shields.io/badge/Built%20on-Stellar-blue?logo=stellar)](https://stellar.org)
[![Testnet](https://img.shields.io/badge/Network-Testnet-orange)](https://developers.stellar.org/docs/networks)
[![CI](https://github.com/Gryd-lock/grydlock-testkit/actions/workflows/ci.yml/badge.svg)](https://github.com/Gryd-lock/grydlock-testkit/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

A labelled **Stellar testnet evaluation dataset** for [Gryd Lock](https://github.com/Gryd-lock), the pre-signing fraud warning layer. It contains destinations and transaction XDRs, each labelled `clean`, `suspicious` or `malicious` with a written rationale. Most were executed on testnet, so their hashes can be checked on [stellar.expert](https://stellar.expert/explorer/testnet). It also ships stub oracle scores and an evaluation runner that reports precision, recall, false-positive rate and latency.

| | |
| --- | --- |
| Destinations | **73** — 12 offline seed + 61 testnet (accounts, issued assets, Soroban asset contracts) |
| Transaction XDRs | **41** — 4 offline seed + 37 executed on testnet |
| Covers | clean & path payments, fee bumps, `setOptions` signer takeover, account-merge drains, scam trustlines, clawback-enabled assets, claimable-balance spam, sponsored mules, memo impersonation, Soroban `transfer` / `approve` to unknown spenders, multi-op bundles, and clean look-alikes of each attack |
| Labels | [docs/LABELS.md](docs/LABELS.md) (taxonomy and rubric) · [docs/FIXTURES.md](docs/FIXTURES.md) (every fixture with its rationale and explorer link) |
| Baseline | [reports/baseline-fixtures.md](reports/baseline-fixtures.md) · [reports/baseline-soroban.md](reports/baseline-soroban.md) |

> **Everything here is synthetic.** Testnet personas are random keypairs funded by Friendbot for this dataset alone. Seed fixtures are random, never-funded addresses. No fixture is, or is derived from, a real person or entity, and no secret key is ever written to disk. Testnet is reset periodically: recorded hashes stop resolving on explorers after a reset, but they remain the reproducible record of the run (see [Regenerating](#regenerating-the-testnet-fixtures)).

## Quick start (3 commands)

```sh
npm ci                                   # Node 22+ (see .nvmrc)
npm run validate && npm test             # decode every XDR, check hashes, labels, scores, scenarios
npm run eval -- --oracle fixtures        # score everything -> reports/latest-fixtures.{json,md}
```

To evaluate a live Soroban risk oracle instead of the stub scores:

```sh
npm run eval -- --oracle soroban:CA42XDMAPI3QXA4XP6HEBPWD3IHZQ3YJB4MABSURASGGOVYU5QCWSC2M
```

The runner scores every destination directly. For each transaction it decodes the XDR, extracts every counterparty (destinations, assets, contracts, Soroban address arguments, new signers, sponsored accounts, fee-bump payers) and takes the riskiest score. It maps scores to tiers with the extension's thresholds. The output is per-tier precision/recall/F1, warning false-positive rate, coverage, a confusion matrix, per-risk-pattern recall, a list of misclassified fixtures, and p50/p95 latency, written as JSON and Markdown. `--out reports/<name>` changes the output path.

`npm run verify:testnet` confirms every recorded hash exists on testnet via Horizon.

## Using it from another repo

The package is `grydlock-testkit` and has no runtime dependencies. Pin a release; never track `main`.

```jsonc
// package.json — any one of:
"grydlock-testkit": "https://github.com/Gryd-lock/grydlock-testkit/releases/download/v0.2.0/grydlock-testkit-0.2.0.tgz",
"grydlock-testkit": "npm:@gryd-lock/grydlock-testkit@0.2.0",   // GitHub Packages (needs a read:packages token)
"grydlock-testkit": "0.2.0"                                     // npmjs, when published there
```

```js
import { loadDestinations, loadScores, loadTransactions, readTransactionXdr, NETWORK_PASSPHRASE } from 'grydlock-testkit';
import { TransactionBuilder } from '@stellar/stellar-sdk';

const tx = TransactionBuilder.fromXDR(readTransactionXdr('mal_account_merge_drain'), NETWORK_PASSPHRASE);
```

Raw files are exported too (`grydlock-testkit/destinations.json`, `grydlock-testkit/transactions/<id>.xdr`, `grydlock-testkit/transactions/index.json`, …), so `require.resolve` lookups keep working. `grydlock-extension`'s demo server uses them this way. `grydlock-oracle-adapter`'s `StubOracle` vendors `scores.json` / `destinations.json`.

Releases are cut by pushing a `vX.Y.Z` tag that matches `package.json`. [`release.yml`](.github/workflows/release.yml) then validates and tests, attaches the tarball and its SHA-256 to a GitHub Release, and publishes to GitHub Packages (plus npmjs if an `NPM_TOKEN` secret is configured). The weekly [consumer contract test](.github/workflows/consumer-contract-test.yml) installs the *packed tarball* into `grydlock-oracle-adapter` (pinned ref, `ORACLE_ADAPTER_REF`) and into a scratch project that resolves files the way the extension does. This catches a consumer-breaking change before it is released.

## Adding a fixture

Testnet fixtures come from code, not hand-written base64:

1. **Persona** (a new destination): add an entry to [`scripts/testnet/personas.mjs`](scripts/testnet/personas.mjs) with `label`, `risk_pattern`, `score`, `notes` and a `rationale` that names the on-chain behaviour justifying the label.
2. **Behaviour** (a new transaction): append a recipe to [`scripts/testnet/recipes.mjs`](scripts/testnet/recipes.mjs):
   ```js
   fixture('mal_example_drain', 'malicious', 'sweep',
     'What the transaction does.',
     'Why signing it earns this label.',
     (c) => c.classic('victim-1', [Operation.payment({ destination: c.pub('sweeper-1'), asset: Asset.native(), amount: '10' })])),
   ```
   Use `c.invoke(...)` for Soroban calls and `c.feeBump(...)` for fee-bump envelopes. Add `setup` / `evidence` recipes for the state your fixture needs and the follow-up that proves its label. The id must match `^[a-z_]+$`.
3. **Generate, validate, document:**
   ```sh
   npm run generate:testnet   # ~15 min; funds personas, executes recipes, rewrites the dataset
   npm run docs               # regenerate docs/FIXTURES.md
   npm run validate && npm test
   npm run eval -- --oracle fixtures --out reports/baseline-fixtures
   ```
4. Add a `CHANGELOG.md` entry under `[Unreleased]` (CI requires it for fixture changes) and follow the labelling rubric in [docs/LABELS.md](docs/LABELS.md) and the reviewer checklist in [CONTRIBUTING.md](CONTRIBUTING.md).

A run generates fresh personas, so regenerating changes every testnet address and hash. Treat it as a new dataset version (minor bump). Seed fixtures (`provenance.kind: "offline-synthetic"`) are never touched by the generator.

### Regenerating the testnet fixtures

`npm run generate:testnet` writes `destinations.json`, `scores.json`, `transactions/*.xdr`, `transactions/index.json` and `dataset/testnet-run.json`, the full audit trail of every setup, fixture and evidence transaction. Each stored XDR is the *unsigned* envelope of a submitted transaction. A Stellar transaction hash does not cover signatures, so the hash equals the on-chain hash. (Fee bumps keep the inner signature, because the outer hash covers it.) If a run fails after the on-chain phase, `npm run generate:testnet -- --from-checkpoint dataset/.checkpoint.json` rebuilds the outputs without touching the network.

## Repository layout

```
destinations.json            labelled destinations (accounts, assets, contracts)
scores.json                  stub oracle scores (simulated oracle; see docs/LABELS.md)
transactions/                <id>.xdr envelopes + index.json (labels, hashes, provenance, expected counterparties)
scenarios/                   ordered multi-transaction attack bundles (scenarios/README.md)
dataset/testnet-run.json     audit trail of the testnet generation run
reports/                     committed baseline evaluation reports
docs/                        LABELS.md, FIXTURES.md (generated), spikes
scripts/testnet/             generator: personas.mjs, recipes.mjs, generate.mjs
scripts/eval.mjs             evaluation runner
scripts/validate-*.mjs       fixture, transaction and scenario validators
index.mjs, index.d.ts        package entry point
```

Other commands: `npm run validate:scenarios`, `npm run replay -- scenarios/phishing-drain.json` (deterministic offline scenario replay; see [scenarios/README.md](scenarios/README.md)).

## Gryd Lock organization

| Repo | Role |
| --- | --- |
| grydlock-extension | Browser extension that warns before signing risky Stellar transactions |
| grydlock-oracle-adapter | Fetches on-chain risk scores via Soroban; `StubOracle` reads `scores.json` from this repo |
| grydlock-research | Design study, threat model, and evaluation methodology |
| grydlock-testkit (this repo) | Labelled testnet dataset, stub scores and evaluation runner |

## License

MIT
