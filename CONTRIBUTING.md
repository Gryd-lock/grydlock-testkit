# Contributing to grydlock-testkit

Thank you for contributing! This file documents the labelling rubric, required fields for fixture PRs, the reviewer checklist, and how to run everything locally — so you can add a correctly-labelled fixture without needing to reverse-engineer the existing entries.

**Important**: All addresses in this repo are **synthetic testnet data** — randomly generated addresses that have never been funded on any network and are not attributable to any real person or entity. Never commit real user data here.

---

## What lives in this repo

- `destinations.json` — labelled testnet addresses and assets (`clean | suspicious | malicious`)
- `scores.json` — deterministic 0–100 stub scores consumed by `StubOracle` in `grydlock-oracle-adapter`
- `transactions/` — unsigned XDR samples for offline decode testing

Because downstream repos (`grydlock-oracle-adapter`, `grydlock-research`) depend on the exact
contents of `destinations.json` and `scores.json`, changes to those files are **consequential** to
consumers in a way that isn't true of most repos' data files.

---

## Fixture labelling rubric

Every destination in `destinations.json` receives one of three labels. The exact criteria below are
generalized from the 11 existing entries — use them as your guide, not as a checklist to tick.

### `clean` — Score range: 0–25

A destination with **no red flags**. The account or asset shows normal activity patterns.

**Examples from existing fixtures:**

| Pattern | Real example | Notes field |
|---------|-------------|-------------|
| Established wallet, regular payment history | `GCRRYBV5IY7...` | "Established testnet wallet with regular payment history; no red flags." |
| Long-lived, low velocity, no shared funding source | `GA4HFFSHZ7...` | "Long-lived wallet, low transaction velocity, no shared funding source with flagged accounts." |
| Holds a standard trustline, normal trading | `GCER76PMM...` | "Holds a USDC trustline against usdc_issuer below; normal trading activity." |
| Known long-lived asset issuer | `GBWPMNXNR...` | "Fixture stand-in for a well-known, long-lived asset issuer (issues USDC below)." |

**When to use `clean`:** The destination has no association — direct or indirect — with any known fraud pattern. Transactions are ordinary (payments, trustlines to established assets, standard trading).

### `suspicious` — Score range: 40–70

One or more **indirect risk signals**. No direct evidence of fraud, but the pattern is unusual enough
to warrant attention.

**Examples from existing fixtures:**

| Pattern | Real example | Notes field |
|---------|-------------|-------------|
| **Pass-through wallet** — funded moments before a burst of outgoing payments | `GCRNKXJJLZ...` | "Funded seconds before a large outgoing payment burst; pattern consistent with a pass-through wallet." |
| **Shared funding source** — shares a funder with known malicious addresses | `GDL4JRQOH...` | "Shares a funding source with malicious_wallet_1 and malicious_wallet_2 below." |
| **Trustline to flagged/scam asset** — holds a trustline to a known malicious asset with no other activity | `GCHYSQ57SV...` | "Holds a trustline to the SCAM asset listed below; no other activity." |

**When to use `suspicious`:** The destination exhibits at least one of: (a) funded just before activity then goes quiet (pass-through shape), (b) shares a funding source with a known malicious address, (c) holds a trustline to a flagged/scam asset with minimal other activity, (d) unusual transaction velocity for the account age.

### `malicious` — Score range: 75–100

Direct behavioural evidence of fraud, draining, or rug-pull activity.

**Examples from existing fixtures:**

| Pattern | Real example | Notes field |
|---------|-------------|-------------|
| **Sweep wallet** — drains newly funded wallets within seconds via path payments | `GD7XPB2A7...` | "Path-payment sweep pattern: drains newly funded wallets within seconds of receiving deposits." |
| **Phishing drainer** — small test payments precede a large drain | `GCAMGLMB5...` | "Repeated small 'test' payments precede a large drain; matches a known phishing-drainer shape." |
| **Rug-pull collector** — receives change-trust + max-sell patterns from multiple sources | `GDQPZVGOJ...` | "Destination of multiple change-trust + immediate max-sell patterns typical of rug-pull collection wallets." |
| **Scam asset issuer** — issues a token with no real distribution | `GAJLLIIPH...` / `SCAM:GAJLLIIPH...` | "Issuer of the SCAM asset below; no distributed supply outside the issuer's own control." / "Newly issued token with no liquidity outside the issuer; classic rug-pull setup." |

**When to use `malicious`:** The destination shows at least one of: (a) automated sweep/drain behaviour (funds arrive and leave programmatically), (b) test-payment-then-drain pattern (phishing shape), (c) collects proceeds from rug-pull operations, (d) issues tokens with no real distribution or liquidity (rug-pull setup).

### Scoring notes

Scores within a band are intentionally spread to give the evaluator distinct values to compare
against. Avoid assigning the same score to two different destinations unless they are genuinely
equivalent risk.

---

## Required fields for a new fixture PR

Every new entry in `destinations.json` must include:

| Field | Required | Description |
|-------|----------|-------------|
| `id` | ✅ | Unique identifier — either the Stellar public key (G…) for accounts, or `ASSET_CODE:ISSUER_KEY` for assets |
| `type` | ✅ | `"account"` or `"asset"` |
| `address` | ✅ (accounts) | The Stellar public key (G…) |
| `asset_code` | ✅ (assets) | The asset code |
| `asset_issuer` | ✅ (assets) | The issuing account's public key |
| `label` | ✅ | One of `clean`, `suspicious`, `malicious` |
| `notes` | ✅ | A one-sentence rationale explaining *why* this label was chosen, referencing the specific pattern. This is what downstream reviewers and evaluators read to verify the label is defensible. |

Every new entry must have a matching entry in `scores.json` with an integer score in 0–100.

---

## How to run everything locally

```bash
npm install
npm run validate
```

`npm run validate` checks:
- Every destination has a matching entry in `scores.json`
- Every score is an integer in 0–100
- Every label is one of `clean`, `suspicious`, or `malicious`
- No extra entries in `scores.json` without a matching destination

---

## Reviewer checklist

Before approving a fixture PR, verify each of the following:

1. **`npm run validate` passes** — run it locally on the branch.
2. **The label is defensible from the notes** — reading the `notes` field alone, a third party should agree with the label without needing additional context. If the notes say "no red flags" but the label is `malicious`, that's a fail.
3. **The score is consistent with the band** — `clean` = 0–25, `suspicious` = 40–70, `malicious` = 75–100. No gaps in those ranges are intentional (30–39 and 71–74 are unused).
4. **Scores vary within a band** — if two destinations have identical risk profiles, give them different scores within the band so the evaluator can distinguish them.
5. **New XDR fixtures are generated via script, not hand-edited** — if a PR adds a new operation type to `transactions/`, the XDR must come from the generation script (or the PR author must explain why a hand-edited XDR is necessary).
6. **Changelog is updated** — any PR touching `destinations.json`, `scores.json`, or `transactions/` must have a corresponding entry under `[Unreleased]` in `CHANGELOG.md`.

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
   `transactions/`. Follow the labelling rubric above.

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

## Documentation-only PRs

PRs that only touch `README.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, or other non-fixture files
do not need a changelog entry. The `validate-changelog` CI job only triggers when fixture files
are modified.
