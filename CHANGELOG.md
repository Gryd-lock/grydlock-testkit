# Changelog

All notable changes to the testkit fixtures (destinations, scores, and sample transactions) are documented here.

This file follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) conventions.
Version numbers track the fixture dataset, not a software release.

> **Why this matters:** `grydlock-oracle-adapter` and `grydlock-research` depend on the exact
> contents of `destinations.json` and `scores.json`. Changes to those files are consequential to
> downstream consumers. This log lets a consumer understand at a glance what changed between two
> points in time, without diffing raw JSON.

---

## [Unreleased]

### Changed — Destinations
- Added the required per-fixture `fixture_status` field; all existing destinations are marked `synthetic-only`.


### Added — Scenario Bundles (`scenarios/`)

- Introduced versioned scenario bundles (`schema_version` `1.0`) for deterministic, offline, multi-transaction attack workflows. A scenario groups participants, destination/transaction references, and ordered steps with machine-checkable expected warnings and state transitions.
- Added `scenarios/phishing-drain.json`, an executable synthetic example (initial funding → suspicious pass-through interaction → phishing-drainer drain).
- Added scenario validation and replay tooling: `scripts/validate-scenarios.mjs`, `scripts/replay-scenario.mjs`, and `scripts/lib/scenario.mjs` (plus a shared `scripts/lib/taxonomy.mjs`). Wired into `npm run validate`, `npm run replay`, and `npm test`.

<!-- Add entries here as fixtures change. See CONTRIBUTING.md for the required format. -->


---

## [0.1.0] — 2026-07-07

Initial fixture baseline. Establishes 12 labelled testnet destinations (4 clean, 3 suspicious,
4 malicious accounts + 1 malicious asset), their corresponding stub scores, and 3 sample
unsigned transaction XDRs.

### Added — Destinations (`destinations.json`)

| ID | Type | Label | Notes |
|----|------|-------|-------|
| `GCRRYBV5IY7DSI54DKW33ZELC2LWYCAHC43TXAM2A2HTFN5GWOFWXPC2` | account | clean | Established testnet wallet with regular payment history; no red flags. |
| `GA4HFFSHZ7PADQWOFCZGYV2HE437LQ2WDILWCGC33BMJUQ6OBO5HKI5D` | account | clean | Long-lived wallet, low transaction velocity, no shared funding source with flagged accounts. |
| `GCER76PMMAKI2S6UUCPOFXC4SMY3IEILVE5MKSX4CTNDXXIZMFDXJJVS` | account | clean | Holds a USDC trustline against `usdc_issuer`; normal trading activity. |
| `GBWPMNXNRLA3VMBTWZHWN7VLUZPXBZUEOMPD6OIQKYCZNDJ2SY4ACC5B` | account | clean | Fixture stand-in for a well-known, long-lived asset issuer (issues USDC). |
| `GCRNKXJJLZNDLK2EWPX25JISTORCXCF2HYUXMYKF7XWKHMEOHCXVGP4J` | account | suspicious | Funded seconds before a large outgoing payment burst; pattern consistent with a pass-through wallet. |
| `GDL4JRQOHLJARTSQMZCBANXJ6GI6BN2QG2TX6ZPC5KSHKJCDEM735BYJ` | account | suspicious | Shares a funding source with `malicious_wallet_1` and `malicious_wallet_2`. |
| `GCHYSQ57SVW6LFLGLQ4P77ZDQJ7BPQIM3QOCPIBIZKXGZGAQMJQZRFMS` | account | suspicious | Holds a trustline to the SCAM asset; no other activity. |
| `GD7XPB2A7CG5Z4ICV24B3LXCRHAEJRFEK4OEW3ZIOQAPJOHAXBB7QHGE` | account | malicious | Path-payment sweep pattern: drains newly funded wallets within seconds of receiving deposits. |
| `GCAMGLMB5EN55ICM26RYDGZSE5P4GKMK6TD6ZB7LACMVE7IEDTWVYZDF` | account | malicious | Repeated small "test" payments precede a large drain; matches a known phishing-drainer shape. |
| `GDQPZVGOJY6Q4PPASHZBIFN3PTIBD6WCRDCCAIFIPHZIYKSDQ7PZWPNJ` | account | malicious | Destination of multiple change-trust + immediate max-sell patterns typical of rug-pull collection wallets. |
| `GAJLLIIPHII6OCG4KQJIGPCHVN6DNCRBXHX6DEUTPE7MQ6OONAYBRLET` | account | malicious | Issuer of the SCAM asset; no distributed supply outside the issuer's own control. |
| `SCAM:GAJLLIIPHII6OCG4KQJIGPCHVN6DNCRBXHX6DEUTPE7MQ6OONAYBRLET` | asset | malicious | Newly issued token with no liquidity outside the issuer; classic rug-pull setup. |

### Added — Scores (`scores.json`)

Stub scores assigned to each destination for deterministic offline evaluation via `StubOracle`:

| Destination | Score | Tier |
|-------------|-------|------|
| `GCRRYBV5IY7DSI54DKW33ZELC2LWYCAHC43TXAM2A2HTFN5GWOFWXPC2` | 4 | clean |
| `GA4HFFSHZ7PADQWOFCZGYV2HE437LQ2WDILWCGC33BMJUQ6OBO5HKI5D` | 6 | clean |
| `GCER76PMMAKI2S6UUCPOFXC4SMY3IEILVE5MKSX4CTNDXXIZMFDXJJVS` | 3 | clean |
| `GBWPMNXNRLA3VMBTWZHWN7VLUZPXBZUEOMPD6OIQKYCZNDJ2SY4ACC5B` | 2 | clean |
| `GCRNKXJJLZNDLK2EWPX25JISTORCXCF2HYUXMYKF7XWKHMEOHCXVGP4J` | 55 | suspicious |
| `GDL4JRQOHLJARTSQMZCBANXJ6GI6BN2QG2TX6ZPC5KSHKJCDEM735BYJ` | 62 | suspicious |
| `GCHYSQ57SVW6LFLGLQ4P77ZDQJ7BPQIM3QOCPIBIZKXGZGAQMJQZRFMS` | 58 | suspicious |
| `GD7XPB2A7CG5Z4ICV24B3LXCRHAEJRFEK4OEW3ZIOQAPJOHAXBB7QHGE` | 92 | malicious |
| `GCAMGLMB5EN55ICM26RYDGZSE5P4GKMK6TD6ZB7LACMVE7IEDTWVYZDF` | 89 | malicious |
| `GDQPZVGOJY6Q4PPASHZBIFN3PTIBD6WCRDCCAIFIPHZIYKSDQ7PZWPNJ` | 85 | malicious |
| `GAJLLIIPHII6OCG4KQJIGPCHVN6DNCRBXHX6DEUTPE7MQ6OONAYBRLET` | 95 | malicious |
| `SCAM:GAJLLIIPHII6OCG4KQJIGPCHVN6DNCRBXHX6DEUTPE7MQ6OONAYBRLET` | 97 | malicious |

### Added — Sample Transactions (`transactions/`)

| File | Operation type | Purpose |
|------|---------------|---------|
| `transactions/payment.xdr` | Payment | Tests the decode step for a simple XLM/asset transfer. |
| `transactions/path_payment.xdr` | Path Payment Strict Send | Tests multi-hop path-payment decoding. |
| `transactions/change_trust.xdr` | Change Trust | Tests trustline-establishment decoding. |

---

[Unreleased]: https://github.com/Gryd-lock/grydlock-testkit/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Gryd-lock/grydlock-testkit/releases/tag/v0.1.0
