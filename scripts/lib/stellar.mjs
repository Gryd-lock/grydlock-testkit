// Decode helpers shared by the testnet generator, the XDR validator and the
// evaluation runner. Everything here is pure: decode an envelope, summarise
// its operations, and extract the counterparties a risk oracle would be asked
// to score. No network access.

import {
  TransactionBuilder,
  FeeBumpTransaction,
  Networks,
  StrKey,
  Address,
  scValToNative,
  xdr
} from '@stellar/stellar-sdk';

export const TESTNET_PASSPHRASE = Networks.TESTNET;

export function decodeEnvelope(base64, passphrase = TESTNET_PASSPHRASE) {
  return TransactionBuilder.fromXDR(base64.trim(), passphrase);
}

export function isFeeBump(tx) {
  return tx instanceof FeeBumpTransaction;
}

export function innerOf(tx) {
  return isFeeBump(tx) ? tx.innerTransaction : tx;
}

export function envelopeTypeOf(tx) {
  return isFeeBump(tx) ? 'envelopeTypeTxFeeBump' : 'envelopeTypeTx';
}

export function hashHex(tx) {
  return Buffer.from(tx.hash()).toString('hex');
}

// Muxed M... addresses are scored under their base G account (same rule as
// grydlock-oracle-adapter's DestinationValidator).
export function baseAccount(address) {
  if (typeof address !== 'string') return address;
  if (address.startsWith('M') && StrKey.isValidMed25519PublicKey(address)) {
    const raw = StrKey.decodeMed25519PublicKey(address);
    return StrKey.encodeEd25519PublicKey(raw.subarray(0, 32));
  }
  return address;
}

export function assetId(asset) {
  if (!asset) return undefined;
  if (asset.isNative?.()) return 'native';
  if (asset.code && asset.issuer) return `${asset.code}:${asset.issuer}`;
  // liquidity pool share asset or pool id
  if (asset.getLiquidityPoolParameters) return 'pool-share';
  return String(asset);
}

const jsonSafe = (x) =>
  JSON.parse(JSON.stringify(x, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));

const isAddress = (s) =>
  StrKey.isValidEd25519PublicKey(s) || StrKey.isValidContract(s) || StrKey.isValidMed25519PublicKey(s);

// Collects every Stellar address (G.../C.../M...) inside a decoded value.
function addressesIn(value, out) {
  if (typeof value === 'string') {
    if (isAddress(value)) out.push(value);
  } else if (Array.isArray(value)) {
    for (const v of value) addressesIn(v, out);
  } else if (value && typeof value === 'object' && !(value instanceof Uint8Array)) {
    for (const [k, v] of Object.entries(value)) {
      addressesIn(k, out);
      addressesIn(v, out);
    }
  }
}

// Normalises an invokeHostFunction operation into
//   { kind: 'invokeContract', contract, method, args: [native values] }
//   { kind: 'createContract' } | { kind: <other> }
// Works with SDK 17's typed HostFunction wrappers (func.value) and with the
// older xdr.HostFunction union (func.switch()).
export function hostFunctionCall(op) {
  const f = op.func;
  if (f?.value && 'functionName' in f.value) {
    return {
      kind: 'invokeContract',
      contract: Address.fromScAddress(f.value.contractAddress).toString(),
      method: String(f.value.functionName),
      args: f.value.args.map((a) => scValToNative(a))
    };
  }
  if (typeof f?.switch === 'function') {
    if (f.switch() === xdr.HostFunctionType.hostFunctionTypeInvokeContract()) {
      const ic = f.invokeContract();
      return {
        kind: 'invokeContract',
        contract: Address.fromScAddress(ic.contractAddress()).toString(),
        method: ic.functionName().toString(),
        args: ic.args().map((a) => scValToNative(a))
      };
    }
    return { kind: /create/i.test(f.switch().name) ? 'createContract' : f.switch().name };
  }
  const name = f?.constructor?.name ?? 'unknown';
  return { kind: /create/i.test(name) ? 'createContract' : name };
}

