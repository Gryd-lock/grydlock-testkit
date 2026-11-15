# Spike: Defensible Synthetic-Label and Score-Governance Process

**Category:** Spike · **Impact:** High · **Cross-repo:** `grydlock-testkit`, `grydlock-research`, `grydlock-oracle-adapter`, `grydlock-extension`

## Question

What evidence and review process should determine ground-truth labels (`clean`, `suspicious`, `malicious`) and static stub scores (`0–100`) in `grydlock-testkit` while preserving a deterministic, 100% synthetic evaluation dataset?

## Recommendation

Adopt **Model B (Dual-Track Evidence-Backed Governance with Separate Label and Score Tracks)** enforced by automated schema/band validation (`scripts/validate-fixtures.mjs`) and immutable testnet provenance (`dataset/testnet-run.json`):

1. **Strict separation of concerns:** Ground-truth **labels** record *what the persona or transaction actually does in the scenario* (constructive intent + on-chain evidence), whereas **stub scores** (`scores.json`) model *what a realistic reputation oracle knows at signing time*, including documented blind spots (`score_rationale`). A label change and a score change must never be conflated.
2. **Constructive evidence requirement for labels:** Every testnet destination and transaction label must be backed by executable recipe code in `scripts/testnet/personas.mjs` and `scripts/testnet/recipes.mjs`, with setup/evidence transactions recorded in `dataset/testnet-run.json`.
3. **Adversarial-clean pairing rule:** Any new high-signal attack pattern (`signer-takeover`, `account-merge-drain`, `soroban-approval-drain`, `sweep`) must be paired with at least one structurally similar `clean` (`adversarial-clean`) control fixture so `grydlock-research` can measure false-positive rate alongside recall.
4. **Calibrated band governance for stub scores:** In-band scores (`clean`: `0–25`, `suspicious`: `40–70`, `malicious`: `75–100`) follow deterministic intra-band placement rules; any out-of-band score (or score in the `26–39` / `71–74` buffer gaps) is rejected by CI unless accompanied by a written `score_rationale` naming the specific oracle blind spot being modelled.

---

## 1. Current Assignment Paths (Baseline Inventory)

Today, labels and scores enter `grydlock-testkit` through two distinct paths:

### 1a. Legacy v0.1.0 offline-synthetic seeds (12 destinations, 4 transactions)

| Artifact | Assignment mechanism | Verification today |
|---|---|---|
| `destinations.json` (`provenance.kind: "offline-synthetic"`) | Hand-authored JSON entries with `id`, `type`, `address`, `label`, `risk_pattern`, `notes`, `rationale`, and `fixture_status: "synthetic-only"`. | Checked by `scripts/validate-fixtures.mjs` for valid Stellar strkey/asset/contract format, valid taxonomy values, and `score_rationale` presence when out of band. |
| `transactions/*.xdr` (`payment`, `path_payment`, `change_trust`, `fee_bump_payment`) | Pre-encoded unsigned base64 envelopes indexed in `transactions/index.json`. | Checked by `scripts/validate-transactions.mjs` for XDR decode, TESTNET hash match, and counterparty extraction (`extractCounterparties`). |
| `scores.json` | Static integer mapping (`0–100`) per destination ID. | Checked for 1-to-1 key parity with `destinations.json` and band alignment (`validateScoreBand`). |

### 1b. v0.2.0+ programmatic testnet recipes (61 destinations, 37 transactions)

| Stage | Source of truth | Output artifact |
|---|---|---|
| 1. Persona definition | `scripts/testnet/personas.mjs` declares each synthetic role (`label`, `risk_pattern`, `score`, `score_rationale`, `notes`, `rationale`). | Materialized into `destinations.json` and `scores.json` during generation. |
| 2. Behaviour & evidence execution | `scripts/testnet/recipes.mjs` defines `setup`, `fixture`, and `evidence` transactions submitted to Stellar Testnet by `scripts/testnet/generate.mjs`. | Unsigned envelopes written to `transactions/<id>.xdr`; metadata written to `transactions/index.json`; full ledger/hash audit trail saved in `dataset/testnet-run.json`. |
| 3. Automated validation & baseline report | `npm run validate`, `npm test`, and `npm run eval -- --oracle fixtures`. | Regenerates `docs/FIXTURES.md` and `reports/baseline-fixtures.{json,md}`. |

### Gaps in the current process

