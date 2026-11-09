#!/usr/bin/env node
// Generates the testnet-backed fixture set.
//
//   npm run generate:testnet              # full run, rewrites the dataset
//   npm run generate:testnet -- --out DIR # write outputs under DIR instead
//   npm run generate:testnet -- --from-checkpoint dataset/.checkpoint.json
//       # rebuild outputs from a previous run's checkpoint, no network calls
//
// What it does, in order:
//   1. Creates a fresh random keypair for every persona in personas.mjs and
//      funds it with Friendbot. Secret keys are held in memory only; nothing
//      secret is ever written to disk.
//   2. Executes recipes.mjs on testnet (setup -> fixtures -> evidence),
//      submitting every transaction and recording its hash and ledger.
//   3. For each `fixture` recipe, writes the *unsigned* envelope to
//      transactions/<id>.xdr. A Stellar tx hash does not cover signatures,
//      so the unsigned envelope's hash equals the on-chain hash.
//   4. Rewrites destinations.json / scores.json / transactions/index.json,
//      keeping every non-testnet (offline-synthetic seed) entry as-is, and
//      writes the full audit trail to dataset/testnet-run.json.
//
// Testnet is reset periodically by SDF. After a reset the recorded hashes no
// longer resolve on explorers, but they remain the reproducible record of
// this run; regenerate and cut a new dataset version to refresh them.

import * as sdk from '@stellar/stellar-sdk';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PERSONAS, ASSETS } from './personas.mjs';
import { RECIPES } from './recipes.mjs';
import {
  decodeEnvelope,
  envelopeTypeOf,
  extractCounterparties,
  hashHex,
  innerOf,
  summarizeOperations
} from '../lib/stellar.mjs';

const { Keypair, Asset, Networks, TransactionBuilder, Horizon, rpc, Operation } = sdk;

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const args = process.argv.slice(2);
const argValue = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
const OUT = argValue('--out') ?? ROOT;
const FROM_CHECKPOINT = argValue('--from-checkpoint');
const HORIZON_URL = process.env.HORIZON_URL ?? 'https://horizon-testnet.stellar.org';
const RPC_URL = process.env.SOROBAN_RPC_URL ?? 'https://soroban-testnet.stellar.org';
const FRIENDBOT_URL = process.env.FRIENDBOT_URL ?? 'https://friendbot.stellar.org';
const PASSPHRASE = Networks.TESTNET;
const EXPLORER = 'https://stellar.expert/explorer/testnet';
const SDK_VERSION = JSON.parse(
  readFileSync(join(ROOT, 'node_modules/@stellar/stellar-sdk/package.json'), 'utf8')
).version;

const horizon = new Horizon.Server(HORIZON_URL);
const soroban = new rpc.Server(RPC_URL);

const log = (...m) => console.log(new Date().toISOString().slice(11, 19), ...m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- keys
const keys = new Map(PERSONAS.map((p) => [p.name, Keypair.random()]));
const personaByName = new Map(PERSONAS.map((p) => [p.name, p]));
const kp = (name) => {
  const k = keys.get(name);
  if (!k) throw new Error(`unknown persona "${name}"`);
  return k;
};
// Public addresses are tracked separately from keys so outputs can be rebuilt
// from a checkpoint (which never contains secrets).
const addresses = new Map([...keys].map(([n, k]) => [n, k.publicKey()]));
const pub = (name) => {
  const a = addresses.get(name);
  if (!a) throw new Error(`unknown persona "${name}"`);
  return a;
};
const nameByPub = () => new Map([...addresses].map(([n, a]) => [a, n]));

const assetDefs = new Map(ASSETS.map((a) => [a.code, a]));
const asset = (code) => {
  const a = assetDefs.get(code);
  if (!a) throw new Error(`unknown asset "${code}"`);
  return new Asset(code, pub(a.issuer));
};
const sac = (code) =>
  code === 'native' ? Asset.native().contractId(PASSPHRASE) : asset(code).contractId(PASSPHRASE);

// ---------------------------------------------------------------- funding
async function friendbot(name) {
  for (let attempt = 1; attempt <= 8; attempt++) {
    let res;
    try {
      res = await fetch(`${FRIENDBOT_URL}/?addr=${encodeURIComponent(pub(name))}`, { signal: AbortSignal.timeout(60_000) });
    } catch (err) {
      log(`friendbot ${name} attempt ${attempt} -> ${err.name}; retrying`);
      await sleep(5000 * attempt);
      continue;
    }
    if (res.ok) {
      const body = await res.json();
      return body.hash ?? body.id;
    }
    const text = await res.text();
    if (text.includes('createAccountAlreadyExist')) return null;
    log(`friendbot ${name} attempt ${attempt} -> HTTP ${res.status}; retrying`);
    await sleep(1500 * attempt);
  }
  throw new Error(`friendbot failed for ${name}`);
}

async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    })
  );
  return out;
}

