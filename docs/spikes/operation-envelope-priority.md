# Spike: Which operation and envelope types should be added next?

**Category:** Spike · **Impact:** High · **Cross-repo:** testkit, extension decoder, adapter, research

## Question

Which Stellar operation and envelope types should be added next to maximize fraud-detection value? The
repository has `payment`, `pathPaymentStrictSend`, and `changeTrust` fixtures, while several
operation-specific additions are already proposed. Adding every operation equally would create a large
corpus without improving the warning product.

## Recommendation

Ship one tranche covering **multi-operation envelope support, `setOptions` (signer takeover),
`manageSellOffer`, `accountMerge`, memo coverage (id / hash / return / required-but-missing), and a small
set of deliberately malformed envelopes.** These six converge at the top under both a pure
threat-relevance ranking and a cost-adjusted ROI ranking (see [§ Prioritization](#prioritization)), and
four of them close gaps this repo has already committed to: `scripts/lib/taxonomy.mjs` defines
`signer-takeover`, `memo-impersonation`, and `sponsored-mule` with zero fixtures behind them, and the
`rug-pull` label is currently applied to a destination with no fixture showing the actual sell-off.

Soroban's `invokeHostFunction` is the headline "future threat" candidate, but it ranks near the bottom on
cost-adjusted value today — no `@stellar/stellar-sdk` dependency exists in this repo, there's no confirmed
evidence the extension decoder handles contract invocations yet, and per-contract semantics make
determinism low. Treat it as its own follow-up spike once that decoder capability is confirmed, not part
of this tranche.

## 1. Where the corpus stands today

The full fixture set is `payment.xdr`, `path_payment.xdr` (`pathPaymentStrictSend`), and
`change_trust.xdr` — three single-operation, unsigned, memo-less, time-bound-less envelopes against 12
labelled testnet destinations. The `scenarios/` layer composes these same three fixtures into ordered
sequences; it doesn't add operation coverage.

Of the 10 risk-pattern labels defined in `scripts/lib/taxonomy.mjs`, only five are attached to an actual
destination today:

| Used | Defined, zero fixtures |
|---|---|
| `sweep`, `phishing-drainer`, `rug-pull`\*, `pass-through`, `scam-trustline`, `adversarial-clean` | `signer-takeover`, `memo-impersonation`, `sponsored-mule`, `cold-start` |

\* `rug-pull` is used, but by CONTRIBUTING's own rubric the pattern is "change-trust + immediate max-sell"
— the corpus has the change-trust half and not the sell-off, so the label is currently unsubstantiated by
any fixture mechanism.

## 2. Coverage matrix

Ratings are High / Medium / Low, estimated from Stellar's protocol structure and this repo's own docs —
**not verified against the actual decoder in `grydlock-extension`**, which isn't checked out in this repo
(see [§ Caveats](#caveats)). `Decoder cost` is the one column where High is unfavorable; everywhere else,
higher is more valuable.

Status legend: **Taxonomy gap** (label defined, zero fixtures) · **Pattern incomplete** (label used,
mechanism missing) · **Anticipated** (README already scopes this) · **Net-new** (nothing names this yet).

### Operations

| Type | Status | Threat | Exposure | Decoder cost | Determinism | Consumer readiness | Test value |
|---|---|---|---|---|---|---|---|
| `setOptions` (signer takeover) | Taxonomy gap | H | H | M | H | H | H |
| `manageSellOffer` (completes rug-pull) | Pattern incomplete | H | M | L | H | H | H |
| `accountMerge` (full-balance drain) | Net-new | H | H | L | H | M | H |
| `createClaimableBalance` / `claimClaimableBalance` | Anticipated | M | M | M | M | M | H |
| `beginSponsoringFutureReserves` / `endSponsoringFutureReserves` / `revokeSponsorship` (sponsored mule) | Taxonomy gap | M | M | M | M | H | M |
| `manageData` (memo-impersonation, secondary vehicle) | Taxonomy gap | M | L | L | H | H | M |
| `clawback` / `clawbackClaimableBalance` | Net-new | M | M | M | H | L | M |
| `setTrustLineFlags` / `allowTrust` | Net-new | M | M | M | H | L | M |
| `createAccount` (cold-start) | Taxonomy gap | M | M | L | H | H | M |
| `pathPaymentStrictReceive` (sweep sibling) | Net-new | L | M | L | H | M | L |
| `liquidityPoolDeposit` / `liquidityPoolWithdraw` | Net-new | L | L | M | M | L | L |
| `invokeHostFunction` (Soroban) | Net-new | H | L | H | L | L | M |
| `bumpSequence` | Net-new | L | L | L | H | L | L |

### Envelope-level

| Type | Status | Threat | Exposure | Decoder cost | Determinism | Consumer readiness | Test value |
|---|---|---|---|---|---|---|---|
| Multi-operation envelopes | Anticipated | H | H | M | H | H | H |
| Memo types (id / hash / return / required-but-missing) | Taxonomy gap | H | H | L | H | H | H |
| Muxed accounts (`M...` addresses) | Anticipated | M | M | M | H | M | M |
| Fee-bump transactions | Net-new | L | L | M | H | L | M |
| Time / ledger bounds (expired or absent) | Net-new | M | M | L | H | L | M |
| Malformed / invalid envelopes (truncated, bad passphrase, bad signature) | Net-new | M | H | L | H | M | H |

## 3. Threat mapping

| Type | Attack pattern | Product need |
|---|---|---|
| `setOptions` | Attacker adds themselves as a high-weight signer (or lowers thresholds) on an already-funded account, then drains it in a separately-signed transaction later — no single tx looks like a drain. | "This transaction changes who can control your account" — a warning class no current fixture can exercise. |
| `manageSellOffer` | The rug-pull collector pattern CONTRIBUTING already documents: `changeTrust` to a scam asset immediately followed by a max-size sell order dumping it. | Substantiates the existing `rug-pull` label with the mechanism it's supposed to represent, ideally as a 2-step scenario chained after `change_trust.xdr`. |
| `accountMerge` | The single most complete drain mechanism on the network — 100% of an account's balance moves to `destination` and the account ceases to exist. Wallet UIs routinely under-explain it. | A distinct "this closes your account and sends everything to X" warning, sharper than the existing sweep framing. |
| Memo types | Wrong or missing memo on a payment to a custodial/exchange destination is one of the most common real-world Stellar loss vectors — funds land at the exchange but can't be attributed to the sender's sub-account. | "This destination requires a memo and none is set" / "memo doesn't match the expected recipient" — directly fills `memo-impersonation`. |
| Multi-operation envelopes | The actual bundling mechanism behind most Stellar drainer kits — a single signature request hides a `setOptions` takeover next to an innocuous `payment`, so the visible operation isn't the dangerous one. | Infrastructure, not a warning by itself — but a prerequisite for every "hidden operation in a batch" warning, and already the format `transactions/README.md` was written to support. |
| Sponsorship pair | Attacker sponsors a victim's new trustline or account reserve, making a scam interaction free to the victim and harder to distinguish from legitimate onboarding sponsorship. | "Someone else is paying the reserve for this action" — fills `sponsored-mule`, but needs multi-op support since these ops always wrap another operation. |
| `createAccount` | The first step of cold-start: fund a fresh wallet just enough to look legitimate, then run it through a drain sequence. | Lets a scenario represent the full lifecycle of a cold-start account rather than starting fixtures mid-story. |
| Malformed / invalid envelopes | Not a scam category — a decoder-robustness class. A truncated or wrong-network-passphrase envelope that crashes or silently passes the decoder is a total bypass of the warning layer. | Directly named in this spike's own "Areas to Investigate"; protects every other warning by making sure the pipeline degrades safely instead of silently. |

## 4. Prioritization

Same six ratings, two different aggregations (High/Medium/Low mapped to 3/2/1 in both).

**Strategy A — Threat-first:** Threat + Exposure, ties broken by Test value then Consumer readiness.
Ignores what anything costs to build.

1. 4-way tie: `setOptions`, `accountMerge`, multi-op envelopes, memo types
2. Tied next: `manageSellOffer`, malformed envelopes
3. `createClaimableBalance`
4. 3-way tie: sponsorship pair, `createAccount`, `invokeHostFunction` (Soroban)

**Strategy B — Cost-adjusted ROI:** (Threat + Exposure + Test value + Consumer readiness) − Decoder cost.

1. Memo types — highest score of any candidate
2. 4-way tie: `setOptions`, `manageSellOffer`, `accountMerge`, multi-op envelopes
3. Malformed envelopes
4. `createAccount`
5. 3-way tie: `createClaimableBalance`, sponsorship pair, `manageData`
6. … `invokeHostFunction` (Soroban) falls to the bottom third, above only `bumpSequence` and liquidity pools

**Where they disagree:** Soroban is the clearest split — tied for the #8 slot under pure threat-first (it's
real, growing exposure), but dropping to a bottom-third rank under ROI once its High decoder cost and Low
determinism are priced in, with no confirmed decoder support downstream either. `createClaimableBalance`
and the sponsorship pair also swap places with `createAccount` depending on strategy, but none of that
reordering changes what should ship first — the six items appearing in both top tiers are the answer.

## 5. Sequencing tranches

| Tranche | Items | Why |
|---|---|---|
| **1 — next** | Multi-op envelopes (infra), `setOptions`, `manageSellOffer`, `accountMerge`, memo types (×4), malformed envelopes | Converges on both strategies |
| **2** | `createClaimableBalance`, `claimClaimableBalance`, sponsorship pair, `createAccount`, muxed accounts | Needs multi-op from Tranche 1 |
| **3** | `clawback` family, `setTrustLineFlags` / `allowTrust`, `pathPaymentStrictReceive`, fee-bump, time / ledger bounds, liquidity pools, `bumpSequence` | Real, but lower value-to-cost |
| **Deferred — own spike** | `invokeHostFunction` (Soroban) | Blocked on decoder confirmation |

## 6. Prototypes (shape sketches, not generated XDR)

CONTRIBUTING.md requires new-operation XDR to come from a generation script, and no such script exists in
this repo yet (it's step 1 of the sequencing below). These sketches match the existing `destinations.json`
and `transactions/README.md` conventions closely enough to build the script against.

**`destinations.json` — signer-takeover victim**

```json
{
  "id": "malicious_wallet_5",
  "type": "account",
  "address": "GATT...EXAMPLE",
  "label": "malicious",
  "risk_pattern": "signer-takeover",
  "notes": "Added as a weight-10 signer via setOptions on a previously clean account; owner's key was never revoked."
}
```

**`transactions/README.md` — `set_options_signer_takeover.xdr`**

```
## set_options_signer_takeover.xdr

Envelope
Source     clean_wallet_2
Memo       none
Bounds     none

Operations
#1 setOptions
   signer     GATT...(attacker) weight 10
   thresholds unchanged
```

**`payment_memo_required_missing.xdr`**

```
## payment_memo_required_missing.xdr

Envelope
Source     clean_wallet_1
Memo       none  ← destination requires one
Bounds     none

Operations
#1 payment
   destination  exchange_wallet_1
   asset        native
   amount       250.0000000
```

**`bundled_takeover_and_decoy.xdr` — multi-op**

```
## bundled_takeover_and_decoy.xdr

Envelope
Source     clean_wallet_2
Memo       none
Bounds     none

Operations
#1 setOptions
   signer   GATT...(attacker) weight 10
#2 payment
   destination  clean_wallet_3
   asset        native
   amount       1.0000000  ← decoy, looks routine
```

## 7. Implementation sequencing

1. **Land the XDR generation script.** CONTRIBUTING.md already requires new operation types to be
   generated, not hand-edited — but no such script exists in `scripts/` yet. Every downstream step
   depends on it.
2. **Extend the format for multi-operation envelopes** (needs step 1). The Envelope/Operations table
   split in `transactions/README.md` already anticipates this; wire the generator to emit N-operation
   envelopes and validate against it.
3. **`setOptions`, single-op then bundled.** Ship the standalone signer-takeover fixture first, then the
   bundled decoy variant once multi-op lands.
4. **Memo coverage across id / hash / return / missing.** Cheapest item in the tranche — one destination
   flagged `memo_required`. Fills `memo-impersonation` without touching multi-op.
5. **`manageSellOffer` chained after `change_trust.xdr`.** Build as a 2-step scenario bundle (same
   pattern as `phishing-drain.json`) so `rug-pull` finally has a fixture mechanism behind it.
6. **`accountMerge`.** Single operation, low decoder cost — independent of the multi-op work, can land
   in parallel with steps 3–5.
7. **Malformed / invalid envelope smoke-set.** 3–4 deliberately broken envelopes (truncated bytes, wrong
   network passphrase, invalid signature) — near-zero marginal cost once the generator exists, and the
   one item this spike's own brief explicitly named.
8. **Re-run the consumer contract test, confirm decoder assumptions.** Validate against
   `grydlock-oracle-adapter`'s pinned-commit shape check, then check in with `grydlock-extension`
   maintainers on which operations their decoder currently switches on.

## Caveats

This checkout is `grydlock-testkit` only — `grydlock-extension`, `grydlock-oracle-adapter`, and
`grydlock-research` aren't vendored or cloned locally.

- **Decoder cost and consumer-readiness ratings are estimates**, built from Stellar's protocol/XDR
  structure and this repo's docs — not verified against the extension's actual operation-type switch
  statement. Worth a short pairing session before committing to the exact sequencing above.
- **No open issues reference specific operations** in this repo (no `.github/ISSUE_TEMPLATE/`, no
  matching branch names beyond ones already merged) — nothing here to reconcile against, but org-level
  issue trackers in the other three repos weren't checked and might already have operation-specific asks
  in flight.
- **The threat model itself lives in `grydlock-research`**, not in this repo — the mapping in
  [§ 3](#3-threat-mapping) is inferred from `taxonomy.mjs` and CONTRIBUTING's labelling rubric, this
  repo's closest proxy for it.
