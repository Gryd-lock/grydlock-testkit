# Sample Transactions

Unsigned transaction XDRs (testnet, `Networks.TESTNET` passphrase) used to test the decode step. Each file holds one base64 XDR envelope. None are signed or submitted — they exist purely as decode input.

Decode with the Stellar SDK, e.g.:

```ts
import { TransactionBuilder, Networks } from '@stellar/stellar-sdk';
import { readFileSync } from 'fs';

const xdr = readFileSync('transactions/payment.xdr', 'utf-8').trim();
const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET);
```

Addresses match the `id` values in [`../destinations.json`](../destinations.json).

## Fixture format

Each fixture is documented as its own subsection below rather than a single flat table, so a fixture can carry an arbitrary, ordered list of operations plus the envelope-level metadata that only makes sense per-transaction (fee bump, memo, time bounds). This is the format all future fixture files (multi-operation, fee-bump, sponsored reserve, claimable balance, memo, time-bounds fixtures) should follow.

A fixture subsection has:

- **Envelope** — a small table of transaction-level metadata:
  | Field | Meaning |
  | --- | --- |
  | Fee Bump | `no`, or `yes (outer fee source: <id>)` for a fee-bump envelope — the outer envelope's fee source, distinct from the inner transaction's source |
  | Source | the (inner, if fee-bumped) transaction's source account `id` |
  | Memo | `none`, or the memo type + value (`text`, `id`, `hash`, `return`) |
  | Time Bounds | `none`, or `min <unix>` / `max <unix>` (0 means unbounded on that side) |
- **Operations** — an ordered list/table, one row per operation in envelope order:
  | # | Operation | Op Source | Params |
  | --- | --- | --- | --- |
  | 0 | `payment` | (same as tx source) | destination, asset, amount |

  `Op Source` is only filled in when an operation's source differs from the transaction source (Stellar allows per-operation source override). `Params` covers whatever's relevant to that operation type — for `payment`/`pathPaymentStrictSend`/`pathPaymentStrictReceive`: destination + asset(s) + amount; for `changeTrust`: asset + limit; for `createClaimableBalance`: asset, amount, claimants; for `claimClaimableBalance`: balance ID; for sponsorship ops (`beginSponsoringFutureReserves`/`endSponsoringFutureReserves`): sponsored/sponsoring account; addresses may be a classic `G...` account, a muxed `M...` address, a pool `L...` (liquidity pool) ID, or a contract `C...` address — call out the address kind explicitly whenever it isn't a plain classic account.

## Current fixtures

### `payment.xdr`

**Envelope**

| Field | Value |
| --- | --- |
| Fee Bump | no |
| Source | `clean_wallet_1` |
| Memo | none |
| Time Bounds | none |

**Operations**

| # | Operation | Op Source | Params |
| --- | --- | --- | --- |
| 0 | `payment` (native XLM) | — | destination: `suspicious_wallet_1` |

### `path_payment.xdr`

**Envelope**

| Field | Value |
| --- | --- |
| Fee Bump | no |
| Source | `clean_wallet_1` |
| Memo | none |
| Time Bounds | none |

**Operations**

| # | Operation | Op Source | Params |
| --- | --- | --- | --- |
| 0 | `pathPaymentStrictSend` (XLM → USDC) | — | destination: `malicious_wallet_1` |

### `change_trust.xdr`

**Envelope**

| Field | Value |
| --- | --- |
| Fee Bump | no |
| Source | `suspicious_wallet_1` |
| Memo | none |
| Time Bounds | none |

**Operations**

| # | Operation | Op Source | Params |
| --- | --- | --- | --- |
| 0 | `changeTrust` (SCAM asset) | — | no destination — trustline change only |