1. **No formal separation between label disputes and score recalibration:** A contributor wanting to test how `grydlock-extension` handles an oracle false negative might be tempted to flip a destination's `label` instead of adjusting `scores.json` + `score_rationale`.
2. **Subjective intra-band score placement:** While `validateScoreBand` enforces `0–25`, `40–70`, and `75–100`, there is no rubric explaining why a given malicious persona gets `78` vs `95`, or how boundary fixtures (`20`, `51`, `75`) should be distributed relative to `scripts/lib/tiers.mjs` (`0–20` low, `21–50` elevated, `51–75` high, `76–100` critical).
3. **No explicit checklist for reviewer agreement or dataset balance:** Without a formal review gate, new PRs can skew the dataset toward easy-to-detect `malicious` sweeps while starving `adversarial-clean` and `suspicious` edge cases.

---

## 2. Comparison of Governance Models

We evaluated two candidate governance models against the six criteria from Issue #73:

| Criterion | Model A: Single-Maintainer Rubric + CI Schema Gate | Model B: Dual-Track Evidence-Backed Governance (Recommended) |
|---|---|---|
| **Core mechanism** | Any PR that passes `npm run validate` and has a 1-sentence `rationale` can be merged by one maintainer; labels and scores are reviewed together as one diff. | Separates **Track 1 (Ground-Truth Label Governance)** from **Track 2 (Oracle Score Calibration)**; requires constructive recipe evidence for labels, explicit blind-spot budgets for scores, and a structured two-part review checklist. |
| **Auditability** | ⚠️ Medium — `rationale` prose can drift from what the transaction or setup recipe actually executed on-chain. | ✅ High — every label cites specific setup/evidence steps in `dataset/testnet-run.json` and extracted `counterparties`. |
| **Reproducibility** | ✅ High — deterministic JSON + XDR files. | ✅ High — deterministic JSON + XDR files plus reproducible intra-band score anchors. |
| **False-positive usefulness** | ❌ Low — nothing prevents contributors from adding only obvious attacks without `adversarial-clean` controls. | ✅ High — enforces paired `adversarial-clean` controls and caps deliberate out-of-band oracle blind spots so precision/FPR metrics remain interpretable. |
| **Reviewer effort** | ✅ Low (~2 min/PR) | ✅ Moderate (~5 min/PR using the deterministic checklist in §5) |
| **Privacy & synthetic safety** | ✅ High — `scripts/check-secrets.mjs` + `fixture_status: "synthetic-only"`. | ✅ High — adds explicit check that no real-world project ticker/domain (only `.invalid` domains and synthetic codes) is used. |
| **Dataset balance** | ❌ Unbounded — corpus can drift toward 80%+ malicious fixtures. | ✅ Enforced — maintains target tier distribution and deliberate blind-spot quotas. |

---

## 3. Separate Governance Rules: Ground-Truth Labels vs. Stub Scores

### Track 1: Ground-Truth Label Governance (`destinations.json`, `transactions/index.json`)

A **label** (`clean`, `suspicious`, `malicious`) is an immutable statement about **constructive ground truth** within the synthetic world of the testkit.

#### Required evidence for assigning or changing a destination label

| Label | Required constructive evidence in `recipes.mjs` / `dataset/testnet-run.json` | Disallowed justification |
|---|---|---|
| `clean` | Persona participates only in benign flows (standard payments, legitimate DEX liquidity, self-merges, bounded approvals to a known dApp, or `adversarial-clean` look-alikes) with zero theft or laundering hops. | "Its stub score is under 25." |
| `suspicious` | Persona exhibits a documented structural risk signal without direct theft in the fixture itself: forwarding funds within the same run to a sweeper (`pass-through`), issuing an `AUTH_CLAWBACK_ENABLED` asset (`clawback-enabled`), sending dust with a phishing memo (`memo-impersonation`), or being reserve-sponsored by an attacker (`sponsored-mule`). | "We want the extension to show a yellow warning." |
| `malicious` | On-chain recipe demonstrates theft, unauthorized control acquisition, or illicit proceeds collection: draining via `accountMerge` or `setOptions` signer takeover, sweeping stolen balances (`sweep`), executing `transfer_from` on an unlimited approval (`soroban-approval-drain`), or dumping an issuer-retained rug token (`rug-pull`). | "The address has a high score in `scores.json`." |

#### Required evidence for assigning or changing a transaction label

1. **Worst-operation dominance:** A multi-operation transaction's label must equal the highest-severity operation in its envelope (e.g. a benign `changeTrust` bundled with a malicious `setOptions` signer addition is `malicious`).
2. **Value-at-risk vs. exposure boundary:** Operations that establish exposure without transferring value or signing authority (`changeTrust` to a scam asset, claiming a spam claimable balance) are `suspicious`; operations that transfer value, drain balances, grant signer weight, or approve token spending to an attacker are `malicious`.
3. **Counterparty parity:** `transactions/index.json#counterparties` must exactly match the deterministic output of `extractCounterparties(xdr, NETWORK_PASSPHRASE)` in `scripts/lib/stellar.mjs`.

