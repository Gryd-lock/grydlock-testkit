import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { TransactionBuilder } from '@stellar/stellar-sdk';

const root = fileURLToPath(new URL('..', import.meta.url));
const transactionsDir = path.join(root, 'transactions');
const indexPath = path.join(transactionsDir, 'index.json');

function stringifyValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return Buffer.from(value).toString('hex');
  }
  if (Array.isArray(value)) {
    return value.map((item) => stringifyValue(item)).filter(Boolean).join(',');
  }
  if (typeof value.isNative === 'function') {
    if (value.isNative()) return 'XLM';
    const code = typeof value.getCode === 'function' ? value.getCode() : value.code;
    const issuer = typeof value.getIssuer === 'function' ? value.getIssuer() : value.issuer;
    if (code && issuer) return `${code}:${issuer}`;
  }
  if (typeof value.accountId === 'function') return value.accountId();
  if (typeof value.toString === 'function' && value.toString !== Object.prototype.toString) {
    const rendered = value.toString();
    if (rendered !== '[object Object]') return rendered;
  }
  return null;
}

function formatMemo(memo) {
  if (!memo || memo.type === 'none') return 'none';
  const value = stringifyValue(memo.value);
  return value ? `${memo.type}:${value}` : memo.type;
}

function formatTimeBounds(transaction) {
  const bounds = transaction.timeBounds;
  if (!bounds) return 'none';
  const min = String(bounds.minTime ?? '0');
  const max = String(bounds.maxTime ?? '0');
  if (min === '0' && max === '0') return 'none';
  return `min=${min === '0' ? 'unbounded' : min} max=${max === '0' ? 'unbounded' : max}`;
}

function formatClaimant(claimant) {
  if (!claimant || typeof claimant !== 'object') return stringifyValue(claimant);
  const destination = stringifyValue(claimant.destination);
  const predicate = stringifyValue(claimant.predicate);
  return [destination && `destination=${destination}`, predicate && `predicate=${predicate}`]
    .filter(Boolean)
    .join(',');
}

function add(parts, name, value) {
  const rendered = stringifyValue(value);
  if (rendered !== null && rendered !== '') parts.push(`${name}=${rendered}`);
}

function formatOperation(operation, index) {
  const parts = [`#${index}`, operation.type];
  add(parts, 'source', operation.source);

  switch (operation.type) {
    case 'payment':
      add(parts, 'destination', operation.destination);
      add(parts, 'asset', operation.asset);
      add(parts, 'amount', operation.amount);
      break;
    case 'pathPaymentStrictSend':
      add(parts, 'sendAsset', operation.sendAsset);
      add(parts, 'sendAmount', operation.sendAmount);
      add(parts, 'destination', operation.destination);
      add(parts, 'destAsset', operation.destAsset);
      add(parts, 'destMin', operation.destMin);
      add(parts, 'path', operation.path);
      break;
    case 'pathPaymentStrictReceive':
      add(parts, 'sendAsset', operation.sendAsset);
      add(parts, 'sendMax', operation.sendMax);
      add(parts, 'destination', operation.destination);
      add(parts, 'destAsset', operation.destAsset);
      add(parts, 'destAmount', operation.destAmount);
      add(parts, 'path', operation.path);
      break;
    case 'changeTrust':
      add(parts, 'asset', operation.line ?? operation.asset);
      add(parts, 'limit', operation.limit);
      break;
    case 'createAccount':
      add(parts, 'destination', operation.destination);
      add(parts, 'startingBalance', operation.startingBalance);
      break;
    case 'accountMerge':
      add(parts, 'destination', operation.destination);
      break;
    case 'manageSellOffer':
    case 'createPassiveSellOffer':
      add(parts, 'selling', operation.selling);
      add(parts, 'buying', operation.buying);
      add(parts, 'amount', operation.amount);
      add(parts, 'price', operation.price);
      add(parts, 'offerId', operation.offerId);
      break;
    case 'manageBuyOffer':
      add(parts, 'selling', operation.selling);
      add(parts, 'buying', operation.buying);
      add(parts, 'buyAmount', operation.buyAmount);
      add(parts, 'price', operation.price);
      add(parts, 'offerId', operation.offerId);
      break;
    case 'createClaimableBalance':
      add(parts, 'asset', operation.asset);
      add(parts, 'amount', operation.amount);
      if (Array.isArray(operation.claimants)) {
        parts.push(`claimants=[${operation.claimants.map(formatClaimant).join(';')}]`);
      }
      break;
    case 'claimClaimableBalance':
      add(parts, 'balanceId', operation.balanceId);
      break;
    case 'beginSponsoringFutureReserves':
      add(parts, 'sponsoredId', operation.sponsoredId);
      break;
    case 'manageData':
      add(parts, 'name', operation.name);
      add(parts, 'value', operation.value);
      break;
    case 'bumpSequence':
      add(parts, 'bumpTo', operation.bumpTo);
      break;
    default: {
      const skip = new Set(['type', 'source']);
      for (const [key, value] of Object.entries(operation)) {
        if (skip.has(key) || typeof value === 'function') continue;
        const rendered = stringifyValue(value);
        if (rendered !== null && rendered !== '' && rendered.length <= 240) {
          parts.push(`${key}=${rendered}`);
        }
      }
    }
  }
  return parts.join(' ');
}

