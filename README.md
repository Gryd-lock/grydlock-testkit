# Gryd Lock Testkit

[![Built on Stellar](https://img.shields.io/badge/Built%20on-Stellar-blue?logo=stellar)](https://stellar.org)
[![Testnet](https://img.shields.io/badge/Network-Testnet-orange)](https://developers.stellar.org/docs/networks)
[![CI](https://github.com/Gryd-lock/grydlock-testkit/actions/workflows/ci.yml/badge.svg)](https://github.com/Gryd-lock/grydlock-testkit/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

Testnet fixtures and score stubs for evaluating Gryd Lock - so the tool can be tested end to end without a live scoring backend.

## Overview

Gryd Lock's warning layer is only useful if it can be measured. This repo provides the labelled inputs and stub scores that make the evaluation in grydlock-research actually executable on Stellar testnet.

## Features

- Labelled Destinations: Stellar testnet addresses and assets tagged clean, suspicious, or malicious
- Sample Transactions: unsigned transaction XDRs covering payment, path payment, change trust
- Score Stubs: lookup table mapping each destination to a 0-100 score for deterministic offline scoring

## Repository Structure

grydlock-testkit/
  README.md
  LICENSE
  package.json
  .github/workflows/ci.yml
  destinations.json
  scores.json
  scripts/validate-fixtures.mjs
  transactions/
    payment.xdr
    path_payment.xdr
    change_trust.xdr

## Validating Fixtures

npm run validate

Checks that every destination in destinations.json has a matching entry in scores.json, every score is an integer in 0-100, and every label is one of clean, suspicious, or malicious.

## How It's Used

- grydlock-oracle-adapter loads scores.json in its StubOracle to return scores without a live backend
- The extension is pointed at the stub oracle during development, so the full path - decode, score, tier, warning - runs entirely offline
- grydlock-research runs the extension across every entry in destinations.json and measures how often the assigned tier matches the label

## Pinning to a Release

Consumers should pin to a specific tagged release rather than tracking the main branch. This ensures fixture changes do not silently alter evaluation results.

Example: grydlock-oracle-adapter pins to v0.1.0 by referencing the tag in its dependency configuration or downloading the release asset:

git clone --branch v0.1.0 https://github.com/Gryd-lock/grydlock-testkit.git

Releases are tagged with semantic versions matching package.json and CHANGELOG.md. Each release includes notes from the corresponding CHANGELOG section.

## Gryd Lock Organization

| Repo | Role |
|------|------|
| grydlock-extension | Browser extension that warns before signing risky Stellar transactions |
| grydlock-oracle-adapter | Fetches on-chain risk scores via Soroban; StubOracle reads scores.json from this repo |
| grydlock-research | Design study, threat model, and evaluation methodology |
| grydlock-testkit (this repo) | Testnet fixtures, labelled destinations, and score stubs |

## License

MIT