---

### Track 2: Stub Score Calibration Governance (`scores.json`, `score_rationale`)

A **stub score** (`0–100`) is **not** a ground-truth label; it is a deterministic fixture input for `StubOracle` (`grydlock-oracle-adapter`) and `npm run eval -- --oracle fixtures` that simulates what an on-chain reputation oracle returns at signing time.

#### Intra-band calibration rubric (in-band scores)

To prevent arbitrary number picking within each band (`scripts/validate-fixtures.mjs`), scores should be anchored to the extension's tier thresholds (`scripts/lib/tiers.mjs`: `0–20` low, `21–50` elevated, `51–75` high, `76–100` critical):

| Ground-truth label | Permitted validator band | Sub-band anchor | Target score range | Meaning in evaluation |
|---|---|---|---|---|
| `clean` | `0–25` | Established clean (`0–15`) | `0–15` | Routine low-risk account/asset; maps to `low` (`0–20`). |
| `clean` | `0–25` | Boundary clean (`18–20`) | `18–20` | Probes off-by-one threshold logic right below `elevated` (`21`). |
| `clean` | `0–25` | Mildly noisy clean (`21–25`) | `21–25` | Inside validator's `clean` band (`<=25`), but crosses extension's `elevated` threshold (`>=21`) to test low-severity false-positive sensitivity. |
| `suspicious` | `40–70` | Elevated risk (`40–50`) | `40–50` | Maps to `elevated` tier (`21–50`); appropriate for `clawback-enabled` or unconfirmed `memo-impersonation`. |
| `suspicious` | `40–70` | High risk (`51–70`) | `51–70` | Maps to `high` tier (`51–75`); appropriate for active `pass-through` hops, `scam-trustline`, and `sponsored-mule`. |
| `malicious` | `75–100` | Boundary malicious (`75`) | `75` | Sits at the `high`/`critical` boundary (`75` vs `76`) to test tier-mapping edge cases. |
| `malicious` | `75–100` | Confirmed malicious (`76–100`) | `76–98` | Maps to `critical` tier (`76–100`); confirmed drainer, sweeper, rug-pull issuer, or signer-takeover key. |

#### Governance for out-of-band scores (modelled oracle blind spots)

Out-of-band scores exist strictly to test that the evaluation runner (`scripts/eval.mjs`) and downstream consumers (`grydlock-research`) accurately surface false negatives, false positives, and severity under-classifications:

1. **Mandatory `score_rationale`:** Every destination whose score falls outside its label's validator band (`clean: 0–25`, `suspicious: 40–70`, `malicious: 75–100`) must carry a non-empty `score_rationale` in `destinations.json` (enforced by `validateScoreBand`).
2. **Explicit blind-spot categories:** An out-of-band `score_rationale` must cite one of three recognized oracle limitation classes:
   - **Cold-start blind spot (False Negative control):** Freshly funded attacker account (`malicious`, `cold-start`) scored `5–15` because an history-based oracle has seen zero prior transactions.
   - **Unlinked mule / delayed attribution (False Negative / Under-tier control):** A `sponsored-mule` or secondary `sweep` wallet scored `15` or `72` prior to graph clustering.
   - **Heuristic look-alike noise (False Positive control):** An `adversarial-clean` account (e.g. high-velocity payroll, multisig co-signer rotation, or dApp spender) scored `28–45` (`elevated`) because its activity pattern resembles a drainer.
3. **Blind-spot quota (10–20% of corpus):** Out-of-band destinations should comprise between **10% and 20%** of `destinations.json` so that `reports/baseline-fixtures.md` remains a realistic benchmark (~80–90% recall, non-zero FPR) rather than a trivial 100% pass or a noisy coin flip.

---

## 4. Provenance & Privacy Requirements

Every fixture addition or modification must satisfy four provenance invariants:

1. **Synthetic-only attestation:** Every destination must set `"fixture_status": "synthetic-only"`. Real-world addresses, mainnet hashes, or identifiable project names/domains are prohibited; testnet `home_domain` values must use the reserved `.invalid` TLD (RFC 2606, e.g. `anchor.example.invalid`).
2. **Zero secret material in Git:** Keypairs used by `scripts/testnet/generate.mjs` are ephemeral in-memory `Keypair.random()` instances funded by Friendbot; `scripts/check-secrets.mjs` scans all tracked files for SEP-23 `S...` secret seeds on every CI run.
3. **Verifiable `provenance` block:**
   - Testnet-generated entries must record `provenance: { kind: "testnet", runId, generatedAt, networkPassphrase, ... }` matching `dataset/testnet-run.json`.
   - Offline seed or unsubmitted challenge entries must record `provenance: { kind: "offline-synthetic", ... }`.
