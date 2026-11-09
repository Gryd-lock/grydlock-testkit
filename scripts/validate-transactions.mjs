#!/usr/bin/env node
// Validates transactions/index.json against the XDR files it describes.
//
//   npm run validate:transactions            # offline checks (CI)
//   npm run validate:transactions -- --online # also confirm every testnet
//                                             # hash exists on Horizon
//
// Offline checks, per fixture:
//   - the .xdr file exists, is one base64 envelope, and decodes under the
//     recorded passphrase
//   - envelopeType, source (inner source for fee bumps) and feeBumpSource
//     match the decoded envelope
//   - the computed tx hash equals stellarHashTestnet (and provenance.txHash)
//   - `signed: false` envelopes carry no outer signatures
//   - label / risk_pattern / rationale / provenance are present and valid
//   - testnet fixtures have an explorer URL that points at their hash
//   - recorded `counterparties` equal what scripts/lib/stellar.mjs extracts
//     (the expected decode/extraction result), and recorded operation types
//     match the decoded operations in order
// Whole-index checks: every transactions/*.xdr is indexed, ids are unique,
// and the minimum fixture counts in scripts/__fixtures__/expected-counts.json
// are met.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { VALID_LABELS, VALID_RISK_PATTERNS, VALID_PROVENANCE_KINDS } from './lib/taxonomy.mjs';
import {
  decodeEnvelope,
  envelopeTypeOf,
  extractCounterparties,
  hashHex,
  innerOf,
  isFeeBump
} from './lib/stellar.mjs';

const HEX64 = /^[0-9a-f]{64}$/;

export function validateTransactionIndex(root, { expected } = {}) {
  const errors = [];
  const index = JSON.parse(readFileSync(join(root, 'transactions/index.json'), 'utf-8'));
  const seen = new Set();

  for (const f of index.fixtures) {
    const where = f.id ?? f.file;
    const err = (msg) => errors.push(`${where}: ${msg}`);

    if (!f.id) err('missing id');
    else if (seen.has(f.id)) err('duplicate id');
    seen.add(f.id);
    if (f.file !== `transactions/${f.id}.xdr`) err(`file "${f.file}" does not match id`);
    if (!VALID_LABELS.includes(f.label)) err(`invalid label "${f.label}"`);
    if (!VALID_RISK_PATTERNS.includes(f.risk_pattern)) err(`invalid risk_pattern "${f.risk_pattern}"`);
    if (typeof f.rationale !== 'string' || f.rationale.length < 20) err('missing or too-short rationale');
    if (typeof f.description !== 'string' || !f.description) err('missing description');
    if (!VALID_PROVENANCE_KINDS.includes(f.provenance?.kind)) err(`invalid provenance.kind "${f.provenance?.kind}"`);

    const abs = join(root, f.file);
    if (!existsSync(abs)) {
      err('xdr file missing');
      continue;
    }
    const raw = readFileSync(abs, 'utf-8').trim();
    if (raw.includes('\n')) err('xdr file must contain exactly one envelope');

    let tx;
    try {
      tx = decodeEnvelope(raw, index.passphrase);
    } catch (e) {
      err(`does not decode: ${e.message}`);
      continue;
    }

    const inner = innerOf(tx);
    if (envelopeTypeOf(tx) !== f.envelopeType) err(`envelopeType ${f.envelopeType} != decoded ${envelopeTypeOf(tx)}`);
    if (inner.source !== f.source) err(`source ${f.source} != decoded ${inner.source}`);
    if (isFeeBump(tx) && tx.feeSource !== f.feeBumpSource) err(`feeBumpSource ${f.feeBumpSource} != decoded ${tx.feeSource}`);

    const hash = hashHex(tx);
    if (hash !== f.stellarHashTestnet) err(`stellarHashTestnet ${f.stellarHashTestnet} != computed ${hash}`);
    if (f.signed === false && tx.signatures.length > 0) err('marked unsigned but carries outer signatures');

    if (f.provenance?.kind === 'testnet') {
      const p = f.provenance;
      if (!HEX64.test(p.txHash ?? '')) err('testnet provenance needs a 64-hex txHash');
      if (p.txHash !== hash) err(`provenance.txHash ${p.txHash} != computed ${hash}`);
      if (!Number.isInteger(p.ledger)) err('testnet provenance needs an integer ledger');
      if (p.explorer !== `https://stellar.expert/explorer/testnet/tx/${hash}`) err('explorer URL does not point at this hash');
    }

    const extracted = extractCounterparties(tx);
    if (JSON.stringify(extracted) !== JSON.stringify(f.counterparties)) {
      err(`counterparties ${JSON.stringify(f.counterparties)} != extracted ${JSON.stringify(extracted)}`);
    }
    const decodedTypes = inner.operations.map((o) => o.type);
    const recordedTypes = (f.operations ?? []).map((o) => o.type);
    if (JSON.stringify(decodedTypes) !== JSON.stringify(recordedTypes)) {
      err(`operation types ${JSON.stringify(recordedTypes)} != decoded ${JSON.stringify(decodedTypes)}`);
    }
  }

  const onDisk = readdirSync(join(root, 'transactions')).filter((e) => e.endsWith('.xdr')).map((e) => e.slice(0, -4));
  for (const stem of onDisk) if (!seen.has(stem)) errors.push(`transactions/${stem}.xdr is not listed in index.json`);

  if (expected) {
    if (index.fixtures.length < expected.minTransactions) {
      errors.push(`transaction fixture count (${index.fixtures.length}) is below the expected minimum of ${expected.minTransactions}`);
    }
    for (const label of VALID_LABELS) {
      const n = index.fixtures.filter((f) => f.label === label).length;
      const min = expected.minTransactionsByLabel?.[label] ?? 0;
      if (n < min) errors.push(`${label} transaction count (${n}) is below the expected minimum of ${min}`);
    }
  }

  return { errors, index };
}

async function checkOnline(index) {
  const horizon = process.env.HORIZON_URL ?? 'https://horizon-testnet.stellar.org';
  const errors = [];
  for (const f of index.fixtures) {
    if (f.provenance?.kind !== 'testnet') continue;
    const res = await fetch(`${horizon}/transactions/${f.provenance.txHash}`);
    if (res.status === 404) errors.push(`${f.id}: ${f.provenance.txHash} not found on testnet (testnet reset?)`);
    else if (!res.ok) errors.push(`${f.id}: Horizon HTTP ${res.status}`);
    else {
      const body = await res.json();
      if (!body.successful) errors.push(`${f.id}: transaction was not successful on-chain`);
      if (body.ledger !== f.provenance.ledger) errors.push(`${f.id}: ledger ${f.provenance.ledger} != on-chain ${body.ledger}`);
    }
  }
  return errors;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const expected = JSON.parse(readFileSync(join(root, 'scripts/__fixtures__/expected-counts.json'), 'utf-8'));
  const { errors, index } = validateTransactionIndex(root, { expected });
  if (process.argv.includes('--online')) errors.push(...(await checkOnline(index)));

  if (errors.length) {
    console.error('Transaction validation failed:\n' + errors.map((e) => '  - ' + e).join('\n'));
    process.exit(1);
  }
  const byLabel = Object.fromEntries(VALID_LABELS.map((l) => [l, index.fixtures.filter((f) => f.label === l).length]));
  const testnet = index.fixtures.filter((f) => f.provenance?.kind === 'testnet').length;
  console.log(`Transaction validation passed: ${index.fixtures.length} XDR fixtures (${testnet} testnet-verified), labels ${JSON.stringify(byLabel)}.`);
}
