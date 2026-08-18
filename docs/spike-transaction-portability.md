# Spike: Transaction Fixture Network and Envelope Portability

**Status:** Complete  
**Date:** 2026-08-18  
**Spike question:** Should fixtures remain TESTNET-only, or support multiple passphrases, signed envelopes, fee bumps, and network variants?

---

## 1. Current state inventory

All three existing fixtures share the same assumptions. None of these assumptions are written into code in this repo — they live only in `transactions/README.md`.

| Property | Current value |
|----------|--------------|
| Network | TESTNET only (`"Test SDF Network ; September 2015"`) |
| Passphrase recorded in fixture | No — README prose only |
| Envelope type | `envelopeTypeTx` (v1) on all three |
| Signed | No — 0 signatures in every envelope |
| Fee-bump | No |
| Sequence numbers | Hardcoded (2, 3, 4) |
| Memo | None |
| Time bounds | None |
| Fixture metadata | Only in `transactions/README.md`; not machine-readable |
| Hash recorded in manifest | No — XDR files are hashed by `evaluation-manifest.json` but their transaction hashes are not recorded |

### What the SDK actually does with the passphrase

`TransactionBuilder.fromXDR(xdr, passphrase)` does **not** validate the passphrase against anything inside the binary envelope. The passphrase is recorded in the in-memory `Transaction` object and used only for hash computation. A decoder that passes the wrong passphrase will parse the envelope identically, extract the same operations, but compute a wrong transaction hash — silently, with no error.

Verified empirically:

```
payment.xdr decoded under TESTNET: hash = f8310e15...
payment.xdr decoded under PUBLIC:  hash = 80b951be...   ← different, no error thrown
Operations: identical in both cases
Source:     identical in both cases
```

This means the network tag is a caller responsibility, not an envelope property. Any consumer that omits the passphrase, or defaults to PUBLIC, will get wrong hashes from TESTNET fixtures.

---

## 2. Areas investigated

### 2a. PUBLIC vs TESTNET passphrases

| Concern | TESTNET only | Multi-network |
|---------|-------------|---------------|
| XDR encoding | Passphrase-agnostic — same bytes regardless | Same: XDR does not embed passphrase |
| Hash | TESTNET hash ≠ PUBLIC hash for same XDR | Each variant needs its own recorded hash |
| Signature validity | A TESTNET signature is invalid on PUBLIC | Separate signed fixtures per network |
| Decoder assumption | Consumer must know to pass `Networks.TESTNET` | Consumer must read metadata to pick passphrase |
| Risk of silent bug | Consumer defaults to PUBLIC → wrong hash | Explicit metadata prevents this |
| Scope | Contained to this repo | Requires grydlock-extension to handle both |

**Finding:** Supporting PUBLIC addresses is out of scope (all fixture addresses are synthetic testnet-only; they have no meaning on PUBLIC). Supporting an alternative TESTNET-like passphrase (FUTURENET) adds no evaluation value. The correct action is to make TESTNET explicit in a machine-readable fixture index rather than adding a second network.

### 2b. Signed vs unsigned envelopes

Currently all fixtures are unsigned. The extension's decode step only needs the envelope structure (operation type, source, destination, asset) — it does not verify signatures before warning the user. Signing requires a secret key, which is explicitly excluded from the repo by `scripts/check-secrets.mjs`.

| Concern | Unsigned (current) | Signed |
|---------|-------------------|--------|
| Decode step | Fully exercised | Fully exercised |
| Signature verification | Not tested | Testable |
| Secret key required | No | Yes — cannot commit |
| Reproducibility | Deterministic | Non-deterministic without fixed keypair |
| Security risk | None | Low, but seeding a test keypair is boilerplate |
| Extension relevance | Covers the warn-before-sign path | Would cover the already-signed path |

**Finding:** Unsigned fixtures are correct for the decode/warn use case. A signed fixture would only add value if the extension gains a "verify before relay" feature. For now, unsigned is the right constraint.

### 2c. Fee-bump envelopes (`envelopeTypeFeeBump`)

Fee-bump transactions are a distinct envelope type (`envelopeTypeTxFeeBump` in XDR). The Stellar SDK's `TransactionBuilder.fromXDR` returns a `FeeBumpTransaction` object (a different class from `Transaction`). A decoder that only handles `Transaction` will fail or silently misclassify a fee-bump envelope.

Prototype produced during this spike (wrapping `payment.xdr`):

```
XDR:           AAAABQ...
Envelope type: envelopeTypeTxFeeBump
Fee-bump source (outer): GA4HFFSHZ7PADQWOFCZGYV2HE437LQ2WDILWCGC33BMJUQ6OBO5HKI5D
Inner tx source:         GCRRYBV5IY7DSI54DKW33ZELC2LWYCAHC43TXAM2A2HTFN5GWOFWXPC2
Hash (TESTNET):          7ab7ae0df710a6d37484f403f7d2ccd14b88832c843b961cd5f52311a027876f
```