// A stable, JSON-friendly summary of one operation. Keeps the field names the
// original hand-written transactions/index.json used (destination, asset,
// amount, ...), so old and new index entries read the same way.
export function summarizeOperation(op, index) {
  const out = { index, type: op.type };
  if (op.source) out.source = op.source;
  switch (op.type) {
    case 'createAccount':
      Object.assign(out, { destination: op.destination, startingBalance: op.startingBalance });
      break;
    case 'payment':
      Object.assign(out, { destination: op.destination, asset: assetId(op.asset), amount: op.amount });
      break;
    case 'pathPaymentStrictSend':
      Object.assign(out, {
        destination: op.destination,
        sendAsset: assetId(op.sendAsset),
        sendAmount: op.sendAmount,
        destAsset: assetId(op.destAsset),
        destMin: op.destMin,
        path: op.path.map(assetId)
      });
      break;
    case 'pathPaymentStrictReceive':
      Object.assign(out, {
        destination: op.destination,
        sendAsset: assetId(op.sendAsset),
        sendMax: op.sendMax,
        destAsset: assetId(op.destAsset),
        destAmount: op.destAmount,
        path: op.path.map(assetId)
      });
      break;
    case 'changeTrust':
      Object.assign(out, { asset: assetId(op.line), limit: op.limit });
      break;
    case 'accountMerge':
      Object.assign(out, { destination: op.destination });
      break;
    case 'setOptions': {
      for (const k of [
        'masterWeight',
        'lowThreshold',
        'medThreshold',
        'highThreshold',
        'homeDomain',
        'setFlags',
        'clearFlags',
        'inflationDest'
      ]) {
        if (op[k] !== undefined) out[k] = op[k];
      }
      if (op.signer) {
        const s = op.signer;
        out.signer = s.ed25519PublicKey
          ? { key: s.ed25519PublicKey, weight: s.weight }
          : { key: JSON.stringify(Object.keys(s)), weight: s.weight };
      }
      break;
    }
    case 'manageSellOffer':
    case 'manageBuyOffer':
    case 'createPassiveSellOffer':
      Object.assign(out, {
        selling: assetId(op.selling),
        buying: assetId(op.buying),
        amount: op.amount ?? op.buyAmount,
        price: op.price
      });
      if (op.offerId !== undefined) out.offerId = op.offerId;
      break;
    case 'createClaimableBalance':
      Object.assign(out, {
        asset: assetId(op.asset),
        amount: op.amount,
        claimants: op.claimants.map((c) => c.destination)
      });
      break;
    case 'claimClaimableBalance':
      Object.assign(out, { balanceId: op.balanceId });
      break;
    case 'beginSponsoringFutureReserves':
      Object.assign(out, { sponsoredId: op.sponsoredId });
      break;
    case 'endSponsoringFutureReserves':
      break;
    case 'clawback':
      Object.assign(out, { from: op.from, asset: assetId(op.asset), amount: op.amount });
      break;
    case 'invokeHostFunction': {
      const call = hostFunctionCall(op);
      out.function = call.kind;
      if (call.kind === 'invokeContract') {
        out.contract = call.contract;
        out.method = call.method;
        out.args = jsonSafe(call.args);
      }
      break;
    }
    default:
      break;
  }
  return out;
}

export function summarizeOperations(tx) {
  return innerOf(tx).operations.map((op, i) => summarizeOperation(op, i));
}

// Every address/asset/contract a pre-signing risk check should score for this
// envelope, in first-seen order, excluding the signing (tx source) account.
// This is the "extraction" half of decode -> score -> tier.
export function extractCounterparties(tx) {
  const inner = innerOf(tx);
  const signer = baseAccount(inner.source);
  const found = [];
  const add = (id) => {
    if (!id || id === 'native' || id === 'pool-share') return;
    const canonical = baseAccount(id);
    if (canonical === signer) return;
    if (!found.includes(canonical)) found.push(canonical);
  };

  if (isFeeBump(tx)) add(tx.feeSource);

  for (const op of inner.operations) {
    if (op.source) add(op.source);
    switch (op.type) {
      case 'createAccount':
      case 'accountMerge':
        add(op.destination);
        break;
      case 'payment':
        add(op.destination);
        add(assetId(op.asset));
        break;
      case 'pathPaymentStrictSend':
      case 'pathPaymentStrictReceive':
        add(op.destination);
        add(assetId(op.sendAsset));
        add(assetId(op.destAsset));
        for (const a of op.path) add(assetId(a));
        break;
      case 'changeTrust':
        add(assetId(op.line));
        break;
      case 'setOptions':
        if (op.signer?.ed25519PublicKey) add(op.signer.ed25519PublicKey);
        if (op.inflationDest) add(op.inflationDest);
        break;
      case 'manageSellOffer':
      case 'manageBuyOffer':
      case 'createPassiveSellOffer':
        add(assetId(op.selling));
        add(assetId(op.buying));
        break;
      case 'createClaimableBalance':
        add(assetId(op.asset));
        for (const c of op.claimants) add(c.destination);
        break;
      case 'beginSponsoringFutureReserves':
        add(op.sponsoredId);
        break;
      case 'clawback':
        add(op.from);
        add(assetId(op.asset));
        break;
      case 'invokeHostFunction': {
        const call = hostFunctionCall(op);
        if (call.kind === 'invokeContract') {
          add(call.contract);
          const addrs = [];
          addressesIn(call.args, addrs);
          for (const a of addrs) add(a);
        }
        break;
      }
      default:
        break;
    }
  }
  return found;
}
