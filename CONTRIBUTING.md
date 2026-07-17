# Contributing to grydlock-testkit

Thank you for contributing! This file documents the norms for keeping the fixture dataset healthy.

---

## What lives in this repo

- `destinations.json` — labelled testnet addresses and assets (`clean | suspicious | malicious`)
- `scores.json` — deterministic 0–100 stub scores consumed by `StubOracle` in `grydlock-oracle-adapter`
- `transactions/` — unsigned XDR samples for offline decode testing

Because downstream repos (`grydlock-oracle-adapter`, `grydlock-research`) depend on the exact
contents of `destinations.json` and `scores.json`, changes to those files are **consequential** to
consumers in a way that isn't true of most repos' data files.

---

## Changelog requirement

**Any PR that adds, removes, or rescores a fixture must include a corresponding entry in
`CHANGELOG.md` under the `[Unreleased]` section.**

The CI `validate-changelog` job will fail if a PR touches `destinations.json`, `scores.json`, or
`transactions/` but the `[Unreleased]` section of `CHANGELOG.md` is empty (contains only the
HTML comment placeholder).

### Entry format

Use the sub-headings that match what changed:

```markdown
## [Unreleased]

### Added — Destinations
- `<ADDRESS_OR_ASSET_ID>` (account | asset, label: clean | suspicious | malicious) — one-sentence rationale.

### Changed — Scores
- `<ADDRESS_OR_ASSET_ID>`: score `<OLD>` → `<NEW>` — reason for the rescore.

### Removed — Destinations
- `<ADDRESS_OR_ASSET_ID>` (label) — reason for removal.

### Added — Transactions
- `transactions/<filename>.xdr` — what operation type and why it was added.
```

Only include sub-headings that are relevant to your PR. An entry does not need to be exhaustive —
a brief rationale is enough for a downstream consumer to decide whether the change affects them.

### Score-regression guard coordination

The score-regression guard (tracked separately) uses the `[Unreleased]` section as its
"documented exception" signal: a score change that is already explained here will not be flagged
as an unexpected regression. **Do not bypass the changelog requirement to silence a regression
guard alert.** If the score change is intentional, document it here first; the guard will then
accept it on the next run.

---

## PR workflow

1. **Branch** — create a branch from `main`:
   ```bash
   git checkout -b feat/<short-description>
   # e.g. git checkout -b feat/add-drainer-wallet-4
   ```

2. **Edit fixtures** — make your changes to `destinations.json`, `scores.json`, and/or
   `transactions/`.

3. **Validate locally** — run the fixture validator before pushing:
   ```bash
   npm run validate
   ```
   This checks that every destination has a score, every score is in range, and every label is
   valid.

4. **Update CHANGELOG.md** — add an entry under `[Unreleased]` describing what changed and why.

5. **Commit and push**:
   ```bash
   git add destinations.json scores.json CHANGELOG.md  # and any other changed files
   git commit -m "fixtures: <short description>"
   git push -u origin feat/<short-description>
   ```

6. **Open a PR** — use the pull request template that appears automatically. Make sure the
   changelog checkbox is ticked before requesting review.

---

## Fixture labelling guidelines

| Label | Score range | When to use |
|-------|-------------|-------------|
| `clean` | 0–25 | No red flags; normal activity pattern. |
| `suspicious` | 40–70 | One or more indirect risk signals (shared funding source, unusual velocity, trustline to flagged asset). |
| `malicious` | 75–100 | Direct behavioural evidence of fraud, draining, or rug-pull activity. |

Scores within a band are intentionally spread to give the evaluator distinct values to compare
against. Avoid assigning the same score to two different destinations unless they are genuinely
equivalent risk.

---

## Documentation-only PRs

PRs that only touch `README.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, or other non-fixture files
do not need a changelog entry. The `validate-changelog` CI job only triggers when fixture files
are modified.