The fee-bump source and the inner-transaction source are different accounts. From a risk-scoring perspective:
- The **inner** transaction's source is the account the user controls.
- The **outer** fee-bump source pays the fee — this can be any third party.
- The **inner** transaction's operations contain the destinations that need scoring.

A decoder that extracts `tx.source` from a fee-bump will get the fee-bump source (outer), not the inner transaction's source — a silent, semantically wrong result if the two differ.

### 2d. Transaction hash implications

The transaction hash is the canonical identifier on the Stellar network. It is determined by:

```
hash = SHA-256(passphrase_hash || tx_xdr_bytes)
```

Where `passphrase_hash = SHA-256(passphrase_string)`.

Consequences:
- Changing the passphrase changes the hash even with identical XDR.
- A fee-bump transaction has its own hash, distinct from its inner transaction's hash.
- The fixture XDR files are hashed by `evaluation-manifest.json` (file content SHA-256), which is independent of the Stellar transaction hash.

| Hash type | What it covers | Where it lives |
|-----------|---------------|----------------|
| File SHA-256 | Exact bytes of the `.xdr` file | `evaluation-manifest.json` |
| Stellar tx hash (TESTNET) | Canonical identifier on the Stellar TESTNET ledger | Not recorded anywhere currently |
| Stellar tx hash (PUBLIC) | Different value — meaningless for synthetic fixtures | N/A |

**Finding:** Recording the Stellar transaction hash alongside each fixture in a `transactions/index.json` would allow consumers to verify they are decoding the fixture correctly (compute hash with their passphrase, compare to recorded value). This is a low-cost addition.

### 2e. Fixture metadata and naming

Currently:
- Fixture content is documented in `transactions/README.md` (human-readable only).
- No machine-readable index exists.
- The `evaluation-manifest.json` hashes the XDR files but records nothing about their semantics (envelope type, network, operations, expected hashes).

A machine-readable `transactions/index.json` would let consumers:
- Know the passphrase to use before decoding.
- Detect the envelope type without parsing the XDR.
- Verify the Stellar transaction hash after decoding.
- Understand which fixture addresses correspond to which semantic scenarios.

### 2f. Deterministic generation

All three existing fixtures appear to have been hand-constructed (no generation script exists despite `CONTRIBUTING.md` requiring one for new XDR fixtures). For reproducibility:
- The XDR itself is deterministic given fixed inputs (source, sequence, operations, fee).
- A script that generates fixtures from a JSON spec would make re-creation auditable.
- Fee bumps and alternative envelope types should be generated, not hand-edited.

---

## 3. Portability strategy comparison

### Strategy A — TESTNET-only, extend coverage explicitly

Keep TESTNET as the sole network. Add a machine-readable `transactions/index.json` that records the passphrase, envelope type, Stellar transaction hash, and per-operation metadata. Add a fee-bump fixture. Do not add signed fixtures yet.

| Criterion | Score | Notes |
|-----------|-------|-------|
| Realism | ✅ | TESTNET is the correct context for all fixture addresses |
| Reproducibility | ✅ | Deterministic: passphrase is fixed, hashes are recorded |
| Security | ✅ | No secret keys; `check-secrets.mjs` continues to apply |
| Consumer complexity | ✅ Low | One passphrase, one code path |
| Storage | ✅ Minimal | One XDR file per fixture type |
| Compatibility | ✅ | No downstream changes needed for current consumers |
| Extension decoder | ⚠️ | Still needs fee-bump handling; index makes the gap detectable |
| Migration | None needed | Index and fee-bump fixture are additive |

### Strategy B — Multi-network support

Add a `network` field to each fixture (TESTNET or PUBLIC). Ship both TESTNET and PUBLIC variants of each fixture.

| Criterion | Score | Notes |
|-----------|-------|-------|
| Realism | ❌ | Fixture addresses are synthetic testnet addresses — they are meaningless on PUBLIC |
| Reproducibility | ⚠️ | Requires maintaining parallel fixture sets |
| Security | ✅ | Still unsigned |
| Consumer complexity | ❌ High | Two code paths, disambiguation logic, risk of wrong passphrase being used |
| Storage | ❌ | Doubles fixture count with no evaluation benefit |
| Compatibility | ❌ | Breaking: evaluation-manifest.json would need network tagging; downstream consumers need updates |
| Migration | Significant | All consumers need passphrase-selection logic |

