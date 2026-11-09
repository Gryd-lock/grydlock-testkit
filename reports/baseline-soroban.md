# Gryd Lock evaluation — `soroban:CA42XDMAPI3QXA4XP6HEBPWD3IHZQ3YJB4MABSURASGGOVYU5QCWSC2M`

- **Oracle:** Live get_score() simulation against CA42XDMAPI3QXA4XP6HEBPWD3IHZQ3YJB4MABSURASGGOVYU5QCWSC2M via https://soroban-testnet.stellar.org
- **Dataset:** grydlock-testkit v0.2.0 — 73 destinations, 41 transaction XDRs
- **Generated:** 2026-11-09T19:45:17.749Z
- **Tier mapping:** low ≤ 20 → clean · elevated ≤ 50 and high ≤ 75 → suspicious · critical → malicious · no score → unscored (no warning)

## Headline

| Metric | Value |
| --- | ---: |
| Warning precision | 100.0% |
| Warning recall | 17.6% |
| False-positive rate (clean items warned) | 0.0% |
| Coverage (items with a score) | 14.0% |
| Exact-tier accuracy | 13.2% |
| Oracle call latency p50 / p95 | 3664.6 ms / 8769.1 ms (n = 134) |
| Per-fixture latency p50 / p95 | 5265.2 ms / 8833.5 ms (n = 114) |

## Per tier

### All fixtures (n = 114)

| Tier | Support | Predicted | Precision | Recall | F1 |
| --- | ---: | ---: | ---: | ---: | ---: |
| clean | 46 | 4 | 100.0% | 8.7% | 16.0% |
| suspicious | 27 | 5 | 100.0% | 18.5% | 31.3% |
| malicious | 41 | 7 | 85.7% | 14.6% | 25.0% |

Warning (suspicious or malicious) — precision 100.0%, recall 17.6%, **false-positive rate 0.0%**, coverage 14.0%, exact-tier accuracy 13.2%.

| label \ predicted | clean | suspicious | malicious | unscored |
| --- | ---: | ---: | ---: | ---: |
| **clean** | 4 | 0 | 0 | 42 |
| **suspicious** | 0 | 5 | 1 | 21 |
| **malicious** | 0 | 0 | 6 | 35 |

### Destinations (n = 73)

| Tier | Support | Predicted | Precision | Recall | F1 |
| --- | ---: | ---: | ---: | ---: | ---: |
| clean | 30 | 4 | 100.0% | 13.3% | 23.5% |
| suspicious | 16 | 3 | 100.0% | 18.8% | 31.6% |
| malicious | 27 | 5 | 100.0% | 18.5% | 31.3% |

Warning (suspicious or malicious) — precision 100.0%, recall 18.6%, **false-positive rate 0.0%**, coverage 16.4%, exact-tier accuracy 16.4%.

| label \ predicted | clean | suspicious | malicious | unscored |
| --- | ---: | ---: | ---: | ---: |
| **clean** | 4 | 0 | 0 | 26 |
| **suspicious** | 0 | 3 | 0 | 13 |
| **malicious** | 0 | 0 | 5 | 22 |

### Transactions (decode → score counterparties → riskiest tier) (n = 41)

| Tier | Support | Predicted | Precision | Recall | F1 |
| --- | ---: | ---: | ---: | ---: | ---: |
| clean | 16 | 0 | n/a | 0.0% | n/a |
| suspicious | 11 | 2 | 100.0% | 18.2% | 30.8% |
| malicious | 14 | 2 | 50.0% | 7.1% | 12.5% |

Warning (suspicious or malicious) — precision 100.0%, recall 16.0%, **false-positive rate 0.0%**, coverage 9.8%, exact-tier accuracy 7.3%.

| label \ predicted | clean | suspicious | malicious | unscored |
| --- | ---: | ---: | ---: | ---: |
| **clean** | 0 | 0 | 0 | 16 |
| **suspicious** | 0 | 2 | 1 | 8 |
| **malicious** | 0 | 0 | 1 | 13 |


## By risk pattern

