# Gryd Lock Testkit 🧪

[![Built on Stellar](https://img.shields.io/badge/Built%20on-Stellar-blue?logo=stellar)](https://stellar.org)
[![Testnet](https://img.shields.io/badge/Network-Testnet-orange)](https://developers.stellar.org/docs/networks)
[![Status](https://img.shields.io/badge/status-fixture%20set%20being%20assembled-yellow)](#roadmap)

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
