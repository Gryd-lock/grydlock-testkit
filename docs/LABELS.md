# Label taxonomy and rationale

Every fixture in this repo carries a **label** (ground-truth risk tier) and a **risk pattern** (the warning category). This document defines both, gives the rubric used to assign them, and explains how the stub scores in `scores.json` were chosen. The rationale for each individual fixture is in its `rationale` field and in the generated catalog, [`FIXTURES.md`](FIXTURES.md).

All fixtures are synthetic. Testnet personas are random keypairs created by `scripts/testnet/generate.mjs` and funded by Friendbot. The seed set (v0.1.0) uses random addresses that were never funded. No fixture is, or is derived from, a real person or entity. Every destination carries `fixture_status: "synthetic-only"`.

## Labels (tiers)

| Label | Meaning for a **destination** | Meaning for a **transaction** (harm of signing it) |
| --- | --- | --- |
| `clean` | No behaviour in the run suggests risk. | Signing it exposes the signer to no attacker. |
| `suspicious` | A risk signal without direct theft: a laundering hop, an impersonation lure, issuer discretion, mule infrastructure. | Exposes the signer to a risky party or asset, but does not by itself move value to an attacker. A user should double-check. |
| `malicious` | The run shows it stealing or collecting stolen value. | Moves value to, or hands control to, an attacker. Cancelling is the right call. |

### Rubric for transaction labels

1. **Label by construction, then check against the worst operation.** Each recipe is written to act out a specific behaviour. Its label is the harm of that behaviour for the signing account. In a multi-op bundle, the worst operation decides the label (`mal_multi_op_bundle` contains a harmless `changeTrust`, but it also adds an attacker signer).
2. **Trustlines and claims move no value**, so `changeTrust` to a scam asset and claiming spam airdrops are `suspicious`, not `malicious`. Buying the scam token (`mal_path_buy_rug_token`) is `malicious`.
3. **Fee-bump wrappers follow the inner transaction.** A clean fee payer does not clean a draining payment. An attacker fee payer on a draining payment adds evidence but does not change the label.
4. **Same operation, different intent.** Signer additions, account merges, Soroban approvals and fan-out payments each appear as both `clean` (`adversarial-clean`) and `malicious` fixtures. These clean twins exist to measure false positives.
5. **Labels never depend on the stub score.** Scores model an oracle; labels are what actually happened.

## Risk patterns

| Pattern | Typical label | Definition | Example fixtures |
| --- | --- | --- | --- |
| `none` | clean | No warning signal. | `clean_payment_xlm` |
| `adversarial-clean` | clean | Clean, but shaped like an attack (co-signer added, merge into own wallet, bounded approval, payroll fan-out). Used to measure false positives. | `clean_set_options_cosigner`, `clean_account_merge_own_wallet` |
| `cold-start` | clean or malicious | No history at all. Clean when it is a new user; malicious when it is a fresh scam wallet. Probes the oracle's unknown-destination behaviour. | `clean_payment_new_user`, `mal_payment_cold_start_scam` |
| `pass-through` | suspicious | Receives funds and forwards them within the minute to a sweeper (laundering hop). | `susp_payment_pass_through` |
| `scam-trustline` | suspicious | Trustline to a rug-pull asset; a holder whose only activity is that trustline. | `susp_change_trust_scam_asset` |
| `sponsored-mule` | suspicious / malicious | Account whose reserves are sponsored by an attacker (mule), or the sponsor itself. | `susp_sponsored_mule_creation` |
| `memo-impersonation` | suspicious | Dust payments whose memos impersonate support or refunds, followed by a "fee" request. | `susp_payment_memo_impersonation` |
| `clawback-enabled` | suspicious | Asset or issuer with `AUTH_CLAWBACK_ENABLED`: the issuer can reclaim balances. Legitimate for regulated assets, so suspicious rather than malicious. | `susp_change_trust_clawback_asset` |
| `claimable-balance-spam` | suspicious / malicious | Unsolicited claimable-balance airdrops used as lures (the issuer is malicious; claiming one is suspicious). | `susp_claim_airdrop_spam` |
| `sweep` | malicious | Final collection wallet for drained or forwarded funds. | `mal_path_payment_sweeper`, `mal_soroban_transfer_to_sweeper` |
| `phishing-drainer` | malicious | Dusts targets with "test" payments, then receives a large drain (incl. "gasless" fee-bump lures). | `mal_fee_bump_gasless_drain` |
| `signer-takeover` | malicious | `setOptions` that gives an attacker key enough weight to act alone. | `mal_set_options_signer_takeover`, `mal_multi_op_bundle` |
| `account-merge-drain` | malicious | `accountMerge` into an attacker, transferring the whole balance and deleting the account. | `mal_account_merge_drain`, `mal_multi_op_hidden_merge` |
| `soroban-approval-drain` | malicious | Soroban token `approve()` of a large or unlimited, long-lived allowance to an unknown spender, followed by `transfer_from`. | `mal_soroban_approve_unlimited`, `mal_soroban_approve_native` |
| `rug-pull` | malicious | Issuer that keeps all supply and sells it, the asset itself, and its SAC wrapper. | `mal_path_buy_rug_token` |