// ---------------------------------------------------------------- submission
const runLog = []; // every submitted tx, in order

async function finishClassic(tx, unsignedXdr, meta) {
  let res;
  try {
    res = await horizon.submitTransaction(tx);
  } catch (err) {
    const codes = err?.response?.data?.extras?.result_codes;
    throw new Error(`${meta.recipe}: submit failed ${JSON.stringify(codes ?? err.message)}`);
  }
  const record = await horizon.transactions().transaction(res.hash).call();
  return record_(tx, unsignedXdr, meta, { hash: res.hash, ledger: res.ledger, closedAt: record.created_at });
}

function record_(_signedTx, unsignedXdr, meta, onchain) {
  // Re-decode the stored (unsigned) envelope exactly as a consumer would and
  // require its hash to equal the on-chain hash.
  const tx = decodeEnvelope(unsignedXdr, PASSPHRASE);
  const computed = hashHex(tx);
  if (computed !== onchain.hash) {
    throw new Error(`${meta.recipe}: unsigned envelope hash ${computed} != on-chain ${onchain.hash}`);
  }
  const rec = { ...meta, ...onchain, tx, unsignedXdr };
  runLog.push(rec);
  log(`  ✓ ${meta.recipe} ${onchain.hash.slice(0, 12)}… ledger ${onchain.ledger}`);
  return rec;
}

async function build(sourceName, ops, { memo, fee = '200' } = {}) {
  const account = await horizon.loadAccount(pub(sourceName));
  const b = new TransactionBuilder(account, { fee, networkPassphrase: PASSPHRASE }).setTimeout(600);
  if (memo) b.addMemo(memo);
  for (const op of ops) b.addOperation(op);
  return b.build();
}

let currentRecipe = null;

async function classic(sourceName, ops, { signers = [sourceName], memo } = {}) {
  const tx = await build(sourceName, ops, { memo });
  const unsignedXdr = tx.toXDR();
  tx.sign(...signers.map(kp));
  return finishClassic(tx, unsignedXdr, { recipe: currentRecipe.id, kind: currentRecipe.kind, source: sourceName });
}

async function feeBump(feeSourceName, innerSourceName, ops, { innerSigners = [innerSourceName], memo } = {}) {
  const inner = await build(innerSourceName, ops, { memo });
  inner.sign(...innerSigners.map(kp));
  // The fee-bump hash covers the inner envelope *including* its signatures,
  // so the inner tx stays signed; only the outer fee-bump signature is
  // stripped from the stored fixture.
  const fb = TransactionBuilder.buildFeeBumpTransaction(pub(feeSourceName), '400', inner, PASSPHRASE);
  const unsignedXdr = fb.toXDR();
  fb.sign(kp(feeSourceName));
  return finishClassic(fb, unsignedXdr, {
    recipe: currentRecipe.id, kind: currentRecipe.kind, source: innerSourceName, feeBumpSource: feeSourceName
  });
}

async function sorobanSubmit(sourceName, op) {
  const account = await soroban.getAccount(pub(sourceName));
  const tx = new TransactionBuilder(account, { fee: '100000', networkPassphrase: PASSPHRASE })
    .addOperation(op)
    .setTimeout(600)
    .build();
  const prepared = await soroban.prepareTransaction(tx);
  const unsignedXdr = prepared.toXDR();
  prepared.sign(kp(sourceName));
  const sent = await soroban.sendTransaction(prepared);
  if (sent.status === 'ERROR') {
    throw new Error(`${currentRecipe.id}: sendTransaction ERROR ${sent.errorResult?.toXDR('base64')}`);
  }
  for (let i = 0; i < 60; i++) {
    const got = await soroban.getTransaction(sent.hash);
    if (got.status === 'SUCCESS') {
      return record_(prepared, unsignedXdr, { recipe: currentRecipe.id, kind: currentRecipe.kind, source: sourceName }, {
        hash: sent.hash, ledger: got.ledger, closedAt: new Date(Number(got.createdAt) * 1000).toISOString()
      });
    }
    if (got.status === 'FAILED') throw new Error(`${currentRecipe.id}: soroban tx FAILED`);
    await sleep(1000);
  }
  throw new Error(`${currentRecipe.id}: soroban tx not confirmed in time`);
}

const invoke = (sourceName, contract, method, invokeArgs) =>
  sorobanSubmit(sourceName, Operation.invokeContractFunction({ contract, function: method, args: invokeArgs }));
const deploySac = (sourceName, code) =>
  sorobanSubmit(sourceName, Operation.createStellarAssetContract({ asset: asset(code) }));