| Risk pattern | Label | Support | Exact tier | Warned | Unscored |
| --- | --- | ---: | ---: | ---: | ---: |
| account-merge-drain | malicious | 5 | 0 | 0 | 5 |
| adversarial-clean | clean | 8 | 0 | 0 | 8 |
| claimable-balance-spam | malicious/suspicious | 3 | 0 | 0 | 3 |
| clawback-enabled | suspicious | 3 | 0 | 0 | 3 |
| cold-start | clean/malicious | 6 | 0 | 0 | 6 |
| memo-impersonation | suspicious | 3 | 0 | 0 | 3 |
| none | clean | 36 | 4 | 0 | 32 |
| pass-through | suspicious | 11 | 4 | 4 | 7 |
| phishing-drainer | malicious | 5 | 1 | 1 | 4 |
| rug-pull | malicious | 7 | 3 | 3 | 4 |
| scam-trustline | suspicious | 5 | 1 | 2 | 3 |
| signer-takeover | malicious | 6 | 0 | 0 | 6 |
| soroban-approval-drain | malicious | 4 | 0 | 0 | 4 |
| sponsored-mule | malicious/suspicious | 5 | 0 | 0 | 5 |
| sweep | malicious | 7 | 2 | 2 | 5 |

## Misclassified fixtures (99)