`phishing-drainer`, `rug-pull`, `sweep` and `pass-through` come from the v0.1.0 seed set. `signer-takeover`, `memo-impersonation`, `sponsored-mule`, `cold-start` and `adversarial-clean` were reserved in v0.1.0 and are now populated. The four remaining patterns are new in v0.2.0.

## Stub scores are a simulated oracle, not the labels

`scores.json` is what `StubOracle` and `npm run eval -- --oracle fixtures` return. If every score were derived from its label, the evaluation would always report 100% and measure nothing. Instead each score models what a plausible reputation oracle would say, including its known blind spots:

| Deliberate imperfection | Fixtures | Effect in the eval |
| --- | --- | --- |
| Cold-start scams scored low (5–12) | `cold-start-scam-*` | Missed warnings (false negatives) |
| Adversarial-clean scored elevated (28–41) | `clean-cosigner`, `clean-dapp-spender`, `clean-high-velocity` | False positives |
| Mule not yet linked to its sponsor (15) | `sponsored-mule-3` | Missed warning |
| Sweeper scored *high* not *critical* (72) | `sweeper-3` | Warned, but at the wrong severity |
| Boundary scores (20, 51) | `clean-boundary`, `pass-through-boundary` | Off-by-one tiering checks |
| Suspicious scored *elevated* (44–47) | `memo-impersonator-2`, `pass-through-3` | Correct: elevated maps to suspicious |

Each deliberately out-of-band score carries a `score_rationale` on its destination. The validator rejects an out-of-band score that has none (bands: clean 0–25, suspicious 40–70, malicious 75–100).

Unknown destinations (for example internal victim accounts, or the network's native-XLM SAC) have **no** score and evaluate as `unscored`. `unscored` counts as "no warning", matching how the extension's `UNSCORED_TIER_INFO` gives no risk verdict. The fixtures-oracle baseline therefore measures the harness and the effect of these modelled blind spots. It does **not** measure Gryd Lock's real-world accuracy. For that, run the eval against a live oracle (`--oracle soroban:<CONTRACT_ID>`).

## Score → tier → label mapping

Mirrors `grydlock-extension/src/lib/tiers.ts` (`scripts/lib/tiers.mjs`):

| Score | Extension tier | Evaluated as |
| --- | --- | --- |
| 0–20 | low | clean |
| 21–50 | elevated | suspicious |
| 51–75 | high | suspicious |
| 76–100 | critical | malicious |
| none | unscored | unscored (no warning) |

A **transaction's** predicted tier is the riskiest scored counterparty after decoding: destinations, assets, contracts, Soroban address arguments, new signers, sponsored accounts and fee-bump payers (`extractCounterparties` in `scripts/lib/stellar.mjs`). The signer's own account is excluded.