// Raw JSON-RPC: the SDK's getLatestLedger() also decodes the ledger header
// XDR, which fails when testnet runs a newer protocol than the SDK knows.
const latestLedger = async () => {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getLatestLedger' }),
    signal: AbortSignal.timeout(30_000)
  });
  return (await res.json()).result.sequence;
};
const parallel = async (thunks) => {
  const recs = await Promise.all(thunks.map((t) => t()));
  return recs.at(-1);
};

const ctx = { sdk, pub, asset, sac, classic, feeBump, invoke, deploySac, latestLedger, parallel, state: {} };

// ---------------------------------------------------------------- outputs
function readJson(rel) {
  return JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
}
function writeJson(rel, data) {
  const abs = join(OUT, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, JSON.stringify(data, null, 2) + '\n');
}

function evidenceFor(id) {
  const name = nameByPub().get(id);
  return runLog
    .filter((r) => (name && (r.source === name || r.feeBumpSource === name))
      || extractCounterparties(r.tx).includes(id))
    .map((r) => r.hash);
}

function buildDestinations(fundingTx) {
  const out = [];
  for (const p of PERSONAS) {
    if (p.destination === false) continue;
    const id = pub(p.name);
    out.push({
      id, type: 'account', address: id, label: p.label, risk_pattern: p.risk_pattern, notes: p.notes,
      fixture_status: 'synthetic-only', persona: p.name, rationale: p.rationale,
      ...(p.score_rationale ? { score_rationale: p.score_rationale } : {}),
      provenance: {
        kind: 'testnet', funded: p.fund !== false,
        funding_tx: fundingTx.get(p.name) ?? null,
        evidence_txs: evidenceFor(id),
        explorer: `${EXPLORER}/account/${id}`
      }
    });
  }
  for (const a of ASSETS) {
    const id = `${a.code}:${pub(a.issuer)}`;
    out.push({
      id, type: 'asset', asset_code: a.code, asset_issuer: pub(a.issuer), label: a.label,
      risk_pattern: a.risk_pattern, notes: a.notes, fixture_status: 'synthetic-only',
      persona: `asset-${a.code.toLowerCase()}`, rationale: a.rationale,
      provenance: { kind: 'testnet', evidence_txs: evidenceFor(id), explorer: `${EXPLORER}/asset/${a.code}-${pub(a.issuer)}` }
    });
    if (a.sac) {
      const cid = sac(a.code);
      out.push({
        id: cid, type: 'contract', address: cid, contract_kind: 'stellar-asset-contract', wraps_asset: id,
        label: a.sac.label, risk_pattern: a.sac.risk_pattern,
        notes: `Stellar Asset Contract (SAC) for ${a.code}. ${a.notes}`, fixture_status: 'synthetic-only',
        persona: `sac-${a.code.toLowerCase()}`, rationale: `SAC wrapper inherits the asset's label. ${a.rationale}`,
        provenance: { kind: 'testnet', evidence_txs: evidenceFor(cid), explorer: `${EXPLORER}/contract/${cid}` }
      });
    }
  }
  return out;
}

function scoreFor(id) {
  for (const p of PERSONAS) if (p.destination !== false && pub(p.name) === id) return p.score;
  for (const a of ASSETS) {
    if (`${a.code}:${pub(a.issuer)}` === id) return a.score;
    if (a.sac && sac(a.code) === id) return a.sac.score;
  }
  throw new Error(`no score for ${id}`);
}

function fixtureEntry(r, recipe) {
  const inner = innerOf(r.tx);
  const entry = {
    id: recipe.id,
    file: `transactions/${recipe.id}.xdr`,
    envelopeType: envelopeTypeOf(r.tx),
    signed: false,
    stellarHashTestnet: r.hash,
    label: recipe.label,
    risk_pattern: recipe.risk_pattern,
    rationale: recipe.rationale,
    provenance: {
      kind: 'testnet', submitted: true, txHash: r.hash, ledger: r.ledger, closedAt: r.closedAt,
      explorer: `${EXPLORER}/tx/${r.hash}`
    },
    counterparties: extractCounterparties(r.tx),
    source: inner.source,
    description: recipe.description
  };
  if (r.feeBumpSource) {
    entry.feeBumpSource = pub(r.feeBumpSource);
    entry.innerTransaction = { stellarHashTestnet: Buffer.from(inner.hash()).toString('hex'), source: inner.source, signed: true };
  }
  if (inner.memo && inner.memo.type !== 'none') {
    entry.memo = { type: inner.memo.type, value: Buffer.isBuffer(inner.memo.value) ? inner.memo.value.toString('hex') : String(inner.memo.value) };
  }
  if (inner.timeBounds) entry.timeBounds = inner.timeBounds;
  entry.operations = summarizeOperations(r.tx);
  return entry;
}