4. **Baseline report lockstep:** Any PR that changes a label, risk pattern, counterparty list, or stub score must regenerate `docs/FIXTURES.md` (`npm run docs`) and `reports/baseline-fixtures.{json,md}` (`npm run eval -- --oracle fixtures --out reports/baseline-fixtures`), and document the reason in `CHANGELOG.md` under `[Unreleased]`.

---

## 5. Reviewer Checklist for Label and Score Changes

Reviewers evaluating a PR that adds or modifies fixtures should verify the two tracks independently:

### Part A — Label & Provenance Review (Ground Truth)
- [ ] **Synthetic safety:** No real person, entity, or live project ticker/domain is referenced (`fixture_status: "synthetic-only"`, `.invalid` domains only, `node scripts/check-secrets.mjs` passes).
- [ ] **Constructive evidence:** Does the `setup` + `fixture` + `evidence` sequence in `scripts/testnet/recipes.mjs` (and `dataset/testnet-run.json`) objectively demonstrate the assigned `label` and `risk_pattern` under `docs/LABELS.md`?
- [ ] **Adversarial control check:** If the PR introduces a new `malicious` operation shape, does a corresponding `clean` (`adversarial-clean`) twin exist so false positives are measured?
- [ ] **Counterparty & hash integrity:** Does `npm run validate && npm test` pass with zero warnings?

### Part B — Stub Score Review (Simulated Oracle)
- [ ] **Track separation:** If this PR only recalibrates `scores.json`, confirm that **no `label` or `risk_pattern` was altered** to make evaluation numbers look better.
- [ ] **Band & tier alignment:** Does the score match the intra-band anchor in §3 (`0–20` low, `21–25` noisy clean, `40–50` elevated suspicious, `51–70` high suspicious, `76–100` critical malicious)?
- [ ] **Out-of-band justification:** If the score is outside its label band, does `score_rationale` name the exact oracle blind spot (`cold-start`, unlinked `sponsored-mule`, or `adversarial-clean` false positive)?
- [ ] **Metric diff inspection:** Does the updated `reports/baseline-fixtures.md` diff show the expected shift in precision, recall, or false-positive rate?

---

## 6. Worked Example of a Reviewed Change

Below is an example showing how a **label addition** and an **out-of-band score calibration** are reviewed and recorded as separate governance decisions within a fixture submission.

### Scenario: Adding a cold-start address-poisoning look-alike (`malicious` label, out-of-band `low` stub score)

1. **Track 1 (Label decision — `malicious` / `phishing-drainer`):**
   - **On-chain evidence in `recipes.mjs`:** In `setup`, `victim-1` pays `clean-merchant-1` (`GABC...XYZ9`), and `poisoner-1` (`GABC...1239`, sharing prefix/suffix characters) sends a `0.0001 XLM` dust payment to `victim-1`. In `fixture` (`mal_payment_address_poisoning`), `victim-1` mistakenly sends `250 XLM` to `poisoner-1`. In `evidence`, `poisoner-1` sweeps the `250 XLM` to `sweeper-1`.
   - **Label verdict:** Because `poisoner-1` collects funds from an impersonation lure and forwards them to a sweeper, its ground-truth label is unambiguously `malicious`.
2. **Track 2 (Score decision — `score: 9` with `score_rationale`):**
   - **Oracle simulation rationale:** At the moment `victim-1` signs `mal_payment_address_poisoning`, `poisoner-1` is a brand-new account whose only prior transaction is a single outbound dust payment. A purely history/graph-based oracle without vanity-similarity detection against the victim's own payment history will score `poisoner-1` in the `low` tier (`9`).
   - **Resulting `destinations.json` & `scores.json` entry:**

```json
{
  "id": "poisoner-lookalike-1",
  "type": "account",
  "address": "GABCD7EXAMPLESYNTHETICADDRESSPOISONERLOOKALIKE9XYZ",
  "label": "malicious",
  "risk_pattern": "phishing-drainer",
  "fixture_status": "synthetic-only",
  "notes": "Fresh vanity look-alike address that dusted victim-1 before receiving a misdirected payment.",
  "rationale": "Sends dust to mimic clean-merchant-1's prefix/suffix, receives 250 XLM from victim-1, and sweeps proceeds to sweeper-1 in the evidence tx.",
  "score_rationale": "Modelled cold-start blind spot: the address has only one prior dust tx and no links to known sweepers until after the victim signs."
}
```

- **Evaluation impact in `reports/baseline-fixtures.md`:** Correctly recorded as a **false negative** (`malicious` ground truth evaluated as `low` / `clean` by the static address-only oracle), giving `grydlock-research` a concrete benchmark case for history-aware client-side heuristics.