async function main() {
  const index = JSON.parse(await readFile(indexPath, 'utf8'));
  if (typeof index.passphrase !== 'string' || index.passphrase.length === 0) {
    throw new Error('transactions/index.json must define a non-empty "passphrase"');
  }

  const entries = await readdir(transactionsDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.xdr'))
    .map((entry) => entry.name)
    .sort();

  if (files.length === 0) throw new Error('No transactions/*.xdr fixtures found');

  console.log(`Transaction fixture summary (${index.network ?? 'custom network'})`);
  console.log(`Files: ${files.length}`);

  const failures = [];
  for (const file of files) {
    try {
      const encoded = (await readFile(path.join(transactionsDir, file), 'utf8')).trim();
      const envelope = TransactionBuilder.fromXDR(encoded, index.passphrase);
      const isFeeBump = envelope.innerTransaction !== undefined;
      const transaction = isFeeBump ? envelope.innerTransaction : envelope;

      console.log('');
      console.log(`=== transactions/${file} ===`);
      console.log(`Envelope: ${isFeeBump ? 'fee-bump' : 'transaction'}`);
      if (isFeeBump) {
        console.log(`Fee source: ${stringifyValue(envelope.feeSource) ?? 'unknown'}`);
        console.log(`Fee: ${stringifyValue(envelope.fee) ?? 'unknown'} (outer fee-bump)`);
        console.log(`Inner fee: ${stringifyValue(transaction.fee) ?? 'unknown'}`);
      } else {
        console.log(`Fee: ${stringifyValue(transaction.fee) ?? 'unknown'}`);
      }
      console.log(`Source: ${stringifyValue(transaction.source) ?? 'unknown'}`);
      console.log(`Sequence: ${stringifyValue(transaction.sequence) ?? 'unknown'}`);
      console.log(`Memo: ${formatMemo(transaction.memo)}`);
      console.log(`Time bounds: ${formatTimeBounds(transaction)}`);
      console.log('Operations:');
      if (!Array.isArray(transaction.operations) || transaction.operations.length === 0) {
        console.log('  (none)');
      } else {
        transaction.operations.forEach((operation, index) => {
          console.log(`  ${formatOperation(operation, index)}`);
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ file, message });
      console.error('');
      console.error(`=== transactions/${file} ===`);
      console.error(`ERROR: ${message}`);
    }
  }

  if (failures.length > 0) {
    console.error('');
    console.error(`Failed to decode ${failures.length} fixture(s): ${failures.map(({ file }) => file).join(', ')}`);
    process.exitCode = 1;
  }
}

await main();