// ---------------------------------------------------------------- main
async function execute() {
  log(`grydlock-testkit testnet generator (sdk ${SDK_VERSION})`);
  const funded = PERSONAS.filter((p) => p.fund !== false);
  log(`funding ${funded.length} personas via Friendbot…`);
  const fundingTx = new Map();
  await pool(funded, 4, async (p) => fundingTx.set(p.name, await friendbot(p.name)));
  log('all personas funded');

  for (const recipe of RECIPES) {
    currentRecipe = recipe;
    log(`${recipe.kind.padEnd(8)} ${recipe.id}`);
    await recipe.run(ctx);
  }

  // Checkpoint before building outputs: public data only, enough to rebuild
  // every output with --from-checkpoint if a later step fails.
  const checkpoint = {
    generatedAt: new Date().toISOString(),
    stellarSdk: SDK_VERSION,
    addresses: Object.fromEntries(addresses),
    fundingTx: Object.fromEntries(fundingTx),
    runLog: runLog.map(({ tx, ...rest }) => rest)
  };
  writeJson('dataset/.checkpoint.json', checkpoint);
  log('checkpoint written to dataset/.checkpoint.json');
  return checkpoint;
}

function restore(checkpoint) {
  addresses.clear();
  for (const [n, a] of Object.entries(checkpoint.addresses)) addresses.set(n, a);
  runLog.length = 0;
  for (const r of checkpoint.runLog) runLog.push({ ...r, tx: decodeEnvelope(r.unsignedXdr, PASSPHRASE) });
  return new Map(Object.entries(checkpoint.fundingTx));
}

async function main() {
  const checkpoint = FROM_CHECKPOINT
    ? JSON.parse(readFileSync(FROM_CHECKPOINT, 'utf8'))
    : await execute();
  const fundingTx = restore(checkpoint);
  const recipeById = new Map(RECIPES.map((r) => [r.id, r]));
  const fixtures = runLog
    .filter((r) => r.kind === 'fixture')
    .map((rec) => ({ recipe: recipeById.get(rec.recipe), rec }));

  // destinations + scores: keep offline seed entries, replace testnet ones
  const destFile = readJson('destinations.json');
  const legacy = destFile.destinations.filter((d) => d.provenance?.kind !== 'testnet');
  const generated = buildDestinations(fundingTx);
  destFile.destinations = [...legacy, ...generated];
  writeJson('destinations.json', destFile);

  const oldScores = readJson('scores.json');
  const scores = {};
  for (const d of legacy) scores[d.id] = oldScores[d.id];
  for (const d of generated) scores[d.id] = scoreFor(d.id);
  writeJson('scores.json', scores);

  // transactions
  const index = readJson('transactions/index.json');
  const legacyTx = index.fixtures.filter((f) => f.provenance?.kind !== 'testnet');
  index.fixtures = [...legacyTx, ...fixtures.map(({ recipe, rec }) => fixtureEntry(rec, recipe))];
  for (const { recipe, rec } of fixtures) {
    const abs = join(OUT, 'transactions', `${recipe.id}.xdr`);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, rec.unsignedXdr + '\n');
  }
  writeJson('transactions/index.json', index);

  // audit trail
  const ledgers = runLog.map((r) => r.ledger);
  writeJson('dataset/testnet-run.json', {
    _comment: 'Audit trail of the testnet run that produced this dataset. Every hash resolves on stellar.expert testnet until the next testnet reset. Contains public data only; no secret keys are ever persisted.',
    generatedAt: checkpoint.generatedAt,
    network: 'TESTNET',
    networkPassphrase: PASSPHRASE,
    horizon: HORIZON_URL,
    sorobanRpc: RPC_URL,
    stellarSdk: SDK_VERSION,
    ledgerRange: [Math.min(...ledgers), Math.max(...ledgers)],
    personas: Object.fromEntries(PERSONAS.map((p) => [p.name, {
      address: pub(p.name), funding_tx: fundingTx.get(p.name) ?? null, destination: p.destination !== false
    }])),
    contracts: Object.fromEntries([...ASSETS.filter((a) => a.sac).map((a) => [a.code, sac(a.code)]), ['native', sac('native')]]),
    transactions: runLog.map((r) => ({
      recipe: r.recipe, kind: r.kind, hash: r.hash, ledger: r.ledger, closedAt: r.closedAt,
      source: r.source, ...(r.feeBumpSource ? { feeBumpSource: r.feeBumpSource } : {}),
      explorer: `${EXPLORER}/tx/${r.hash}`
    }))
  });

  log(`done: ${generated.length} testnet destinations, ${fixtures.length} fixtures, ${runLog.length} transactions`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
