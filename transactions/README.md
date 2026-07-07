# Sample Transactions

Unsigned transaction XDRs (testnet, `Networks.TESTNET` passphrase) used to test the decode step. Each file holds one base64 XDR envelope. None are signed or submitted — they exist purely as decode input.

| File                | Operation             | Source                | Destination            |
| ------------------- | ---------------------- | ---------------------- | ----------------------- |
| `payment.xdr`        | `payment` (native XLM) | `clean_wallet_1`       | `suspicious_wallet_1`  |
| `path_payment.xdr`   | `pathPaymentStrictSend` (XLM → USDC) | `clean_wallet_1` | `malicious_wallet_1`   |
| `change_trust.xdr`   | `changeTrust` (SCAM asset) | `suspicious_wallet_1` | — (trustline, no destination) |

Addresses match the `id` values in [`../destinations.json`](../destinations.json). Decode with the Stellar SDK, e.g.:

```ts
import { TransactionBuilder, Networks } from '@stellar/stellar-sdk';
import { readFileSync } from 'fs';

const xdr = readFileSync('transactions/payment.xdr', 'utf-8').trim();
const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET);
```