| Kind | Id | Persona | Risk pattern | Label | Predicted | Score | Direction |
| --- | --- | --- | --- | --- | --- | ---: | --- |
| destination | `GBFU36X3NY…HNBFOS` | clean-wallet-01 | none | clean | unscored | — | unscored |
| destination | `GCJF22UN37…SLJUPA` | clean-wallet-02 | none | clean | unscored | — | unscored |
| destination | `GD2EI4OMHB…OSDM2W` | clean-wallet-03 | none | clean | unscored | — | unscored |
| destination | `GDNYI5Z5DV…KZVRSF` | clean-wallet-04 | none | clean | unscored | — | unscored |
| destination | `GAKZOS4PCT…AHGQOO` | clean-wallet-05 | none | clean | unscored | — | unscored |
| destination | `GAF6FXYAB4…IDNWHT` | clean-wallet-06 | none | clean | unscored | — | unscored |
| destination | `GAAAPRSEMB…KSFN4Z` | clean-wallet-07 | none | clean | unscored | — | unscored |
| destination | `GD6TXWROHQ…3I4KF4` | clean-wallet-08 | none | clean | unscored | — | unscored |
| destination | `GAIPD6UEUS…A6FJBO` | clean-wallet-09 | none | clean | unscored | — | unscored |
| destination | `GC4UTYN5MK…5PGFZQ` | clean-wallet-10 | none | clean | unscored | — | unscored |
| destination | `GDDR64QMBH…XR3ZGD` | clean-wallet-11 | none | clean | unscored | — | unscored |
| destination | `GAW2UG4BGR…4BMVIB` | clean-wallet-12 | none | clean | unscored | — | unscored |
| destination | `GD5GBL7S5B…J5FJQZ` | clean-issuer-tusd | none | clean | unscored | — | unscored |
| destination | `GBHSSCCU5D…W4MFAM` | clean-distributor-tusd | none | clean | unscored | — | unscored |
| destination | `GBGWSHSIYN…3EH3CW` | clean-exchange-hot | none | clean | unscored | — | unscored |
| destination | `GBXNFWT7LD…KOMCEY` | clean-merchant-1 | none | clean | unscored | — | unscored |
| destination | `GDHOVLDRWG…BATJZU` | clean-merchant-2 | none | clean | unscored | — | unscored |
| destination | `GBWUBEGIUF…XZZMCN` | clean-relayer | none | clean | unscored | — | unscored |
| destination | `GB276PXQMD…F433OJ` | clean-cosigner | adversarial-clean | clean | unscored | — | unscored |
| destination | `GBV6FR3VVU…IGEWXL` | clean-dapp-spender | adversarial-clean | clean | unscored | — | unscored |
| destination | `GC45RHY6HT…65DCLN` | clean-savings | adversarial-clean | clean | unscored | — | unscored |
| destination | `GAZFRP5KJV…5FFYWA` | clean-high-velocity | adversarial-clean | clean | unscored | — | unscored |
| destination | `GBOWLGAUYC…PSZUUN` | clean-new-user | cold-start | clean | unscored | — | unscored |
| destination | `GD42RV27HM…WNHKHI` | clean-boundary | none | clean | unscored | — | unscored |
| destination | `GDZN4Q4BTN…7NSGZT` | pass-through-1 | pass-through | suspicious | unscored | — | unscored |
| destination | `GDTMMIJ34P…EPXR7N` | pass-through-2 | pass-through | suspicious | unscored | — | unscored |
| destination | `GA2BUDKBBV…XCCANL` | pass-through-3 | pass-through | suspicious | unscored | — | unscored |
| destination | `GCGNNVUBVI…2I7J6O` | pass-through-boundary | pass-through | suspicious | unscored | — | unscored |
| destination | `GDDUZFV6RN…BLVNPM` | scam-trustline-holder-1 | scam-trustline | suspicious | unscored | — | unscored |
| destination | `GDX5FIUEZB…3MSQKF` | scam-trustline-holder-2 | scam-trustline | suspicious | unscored | — | unscored |
| destination | `GC55SEG6OF…CP73XO` | sponsored-mule-1 | sponsored-mule | suspicious | unscored | — | unscored |
| destination | `GDADZAAGDI…CIONQB` | sponsored-mule-2 | sponsored-mule | suspicious | unscored | — | unscored |
| destination | `GDHFMEK3B2…4SMVPY` | sponsored-mule-3 | sponsored-mule | suspicious | unscored | — | unscored |
| destination | `GAVRLCQLYB…7337IG` | memo-impersonator-1 | memo-impersonation | suspicious | unscored | — | unscored |
| destination | `GB7LRM52TI…XE7NRN` | memo-impersonator-2 | memo-impersonation | suspicious | unscored | — | unscored |
| destination | `GAKZPSMQ5I…BBSUAC` | claw-issuer | clawback-enabled | suspicious | unscored | — | unscored |
| destination | `GCVPYQ3XTA…2OYNLL` | sweeper-1 | sweep | malicious | unscored | — | unscored |
| destination | `GA5DJT4EJK…URHBKT` | sweeper-2 | sweep | malicious | unscored | — | unscored |
| destination | `GBJKRDZJKY…USX34F` | sweeper-3 | sweep | malicious | unscored | — | unscored |
| destination | `GBW5SCORDK…BC2NTL` | merge-drainer-1 | account-merge-drain | malicious | unscored | — | unscored |
| destination | `GAR4BJKBE4…L2R6SN` | merge-drainer-2 | account-merge-drain | malicious | unscored | — | unscored |
| destination | `GD6LSHONMB…3CR5ZS` | merge-drainer-3 | account-merge-drain | malicious | unscored | — | unscored |
| destination | `GAIYX5ASWI…KMJ4BW` | takeover-attacker-1 | signer-takeover | malicious | unscored | — | unscored |
| destination | `GCCF57IS6Y…CIJNOR` | takeover-attacker-2 | signer-takeover | malicious | unscored | — | unscored |
| destination | `GBYHGCXYWO…DHTSZX` | takeover-attacker-3 | signer-takeover | malicious | unscored | — | unscored |
| destination | `GANEF5PKEN…XSIV2X` | phishing-drainer-1 | phishing-drainer | malicious | unscored | — | unscored |
| destination | `GD6LERCQFQ…JF6B6S` | phishing-drainer-2 | phishing-drainer | malicious | unscored | — | unscored |
| destination | `GCGZPQOH57…3AM2WP` | rug-issuer | rug-pull | malicious | unscored | — | unscored |
| destination | `GCEEOBWVRS…NUVVTP` | airdrop-issuer | claimable-balance-spam | malicious | unscored | — | unscored |
| destination | `GC4X3SL3SG…NXN5KP` | approval-drainer-1 | soroban-approval-drain | malicious | unscored | — | unscored |
| destination | `GBIRZS2KE6…H3XUJE` | approval-drainer-2 | soroban-approval-drain | malicious | unscored | — | unscored |
| destination | `GCRZEOWD6J…6GRYPA` | cold-start-scam-1 | cold-start | malicious | unscored | — | unscored |
| destination | `GBOMQDX24C…OW6GNP` | cold-start-scam-2 | cold-start | malicious | unscored | — | unscored |
| destination | `GCHW7QBOMD…V2ZSIL` | cold-start-scam-3 | cold-start | malicious | unscored | — | unscored |
| destination | `GCTCSJRFEG…G7TKVJ` | malicious-sponsor | sponsored-mule | malicious | unscored | — | unscored |
| destination | `TUSD:GD5GB…J5FJQZ` | asset-tusd | none | clean | unscored | — | unscored |
| destination | `CCNAXJS5ZQ…HWVGSH` | sac-tusd | none | clean | unscored | — | unscored |
| destination | `CLAW:GAKZP…BBSUAC` | asset-claw | clawback-enabled | suspicious | unscored | — | unscored |
| destination | `RUGX:GCGZP…3AM2WP` | asset-rugx | rug-pull | malicious | unscored | — | unscored |
| destination | `CA7ILM2HOA…62DTYS` | sac-rugx | rug-pull | malicious | unscored | — | unscored |
| destination | `AIRDROP:GC…NUVVTP` | asset-airdrop | claimable-balance-spam | malicious | unscored | — | unscored |
| transaction | `change_trust` |  | scam-trustline | suspicious | malicious | 97 | over-warn |
| transaction | `clean_payment_xlm` |  | none | clean | unscored | — | unscored |
| transaction | `clean_paym…rchant` |  | none | clean | unscored | — | unscored |
| transaction | `clean_paym…emo_id` |  | none | clean | unscored | — | unscored |
| transaction | `clean_path_strict_send` |  | none | clean | unscored | — | unscored |
| transaction | `clean_path…eceive` |  | none | clean | unscored | — | unscored |
| transaction | `clean_fee_bump_payment` |  | none | clean | unscored | — | unscored |
| transaction | `clean_change_trust_tusd` |  | none | clean | unscored | — | unscored |
| transaction | `clean_clai…e_tusd` |  | none | clean | unscored | — | unscored |
| transaction | `clean_soro…ansfer` |  | none | clean | unscored | — | unscored |
| transaction | `clean_soro…ounded` |  | adversarial-clean | clean | unscored | — | unscored |
| transaction | `clean_set_…signer` |  | adversarial-clean | clean | unscored | — | unscored |
| transaction | `clean_acco…wallet` |  | adversarial-clean | clean | unscored | — | unscored |
| transaction | `clean_multi_op_payroll` |  | adversarial-clean | clean | unscored | — | unscored |
| transaction | `clean_dex_sell_offer` |  | none | clean | unscored | — | unscored |
| transaction | `clean_payment_new_user` |  | cold-start | clean | unscored | — | unscored |
| transaction | `clean_paym…_score` |  | none | clean | unscored | — | unscored |
| transaction | `susp_payme…hrough` |  | pass-through | suspicious | unscored | — | unscored |
| transaction | `susp_path_…hrough` |  | pass-through | suspicious | unscored | — | unscored |
| transaction | `susp_payme…hrough` |  | pass-through | suspicious | unscored | — | unscored |
| transaction | `susp_payme…nation` |  | memo-impersonation | suspicious | unscored | — | unscored |
| transaction | `susp_chang…_asset` |  | clawback-enabled | suspicious | unscored | — | unscored |
| transaction | `susp_spons…eation` |  | sponsored-mule | suspicious | unscored | — | unscored |
| transaction | `susp_chang…_asset` |  | scam-trustline | suspicious | unscored | — | unscored |
| transaction | `susp_claim_airdrop_spam` |  | claimable-balance-spam | suspicious | unscored | — | unscored |
| transaction | `mal_path_payment_sweeper` |  | sweep | malicious | unscored | — | unscored |
| transaction | `mal_fee_bu…_drain` |  | phishing-drainer | malicious | unscored | — | unscored |
| transaction | `mal_set_op…keover` |  | signer-takeover | malicious | unscored | — | unscored |
| transaction | `mal_set_op…keover` |  | signer-takeover | malicious | unscored | — | unscored |
| transaction | `mal_account_merge_drain` |  | account-merge-drain | malicious | unscored | — | unscored |
| transaction | `mal_soroba…weeper` |  | sweep | malicious | unscored | — | unscored |
| transaction | `mal_soroba…imited` |  | soroban-approval-drain | malicious | unscored | — | unscored |
| transaction | `mal_soroba…native` |  | soroban-approval-drain | malicious | unscored | — | unscored |
| transaction | `mal_multi_op_bundle` |  | signer-takeover | malicious | unscored | — | unscored |
| transaction | `mal_multi_…_merge` |  | account-merge-drain | malicious | unscored | — | unscored |
| transaction | `mal_paymen…t_scam` |  | cold-start | malicious | unscored | — | unscored |
| transaction | `mal_path_buy_rug_token` |  | rug-pull | malicious | unscored | — | unscored |
| transaction | `mal_paymen…rainer` |  | phishing-drainer | malicious | unscored | — | unscored |
