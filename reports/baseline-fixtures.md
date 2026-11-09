# Gryd Lock evaluation — `fixtures`

- **Oracle:** Stub scores from scores.json (simulated oracle; see docs/LABELS.md)
- **Dataset:** grydlock-testkit v0.2.0 — 73 destinations, 41 transaction XDRs
- **Generated:** 2026-11-09T19:43:15.540Z
- **Tier mapping:** low ≤ 20 → clean · elevated ≤ 50 and high ≤ 75 → suspicious · critical → malicious · no score → unscored (no warning)

## Headline

| Metric | Value |
| --- | ---: |
| Warning precision | 92.6% |
| Warning recall | 92.6% |
| False-positive rate (clean items warned) | 10.9% |
| Coverage (items with a score) | 99.1% |
| Exact-tier accuracy | 86.8% |
| Oracle call latency p50 / p95 | 3 µs / 10 µs (n = 134) |
| Per-fixture latency p50 / p95 | 3 µs / 897 µs (n = 114) |

## Per tier

### All fixtures (n = 114)

| Tier | Support | Predicted | Precision | Recall | F1 |
| --- | ---: | ---: | ---: | ---: | ---: |
| clean | 46 | 45 | 88.9% | 87.0% | 87.9% |
| suspicious | 27 | 29 | 79.3% | 85.2% | 82.1% |
| malicious | 41 | 39 | 92.3% | 87.8% | 90.0% |

Warning (suspicious or malicious) — precision 92.6%, recall 92.6%, **false-positive rate 10.9%**, coverage 99.1%, exact-tier accuracy 86.8%.

| label \ predicted | clean | suspicious | malicious | unscored |
| --- | ---: | ---: | ---: | ---: |
| **clean** | 40 | 5 | 0 | 1 |
| **suspicious** | 1 | 23 | 3 | 0 |
| **malicious** | 4 | 1 | 36 | 0 |

### Destinations (n = 73)

| Tier | Support | Predicted | Precision | Recall | F1 |
| --- | ---: | ---: | ---: | ---: | ---: |
| clean | 30 | 31 | 87.1% | 90.0% | 88.5% |
| suspicious | 16 | 19 | 78.9% | 93.8% | 85.7% |
| malicious | 27 | 23 | 100.0% | 85.2% | 92.0% |

Warning (suspicious or malicious) — precision 92.9%, recall 90.7%, **false-positive rate 10.0%**, coverage 100.0%, exact-tier accuracy 89.0%.

| label \ predicted | clean | suspicious | malicious | unscored |
| --- | ---: | ---: | ---: | ---: |
| **clean** | 27 | 3 | 0 | 0 |
| **suspicious** | 1 | 15 | 0 | 0 |
| **malicious** | 3 | 1 | 23 | 0 |

### Transactions (decode → score counterparties → riskiest tier) (n = 41)

| Tier | Support | Predicted | Precision | Recall | F1 |
| --- | ---: | ---: | ---: | ---: | ---: |
| clean | 16 | 14 | 92.9% | 81.3% | 86.7% |
| suspicious | 11 | 10 | 80.0% | 72.7% | 76.2% |
| malicious | 14 | 16 | 81.3% | 92.9% | 86.7% |

Warning (suspicious or malicious) — precision 92.3%, recall 96.0%, **false-positive rate 12.5%**, coverage 97.6%, exact-tier accuracy 82.9%.

| label \ predicted | clean | suspicious | malicious | unscored |
| --- | ---: | ---: | ---: | ---: |
| **clean** | 13 | 2 | 0 | 1 |
| **suspicious** | 0 | 8 | 3 | 0 |
| **malicious** | 1 | 0 | 13 | 0 |


## By risk pattern

| Risk pattern | Label | Support | Exact tier | Warned | Unscored |
| --- | --- | ---: | ---: | ---: | ---: |
| account-merge-drain | malicious | 5 | 5 | 5 | 0 |
| adversarial-clean | clean | 8 | 3 | 5 | 0 |
| claimable-balance-spam | malicious/suspicious | 3 | 2 | 3 | 0 |
| clawback-enabled | suspicious | 3 | 3 | 3 | 0 |
| cold-start | clean/malicious | 6 | 2 | 0 | 0 |
| memo-impersonation | suspicious | 3 | 3 | 3 | 0 |
| none | clean | 36 | 35 | 0 | 1 |
| pass-through | suspicious | 11 | 11 | 11 | 0 |
| phishing-drainer | malicious | 5 | 5 | 5 | 0 |
| rug-pull | malicious | 7 | 7 | 7 | 0 |
| scam-trustline | suspicious | 5 | 3 | 5 | 0 |
| signer-takeover | malicious | 6 | 6 | 6 | 0 |
| soroban-approval-drain | malicious | 4 | 4 | 4 | 0 |
| sponsored-mule | malicious/suspicious | 5 | 4 | 4 | 0 |
| sweep | malicious | 7 | 6 | 7 | 0 |

## Misclassified fixtures (15)

| Kind | Id | Persona | Risk pattern | Label | Predicted | Score | Direction |
| --- | --- | --- | --- | --- | --- | ---: | --- |
| destination | `GB276PXQMD…F433OJ` | clean-cosigner | adversarial-clean | clean | suspicious | 28 | over-warn |
| destination | `GBV6FR3VVU…IGEWXL` | clean-dapp-spender | adversarial-clean | clean | suspicious | 34 | over-warn |
| destination | `GAZFRP5KJV…5FFYWA` | clean-high-velocity | adversarial-clean | clean | suspicious | 41 | over-warn |
| destination | `GDHFMEK3B2…4SMVPY` | sponsored-mule-3 | sponsored-mule | suspicious | clean | 15 | under-warn |
| destination | `GBJKRDZJKY…USX34F` | sweeper-3 | sweep | malicious | suspicious | 72 | under-warn |
| destination | `GCRZEOWD6J…6GRYPA` | cold-start-scam-1 | cold-start | malicious | clean | 8 | under-warn |
| destination | `GBOMQDX24C…OW6GNP` | cold-start-scam-2 | cold-start | malicious | clean | 12 | under-warn |
| destination | `GCHW7QBOMD…V2ZSIL` | cold-start-scam-3 | cold-start | malicious | clean | 5 | under-warn |
| transaction | `change_trust` |  | scam-trustline | suspicious | malicious | 97 | over-warn |
| transaction | `clean_clai…e_tusd` |  | none | clean | unscored | — | unscored |
| transaction | `clean_soro…ounded` |  | adversarial-clean | clean | suspicious | 34 | over-warn |
| transaction | `clean_set_…signer` |  | adversarial-clean | clean | suspicious | 28 | over-warn |
| transaction | `susp_chang…_asset` |  | scam-trustline | suspicious | malicious | 96 | over-warn |
| transaction | `susp_claim_airdrop_spam` |  | claimable-balance-spam | suspicious | malicious | 85 | over-warn |
| transaction | `mal_paymen…t_scam` |  | cold-start | malicious | clean | 8 | under-warn |
