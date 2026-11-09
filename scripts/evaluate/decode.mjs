/**
 * Transaction decode + destination extraction.
 *
 * Faithful port of grydlock-extension `src/decode/decodeTransaction.ts`
 * (extractDestination / extractDecodedDestination), split so a malformed
 * XDR fails at `decode` rather than looking like "no destinations".
 */
import { Asset, FeeBumpTransaction, Networks, TransactionBuilder } from '@stellar/stellar-sdk';

const NETWORK_MAP = {
  PUBLIC: Networks.PUBLIC,
  TESTNET: Networks.TESTNET,
  FUTURENET: Networks.FUTURENET,
  SANDBOX: Networks.SANDBOX,
};

export function resolveNetworkPassphrase(networkOrPassphrase = Networks.PUBLIC) {
  return NETWORK_MAP[networkOrPassphrase.toUpperCase()] ?? networkOrPassphrase;
}

function assetLabel(asset) {
  if (!asset || asset.isNative()) return undefined;
  return `${asset.getCode()}:${asset.getIssuer()}`;
}

function destinationsFor(op) {
  switch (op.type) {
    case 'payment':
      return { destinations: [op.destination], asset: assetLabel(op.asset) };
    case 'pathPaymentStrictSend':
    case 'pathPaymentStrictReceive':
      return { destinations: [op.destination], asset: assetLabel(op.destAsset) };
    case 'createAccount':
      return { destinations: [op.destination] };
    case 'createClaimableBalance':
      return {
        destinations: op.claimants.map((claimant) => claimant.destination),
        asset: assetLabel(op.asset),
      };
    case 'claimClaimableBalance':
      return { destinations: [op.balanceId] };
    default:
      return { destinations: [] };
  }
}

function memoValue(memo) {
  switch (memo.type) {
    case 'text':
      return memo.value === null ? undefined : { type: 'text', value: memo.value.toString() };
    case 'id':
      return memo.value === null ? undefined : { type: 'id', value: memo.value.toString() };
    case 'hash':
      return memo.value === null ? undefined : { type: 'hash', value: Buffer.from(memo.value).toString('hex') };
    case 'return':
      return memo.value === null ? undefined : { type: 'return', value: Buffer.from(memo.value).toString('hex') };
    default:
      return undefined;
  }
}

function mergeDestination(seen, destination, asset) {
  const existing = seen.get(destination);
  if (!seen.has(destination) || (!existing && asset)) {
    seen.set(destination, asset);
  }
}

export function extractDecodedDestination(tx) {
  const seen = new Map();

  for (const op of tx.operations) {
    const resolved = destinationsFor(op);
    for (const destination of resolved.destinations) {
      mergeDestination(seen, destination, resolved.asset);
    }
  }

  if (seen.size === 0) return null;

  return {
    destinations: Array.from(seen, ([destination, asset]) => ({ destination, asset })),
    memo: tx.memo ? memoValue(tx.memo) : undefined,
  };
}

/**
 * Parse an XDR envelope. Distinguishes malformed input from a valid
 * transaction that simply has no scoreable destinations.
 */
export function decodeTransactionXdr(xdr, networkPassphrase = Networks.TESTNET) {
  try {
    const parsed = TransactionBuilder.fromXDR(
      String(xdr).trim(),
      resolveNetworkPassphrase(networkPassphrase),
    );
    const tx = parsed instanceof FeeBumpTransaction ? parsed.innerTransaction : parsed;
    return { ok: true, tx };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Extension-compatible helper: null on malformed XDR *or* no destinations.
 * Prefer decodeTransactionXdr + extractDecodedDestination for staged evaluation.
 */
export function extractDestination(xdr, networkPassphrase = Networks.TESTNET) {
  const decoded = decodeTransactionXdr(xdr, networkPassphrase);
  if (!decoded.ok) return null;
  return extractDecodedDestination(decoded.tx);
}
