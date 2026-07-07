# Gryd Lock Testkit 🧪

[![Built on Stellar](https://img.shields.io/badge/Built%20on-Stellar-blue?logo=stellar)](https://stellar.org)
[![Testnet](https://img.shields.io/badge/Network-Testnet-orange)](https://developers.stellar.org/docs/networks)
[![CI](https://github.com/Gryd-lock/grydlock-testkit/actions/workflows/ci.yml/badge.svg)](https://github.com/Gryd-lock/grydlock-testkit/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

Testnet fixtures and score stubs for evaluating Gryd Lock — so the tool can be tested end to end without a live scoring backend.

## Overview

Gryd Lock's warning layer is only useful if it can be measured. This repo provides the labelled inputs and stub scores that make the evaluation in `grydlock-research` actually executable on Stellar testnet.

### The Problem

Gryd Lock decodes transactions, scores destinations, and surfaces a warning tier — but without a known ground truth to check against, there's no way to tell whether a warning is accurate or how often it's wrong. Running the full pipeline against a live scoring backend also makes evaluation slow, non-deterministic, and dependent on infrastructure that may not exist yet.

### What Gryd Lock Testkit Does

At a high level, it does three things:

- **🏷️ Labels** — tags a set of Stellar testnet addresses and assets as `clean`, `suspicious`, or `malicious`, giving the evaluation a known ground truth to score against
- **📝 Stubs** — maps each labelled destination to a deterministic 0–100 score, so scoring can be tested without a live backend
- **🔁 Exercises** — provides sample unsigned transaction XDRs covering common shapes, so the decode step can be run and tested offline

## Features

- **Labelled Destinations**: a set of Stellar testnet addresses and assets tagged `clean`, `suspicious`, or `malicious`, so warnings can be checked against a known ground truth
- **Sample Transactions**: unsigned transaction XDRs covering common shapes (payment, path payment, change trust), used to test the decode step
- **Score Stubs**: a lookup table mapping each labelled destination to a 0–100 score, so the `StubOracle` in [`grydlock-oracle-adapter`](../grydlock-oracle-adapter) can return deterministic results with no network

## Repository Structure

```
grydlock-testkit/
├── README.md
├── LICENSE
├── package.json               # npm scripts (validate)
├── .github/workflows/ci.yml   # CI: runs the fixture validator
├── destinations.json          # address / asset → label (clean | suspicious | malicious)
├── scores.json                # destination → 0–100 stub score
├── scripts/
│   └── validate-fixtures.mjs  # checks destinations.json and scores.json are consistent
└── transactions/               # sample unsigned XDRs for the decode step
    ├── payment.xdr
    ├── path_payment.xdr
    └── change_trust.xdr
```

## Validating Fixtures

```bash
npm run validate
```

Checks that every destination in `destinations.json` has a matching entry in `scores.json`, every score is an integer in `0–100`, and every label is one of `clean`, `suspicious`, or `malicious`. Runs in CI on every push and pull request.

## How It's Used

- **`grydlock-oracle-adapter`** loads `scores.json` in its `StubOracle` to return scores without a live backend
- **The extension** is pointed at the stub oracle during development, so the full path — decode → score → tier → warning — runs entirely offline
- **`grydlock-research`** runs the extension across every entry in `destinations.json` and measures how often the assigned tier matches the label, producing the accuracy and false-positive numbers

## Roadmap

### Phase 1 — Fixture Assembly

- [x] Assemble an initial labelled destination set on testnet
- [x] Fill `scores.json` so the stub oracle is deterministic
- [x] Add sample XDRs covering the common Stellar operation types

### Phase 2 — Validation

- [x] Wire `StubOracle` in `grydlock-oracle-adapter` to read `scores.json` from this repo
- [ ] Once a live oracle exists, compare its scores against these stub labels to measure real accuracy

## Gryd Lock Organization

This repo is one of four in the [Gryd-lock](https://github.com/Gryd-lock) organization:

| Repo                                                                              | Role                                                                                             |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **[`grydlock-extension`](https://github.com/Gryd-lock/grydlock-extension)**       | Browser extension that warns you before you sign a risky Stellar transaction                     |
| **[`grydlock-oracle-adapter`](https://github.com/Gryd-lock/grydlock-oracle-adapter)** | Fetches a 0–100 on-chain risk score for a Stellar address via Soroban; its `StubOracle` reads `scores.json` from this repo for deterministic offline scoring |
| **[`grydlock-research`](https://github.com/Gryd-lock/grydlock-research)**         | Design study, threat model, and evaluation methodology; runs the extension across `destinations.json` and measures warning accuracy against the labels |
| **[`grydlock-testkit`](https://github.com/Gryd-lock/grydlock-testkit)** _(this repo)_ | Testnet fixtures, labelled destinations, and score stubs used to test the full pipeline offline  |

## License

MIT

---

<div align="center">

**Gryd Lock Testkit** — Fixtures for a warning layer you can actually measure.

_Built for Stellar testnet evaluation._

</div>