**Recommendation: Strategy A.** Multi-network support adds complexity and storage with no evaluation benefit given that fixture addresses are synthetic TESTNET data. The correct path is making TESTNET explicit in machine-readable metadata and adding the missing envelope type coverage.

---

## 4. Prototype

A fee-bump envelope wrapping `payment.xdr` was generated during this spike:

**`transactions/fee_bump_payment.xdr`** (prototype — not committed yet):

```
AAAABQAAAAA4cpZHz94Bws4osmxXRyc39cNWGhdhGFvYWJpDzgu6dQAAAAAAAAPoAAAAAgAAAACjHAa9
Rj45I7warb3kixaXbAgHFzc7gZoGjzK3prOLawAAAGQAAAAAAAAAAgAAAAEAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAEAAAAAAAAAAQAAAACi1V0pXlo1q0Sz766lEpuiK4i6Pil2YUX97KOwjjivUwAAAAAAAAAAH
c1lAAAAAAAAAAAAAAAAAAAAAAA=
```

| Field | Value |
|-------|-------|
| Envelope type | `envelopeTypeTxFeeBump` |
| Fee-bump source (outer) | `GA4HFFSHZ7PADQWOFCZGYV2HE437LQ2WDILWCGC33BMJUQ6OBO5HKI5D` (`clean_wallet_2`) |
| Inner tx source | `GCRRYBV5IY7DSI54DKW33ZELC2LWYCAHC43TXAM2A2HTFN5GWOFWXPC2` (`clean_wallet_1`) |
| Inner operation | `payment` to `GCRNKXJJLZNDLK2EWPX25JISTORCXCF2HYUXMYKF7XWKHMEOHCXVGP4J` (`suspicious_wallet_1`) |
| Outer fee | 500 stroops |
| Inner fee | 100 stroops |
| Signed | No |
| Stellar hash (TESTNET) | `7ab7ae0df710a6d37484f403f7d2ccd14b88832c843b961cd5f52311a027876f` |

This prototype exercises the decoder's fee-bump path: the destination being scored is inside the inner transaction, not at the top level of the outer envelope.

---

## 5. Hash / signature / passphrase implications summary

| Scenario | What changes | What breaks if wrong |
|----------|-------------|---------------------|
| Wrong passphrase on decode | Transaction hash is wrong | Hash-based ledger lookups, signature verification |
| Decoder reads `.source` on a fee-bump | Gets outer fee source, not inner tx source | Wrong account attributed as the transaction initiator |
| Decoder skips `.operations` traversal in fee-bump | Misses inner operations | Risk scoring fails silently — no destinations extracted |
| XDR file modified | File SHA-256 changes → `verify-manifest` catches it | N/A (manifest hash catches this) |
| Fixture used without consulting index | Consumer guesses passphrase | Wrong hash on a TESTNET fixture decoded as PUBLIC |

---

## 6. Recommendations

1. **Add `transactions/index.json`** — machine-readable index recording for each fixture: filename, `network`, `passphrase`, `envelopeType`, `signed`, `stellarHashTestnet`, a `description`, and a `sources`/`destinations` summary. This is the minimal change that closes the silent-wrong-passphrase risk.

2. **Add a fee-bump fixture** (`transactions/fee_bump_payment.xdr`) using the prototype above. Update `transactions/README.md` and `transactions/index.json`. This is the highest-value missing envelope type — it exercises a decoder code path that currently has no test coverage.

3. **Add `transactions/index.json` to `evaluation-manifest.json` inputs** — hash it alongside the XDR files so the manifest covers the metadata too.

4. **Do not add PUBLIC fixtures** — the fixture addresses are synthetic TESTNET data. A PUBLIC variant would produce a different hash but identical operations, adding no evaluation signal and significant consumer confusion.

5. **Do not add signed fixtures yet** — signed fixtures require a test keypair (or a deterministic derivation), add `check-secrets.mjs` complexity, and do not cover any extension decode path that unsigned fixtures miss. Revisit when the extension gains a verify-before-relay feature.

6. **Add a generation script** — CONTRIBUTING.md already requires new XDR fixtures to come from a script. A `scripts/generate-transactions.mjs` driven by a JSON spec would make all fixtures reproducible from scratch without the Stellar SDK being installed permanently.

---

## 7. Follow-up issues

| Issue | Priority | Owner |
|-------|----------|-------|
| Add `transactions/index.json` with passphrase and hash fields | High | testkit |
| Add `fee_bump_payment.xdr` fixture | High | testkit |
| Add fee-bump decode path to grydlock-extension decoder | High | extension |
| Add `scripts/generate-transactions.mjs` | Medium | testkit |
| Document fee-bump inner-vs-outer source in extension decoder | Medium | extension |
| Investigate muxed account (`M...`) address handling in decoder | Low | extension |
