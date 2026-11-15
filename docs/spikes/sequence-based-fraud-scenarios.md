# Spike: Canonical Model for Sequence-Based Fraud Scenarios

**Category:** Spike · **Impact:** Critical · **Cross-repo:** `grydlock-testkit`, `grydlock-research`, `grydlock-oracle-adapter`, `grydlock-extension`

## Question

Should multi-step fraud evaluation in Gryd Lock use ordered XDR bundles, ledger event streams, state snapshots, participant graphs, or independent point fixtures?

## Recommendation

Standardize on **Approach A+ (Ordered XDR Scenario Bundles with Declarative Pre/Post State Deltas and Warning Checkpoints)** — an evolution of the existing `scenarios/*.json` and `scripts/replay-scenario.mjs` architecture:

1. **Keep point fixtures (`transactions/*.xdr` + `transactions/index.json`) untouched** as the atomic unit of XDR storage and single-signature evaluation (`tests/backward-compat.test.mjs`).
2. **Model multi-transaction attacks as ordered scenario manifests (`scenarios/<name>.json`)** that reference existing `transactions/<id>.xdr` envelopes by ID, annotated with explicit per-step **roles** (`setup`, `lure`, `user-sign`, `drain`), **temporal deltas** (`ledger_delta`, `elapsed_seconds`), **lightweight state assertions** (`expected_state_delta`), and **warning checkpoints** (`checkpoint: { should_warn, expected_tier, expected_risk_patterns, active_oracle_knowledge }`).
3. **Why this wins:** Unlike raw Horizon/Soroban event streams (which cannot represent *unsubmitted* transactions at the pre-signing warning moment) or standalone participant graphs (which lose operation ordering and XDR byte fidelity), ordered XDR bundles with state/checkpoint annotations preserve deterministic offline replay (`npm run replay`) while giving `grydlock-extension` and `grydlock-research` exact pre-signing checkpoints to evaluate time-dependent attacks.

---

## 1. Why Point Fixtures Alone Are Insufficient

Point fixtures in `transactions/index.json` evaluate a single unsigned XDR envelope against a static `scores.json` snapshot. However, several of the highest-impact Stellar fraud patterns are inherently **multi-step and state-dependent**:

| Fraud pattern | Step 1 (`setup` / `lure`) | Step 2 (`user-sign` checkpoint) | Step 3 (`drain` / `evidence`) | Why point evaluation misses the full picture |
|---|---|---|---|---|
| **Phishing dust + memo impersonation + pass-through sweep** (`phishing-drain.json`) | Attacker sends 0.01 XLM dust with a fake support memo. | Victim signs a payment to `pass-through` mule. | Mule immediately forwards funds via `pathPaymentStrictSend` to `sweeper`. | At Step 2, the warning layer must connect the recent inbound dust lure to the outbound payment destination. |
| **Silent signer takeover (`setOptions`) -> delayed drain** | Victim is tricked into signing `setOptions` adding attacker key with weight 10. | *(Time elapses; victim's account now has a foreign high-weight signer.)* | Attacker signs a full-balance `payment` or `accountMerge` without the victim's wallet ever being prompted again. | Step 1 moves **0 XLM**; Step 3 is never shown to the victim's wallet extension. **Step 1 is the only warning checkpoint that can save the user.** |
| **Scam trustline -> DEX rug-pull / liquidity dump** | Issuer creates scam token; victim signs `changeTrust` (`suspicious`). | Victim signs `pathPaymentStrictSend` or `manageSellOffer` buying/dumping the token (`malicious`). | Issuer pulls DEX liquidity or claws back balances. | Risk escalates across the sequence from `suspicious` exposure (Step 1) to `malicious` value loss (Step 2). |
| **Soroban unlimited `approve()` -> delayed `transfer_from()`** | Victim signs `invokeHostFunction` calling `approve(victim, spender, MAX, long_expiration)`. | *(Spender allowance is now active in contract storage.)* | Attacker calls `transfer_from(victim, sweeper, balance)` in their own transaction. | Just like signer takeover, the victim only signs Step 1; Step 3 happens asynchronously on-chain. |

---

## 2. Comparison of Five Candidate Representations

We evaluated the five representations listed in Issue #72 across six engineering and research criteria:

| Criterion | 1. Independent Point Fixtures (Baseline) | 2. Ordered XDR Bundles + State/Checkpoints (Recommended) | 3. Ledger Event & Effect Streams | 4. Full Ledger State Snapshots | 5. Participant Relationship Graphs |
|---|---|---|---|---|---|
| **Expressiveness (timing & causal transitions)** | ❌ Low — no causal ordering, temporal gap, or pre/post state transition between transactions. | ✅ High — captures exact operation sequence, ledger/time deltas, oracle knowledge evolution, and warning checkpoints. | ⚠️ Medium — captures post-facto Horizon effects/Soroban events, but cannot represent an *unsigned* transaction about to be signed in Freighter. | ✅ High — full account/trustline/contract storage before and after every step. | ⚠️ Medium — captures topology (sponsor -> mule -> sweeper), but drops XDR envelope semantics and operation order. |
| **Reproducibility & offline determinism** | ✅ High | ✅ High — builds directly on `scripts/replay-scenario.mjs` using zero network calls. | ⚠️ Medium — tightly coupled to Horizon/Soroban RPC response schemas across protocol upgrades. | ❌ Low — full Soroban/Horizon ledger snapshots are brittle and verbose to maintain by hand. | ✅ High |
| **Validator complexity** | ✅ Minimal (`validate-transactions.mjs`) | ✅ Low — extends `scripts/lib/scenario.mjs` and `scripts/validate-scenarios.mjs` with optional checkpoint/delta fields. | ❌ High — requires a mock Horizon/RPC effect validator. | ❌ Very High — requires a local ledger state transitions simulator. | ⚠️ Medium — requires graph schema + cycle/edge validators. |
| **Storage footprint** | ✅ Minimal (~300 B/tx) | ✅ Minimal (~1–2 KB JSON per scenario; reuses existing `.xdr` files without duplication). | ❌ Heavy (10–50 KB of JSON effects per step). | ❌ Heavy (multi-KB ledger entry dumps per step). | ✅ Small (~1 KB/graph). |
| **Consumer usability (`extension` & `research`)** | ✅ Simple for single-tx decode; ❌ unusable for sequence replay. | ✅ Directly consumable: `extension` tests pre-signing checkpoints; `research` measures sequence-level detection & time-to-warn. | ❌ Extension does not ingest raw Horizon effect streams at signing time. | ❌ Too low-level for extension warning UI tests. | ⚠️ Useful only for oracle clustering research, not wallet signing tests. |
| **Synthetic-data compatibility** | ✅ Native | ✅ Native — works seamlessly with both `offline-synthetic` seeds and `testnet` generated runs (`dataset/testnet-run.json`). | ❌ Requires synthesizing full Horizon effect payloads for offline fixtures. | ❌ Requires synthesizing full XDR `LedgerEntry` structures. | ✅ Native |

---

## 3. Canonical Schema Design (v2 Scenario Model)

The canonical model preserves backward compatibility with v1 `scenarios/*.json` (`name`, `description`, `pattern`, `expected_outcome`, `participants`, `steps`) while standardizing four behavior-level extensions:

1. **`step.phase` (`"setup" | "lure" | "checkpoint" | "follow-up"`):** Distinguishes background attacker preparation (`setup`), inbound attacker contact (`lure`), transactions where the victim's wallet is prompted to sign (`checkpoint`), and post-compromise attacker execution (`follow-up`).
2. **`step.timing` (`{ ledger_delta, elapsed_seconds }`):** Explicit relative ledger and wall-clock spacing from the previous step (generalizing `timestamp_offset_s`) so sequence evaluators can test velocity rules (e.g. pass-through forwarding within `< 60s` vs dormant signer takeover after `86,400s`).
3. **`step.state_transition` (`{ before, after }`):** Concise, human- and machine-readable invariants describing the account/trustline/allowance state change caused by the step (e.g. signers, trustline flags, token allowances, or balance movement).
4. **`step.warning_checkpoint`:** Present on every step where the victim's wallet intercepts an unsigned XDR (`phase: "checkpoint"`). Specifies:
   - `signer`: Participant ID whose wallet is signing.
   - `should_warn`: Boolean (`true` if the extension must warn or block at this step).
   - `min_expected_tier`: `"low" | "elevated" | "high" | "critical"`.
   - `point_of_no_return`: Boolean (`true` if failing to warn at this step results in irreversible loss or account compromise in a subsequent `follow-up` step where the victim no longer signs).
   - `oracle_score_overrides` *(optional)*: Allows a scenario to model how oracle scores evolve between steps (for example, a mule scored `15` at step 1 before sponsor clustering, rising to `65` at step 2).

---

## 4. Proof-of-Concept Model: Multi-Step Signer Takeover & Delayed Sweep Sequence

Below is a complete PoC modeling a 3-step **Dust Lure -> Bundled Signer Takeover (Point-of-No-Return Checkpoint) -> Unattended Sweep** sequence using existing fixtures in `grydlock-testkit`:

```json
{
  "schema_version": "2.0",
  "name": "signer-takeover-delayed-sweep",
  "description": "Attacker lures a victim with a memo-impersonation dust payment, tricks the victim into signing a multi-operation bundle that quietly adds an attacker high-weight signer, and later sweeps the victim's funds without further victim interaction.",
  "pattern": "signer-takeover",
  "expected_outcome": "malicious",
  "participants": [
    { "id": "victim-1", "role": "victim" },
    { "id": "memo-impersonator-1", "role": "lure-sender" },
    { "id": "takeover-signer-1", "role": "attacker-signer" },
    { "id": "sweeper-1", "role": "collector" }
  ],
  "steps": [
    {
      "step": 1,
      "phase": "lure",
      "transaction": "susp_payment_memo_impersonation",
      "from": "memo-impersonator-1",
      "to": "victim-1",
      "asset": "native",
      "timestamp_offset_s": 0,
      "timing": {
        "ledger_delta": 0,
        "elapsed_seconds": 0
      },
      "state_transition": {
        "before": { "victim_signers": ["victim-1 (w=1)"], "lure_seen": false },
        "after": { "victim_signers": ["victim-1 (w=1)"], "lure_seen": true }
      },
      "notes": "Attacker sends dust with a support/claim memo to induce the victim to visit a phishing dApp."
    },
    {
      "step": 2,
      "phase": "checkpoint",
      "transaction": "mal_multi_op_bundle",
      "from": "victim-1",
      "to": "takeover-signer-1",
      "asset": "native",
      "timestamp_offset_s": 180,
      "timing": {
        "ledger_delta": 36,
        "elapsed_seconds": 180
      },
      "state_transition": {
        "before": { "victim_signers": ["victim-1 (w=1)"], "attacker_can_sign_alone": false },
        "after": { "victim_signers": ["victim-1 (w=1)", "takeover-signer-1 (w=10)"], "attacker_can_sign_alone": true }
      },
      "warning_checkpoint": {
        "signer": "victim-1",
        "should_warn": true,
        "min_expected_tier": "critical",
        "expected_risk_patterns": ["signer-takeover"],
        "point_of_no_return": true
      },
      "notes": "Victim is asked to sign a multi-op envelope that hides setOptions(signer: takeover-signer-1, weight: 10) behind a benign changeTrust."
    },
    {
      "step": 3,
      "phase": "follow-up",
      "transaction": "mal_path_payment_sweeper",
      "from": "victim-1",
      "to": "sweeper-1",
      "asset": "native",
      "timestamp_offset_s": 3600,
      "timing": {
        "ledger_delta": 720,
        "elapsed_seconds": 3600
      },
      "state_transition": {
        "before": { "attacker_can_sign_alone": true },
        "after": { "victim_balance_drained": true, "proceeds_at": "sweeper-1" }
      },
      "notes": "One hour later, the attacker uses takeover-signer-1's authority to sweep funds to sweeper-1 without prompting the victim's wallet."
    }
  ]
}
```

### Deterministic Replay Semantics (`scripts/replay-scenario.mjs`)

When `npm run replay` executes a v2 scenario bundle:

1. **Topological & temporal validation:** Confirms `steps[i].step === i + 1` and `timestamp_offset_s` (and `timing.ledger_delta` when present) are monotonically non-decreasing.
2. **XDR envelope cross-check:** Decodes each referenced `transactions/<id>.xdr` under `NETWORK_PASSPHRASE` (or validates the raw base64 envelope and `transactions/index.json` counterparties) to verify that `from`, `to`, and `asset` match the actual encoded operations.
3. **Checkpoint evaluation:** At every step with `phase: "checkpoint"` (or for every step in v1 scenarios), computes the step's effective score using `scores.json` merged with any `warning_checkpoint.oracle_score_overrides`, maps the maximum counterparty score through `scripts/lib/tiers.mjs`, and checks whether `predictedTier >= warning_checkpoint.min_expected_tier`.
4. **Point-of-no-return reporting:** Separately reports **checkpoint recall** (did the warning fire at or before the `point_of_no_return` step, while the user still had a chance to cancel?) versus **post-compromise detection** (catching the drain only at Step 3, after the attacker already controls the account).

---

## 5. Required Metadata and Validation Rules

To keep `npm run validate:scenarios` strict and deterministic, scenario files must satisfy the following validation contract:

| Rule ID | Field | Validation rule |
|---|---|---|
| `SCEN-01` | `name`, `pattern`, `expected_outcome` | `name` matches kebab-case filename stem; `pattern` is in `VALID_RISK_PATTERNS`; `expected_outcome` is in `VALID_LABELS` (`clean`, `suspicious`, `malicious`). |
| `SCEN-02` | `participants[]` | Non-empty array of `{ id, role }`; every `id` must exist in `destinations.json` with no duplicates. |
| `SCEN-03` | `steps[]` | Contiguous `1..N` numbering (`N >= 2`); monotonic `timestamp_offset_s >= 0`; `from` and `to` must be declared in `participants[]`; `transaction` must resolve to an existing `transactions/<id>.xdr`. |
| `SCEN-04` | `step.phase` *(optional in v1, required in v2)* | One of `"setup"`, `"lure"`, `"checkpoint"`, `"follow-up"`. Every scenario must contain at least one `"checkpoint"` step. |
| `SCEN-05` | `step.warning_checkpoint` | When present: `signer` is in `participants[]`, `should_warn` is boolean, `min_expected_tier` is in `["low", "elevated", "high", "critical"]`, and `point_of_no_return` is boolean. |
| `SCEN-06` | Outcome consistency | If `expected_outcome === "malicious"`, at least one `"checkpoint"` step must have `should_warn: true` and `min_expected_tier` of `"high"` or `"critical"`. |

---

## 6. Migration Path & Follow-Up Implementation Work

Because `phase`, `timing`, `state_transition`, and `warning_checkpoint` are additive fields on `steps[]`, existing v1 scenarios (`scenarios/phishing-drain.json`, `scenarios/rug-pull-collect.json`) remain 100% valid with zero breaking changes (`tests/backward-compat.test.mjs`).

### Decomposed follow-up issues

| # | Repository | Follow-up work item | Scope & deliverable |
|---|---|---|---|
| 1 | `grydlock-testkit` | Extend `scripts/lib/scenario.mjs` validator for v2 checkpoint fields | Validate optional `phase`, `timing`, `state_transition`, and `warning_checkpoint` fields (`SCEN-04`–`SCEN-06`) with unit tests in `tests/scenario-validation.test.mjs`. |
| 2 | `grydlock-testkit` | Upgrade `scripts/replay-scenario.mjs` to score `warning_checkpoint` and `point_of_no_return` | Report per-checkpoint tier match and whether the warning fired before `point_of_no_return: true`. |
| 3 | `grydlock-testkit` | Author v2 scenario bundles for testnet multi-step attacks | Add `scenarios/signer-takeover-delayed-sweep.json`, `scenarios/soroban-approval-drain.json`, and an `adversarial-clean` multisig rotation control scenario. |
| 4 | `grydlock-research` | Add sequence-level "Pre-Compromise Recall" metric to evaluation methodology | Measure how often the warning layer alerts at the user-signed checkpoint (`Step 2`) rather than only recognizing the attacker sweeper at `Step 3`. |
| 5 | `grydlock-extension` | Add scenario-driven integration tests for pre-signing warning UI | Feed `phase: "checkpoint"` steps from `grydlock-testkit/scenarios/*.json` into the extension's transaction warning pipeline. |
