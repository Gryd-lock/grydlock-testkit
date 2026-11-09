#!/usr/bin/env node
// Evaluation runner: scores every fixture through an oracle and reports
// per-tier precision/recall, false-positive rate, coverage and latency.
//
//   npm run eval -- --oracle fixtures
//   npm run eval -- --oracle soroban:CA42XDMAPI3QXA4XP6HEBPWD3IHZQ3YJB4MABSURASGGOVYU5QCWSC2M
//
// Options:
//   --oracle fixtures | soroban:<CONTRACT_ID>   (required)
//   --out <prefix>     write <prefix>.json and <prefix>.md
//                      (default: reports/latest-<oracle>)
//   --rpc <url>        Soroban RPC (default https://soroban-testnet.stellar.org)
//   --concurrency <n>  parallel oracle calls for soroban (default 4)
//
// What is scored:
//   destinations  each destinations.json entry is scored directly by id.
//   transactions  each transactions/*.xdr is decoded, its counterparties are
//                 extracted (scripts/lib/stellar.mjs), each counterparty is
//                 scored, and the transaction's predicted tier is the
//                 riskiest scored counterparty ("decode -> score -> tier").
//                 If no counterparty has a score the prediction is
//                 `unscored`, which counts as "no warning".
// Scores map to tiers using grydlock-extension's thresholds (lib/tiers.mjs).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

import { Account, Address, Contract, Networks, StrKey, TransactionBuilder, nativeToScVal, scValToNative, xdr } from '@stellar/stellar-sdk';

import { decodeEnvelope, extractCounterparties } from './lib/stellar.mjs';
import { computeMetrics, latencySummary } from './lib/metrics.mjs';
import { LABEL_RANK, TIER_BANDS, TIER_TO_LABEL, labelForScore, tierForScore } from './lib/tiers.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// ---------------------------------------------------------------- oracles
export function fixturesOracle(root = ROOT) {
  const scores = JSON.parse(readFileSync(join(root, 'scores.json'), 'utf-8'));
  return {
    name: 'fixtures',
    describe: 'Stub scores from scores.json (simulated oracle; see docs/LABELS.md)',
    async getScore(id) {
      return Object.hasOwn(scores, id) ? scores[id] : null;
    }
  };
}

// Encodes a destination id as the risk-oracle contract's `Target` enum:
//   G.../C...       -> Target::Address(Address)
//   CODE:ISSUER     -> Target::Asset(String, Address)
export function targetScVal(id) {
  const sym = (s) => xdr.ScVal.scvSymbol(s);
  if (id.includes(':')) {
    const [code, issuer] = id.split(':');
    return xdr.ScVal.scvVec([sym('Asset'), nativeToScVal(code, { type: 'string' }), new Address(issuer).toScVal()]);
  }
  return xdr.ScVal.scvVec([sym('Address'), new Address(id).toScVal()]);
}

export function sorobanOracle(contractId, { rpcUrl = 'https://soroban-testnet.stellar.org' } = {}) {
  const contract = new Contract(contractId);
  // Read-only simulation; the source account never signs or pays.
  const source = new Account(StrKey.encodeEd25519PublicKey(Buffer.alloc(32)), '0');
  return {
    name: `soroban:${contractId}`,
    describe: `Live get_score() simulation against ${contractId} via ${rpcUrl}`,
    async getScore(id) {
      const tx = new TransactionBuilder(source, { fee: '100', networkPassphrase: Networks.TESTNET })
        .addOperation(contract.call('get_score', targetScVal(id)))
        .setTimeout(0)
        .build();
      // Raw JSON-RPC rather than rpc.Server.simulateTransaction, so the
      // runner keeps working when testnet is ahead of the SDK's XDR.
      const res = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'simulateTransaction', params: { transaction: tx.toXDR() } })
      });
      const body = await res.json();
      if (body.error) throw new Error(`rpc error: ${JSON.stringify(body.error)}`);
      if (body.result.error) throw new Error(`simulation error for ${id}: ${body.result.error}`);
      const [outcome] = scValToNative(xdr.ScVal.fromXDR(body.result.results[0].xdr, 'base64'));
      // outcome is ['Scored', n] | ['Pending'] | ['Unscored']
      return outcome[0] === 'Scored' ? Number(outcome[1]) : null;
    }
  };
}

export function oracleFromSpec(spec, opts = {}) {
  if (spec === 'fixtures') return fixturesOracle(opts.root);
  if (spec?.startsWith('soroban:')) return sorobanOracle(spec.slice('soroban:'.length), opts);
  throw new Error(`unknown --oracle "${spec}" (expected fixtures | soroban:<CONTRACT_ID>)`);
}

// ---------------------------------------------------------------- runner
async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.max(1, limit) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}

export async function runEvaluation(oracle, { root = ROOT, concurrency = 4 } = {}) {
  const destinations = JSON.parse(readFileSync(join(root, 'destinations.json'), 'utf-8')).destinations;
  const index = JSON.parse(readFileSync(join(root, 'transactions/index.json'), 'utf-8'));
  const callLatencies = [];
  const fixtureLatencies = [];

  const timedScore = async (id) => {
    const t0 = performance.now();
    const score = await oracle.getScore(id);
    callLatencies.push(performance.now() - t0);
    return score;
  };

  const destResults = await pool(destinations, concurrency, async (d) => {
    const t0 = performance.now();
    const score = await timedScore(d.id);
    fixtureLatencies.push(performance.now() - t0);
    return {
      kind: 'destination', id: d.id, persona: d.persona, label: d.label, risk_pattern: d.risk_pattern,
      score, tier: tierForScore(score), predicted: labelForScore(score)
    };
  });

  const txResults = await pool(index.fixtures, concurrency, async (f) => {
    const t0 = performance.now();
    const tx = decodeEnvelope(readFileSync(join(root, f.file), 'utf-8'), index.passphrase);
    const parties = extractCounterparties(tx);
    const scored = await Promise.all(parties.map(async (id) => ({ id, score: await timedScore(id) })));
    fixtureLatencies.push(performance.now() - t0);
    let worst = null;
    for (const s of scored) {
      if (s.score === null) continue;
      if (worst === null || s.score > worst.score) worst = s;
    }
    const score = worst?.score ?? null;
    return {
      kind: 'transaction', id: f.id, label: f.label, risk_pattern: f.risk_pattern,
      score, tier: tierForScore(score), predicted: labelForScore(score),
      drivenBy: worst?.id ?? null, counterparties: scored
    };
  });

  const all = [...destResults, ...txResults];
  return {
    meta: {
      oracle: oracle.name,
      oracleDescription: oracle.describe,
      generatedAt: new Date().toISOString(),
      dataset: JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8')).version,
      tierBands: TIER_BANDS,
      tierToLabel: TIER_TO_LABEL,
      counts: { destinations: destResults.length, transactions: txResults.length }
    },
    metrics: {
      overall: computeMetrics(all),
      destinations: computeMetrics(destResults),
      transactions: computeMetrics(txResults)
    },
    latencyMs: {
      oracleCall: latencySummary(callLatencies),
      perFixture: latencySummary(fixtureLatencies)
    },
    errors: all
      .filter((r) => r.predicted !== r.label)
      .map((r) => ({
        kind: r.kind, id: r.id, persona: r.persona, label: r.label, predicted: r.predicted,
        score: r.score, risk_pattern: r.risk_pattern,
        direction: r.predicted === 'unscored' ? 'unscored' : LABEL_RANK[r.predicted] > LABEL_RANK[r.label] ? 'over-warn' : 'under-warn'
      })),
    results: all
  };
}

// ---------------------------------------------------------------- markdown
const pct = (x) => (x === null || x === undefined ? 'n/a' : `${(x * 100).toFixed(1)}%`);
const ms = (x) => (x === null || x === undefined ? 'n/a' : x < 1 ? `${(x * 1000).toFixed(0)} µs` : `${x.toFixed(1)} ms`);

function metricsTable(m) {
  const rows = ['| Tier | Support | Predicted | Precision | Recall | F1 |', '| --- | ---: | ---: | ---: | ---: | ---: |'];
  for (const [tier, t] of Object.entries(m.perTier)) {
    rows.push(`| ${tier} | ${t.support} | ${t.predicted} | ${pct(t.precision)} | ${pct(t.recall)} | ${pct(t.f1)} |`);
  }
  return rows.join('\n');
}

function confusionTable(m) {
  const cols = ['clean', 'suspicious', 'malicious', 'unscored'];
  const rows = [`| label \\ predicted | ${cols.join(' | ')} |`, `| --- | ${cols.map(() => '---:').join(' | ')} |`];
  for (const [label, row] of Object.entries(m.confusion)) rows.push(`| **${label}** | ${cols.map((c) => row[c]).join(' | ')} |`);
  return rows.join('\n');
}

export function renderMarkdown(report) {
  const { meta, metrics, latencyMs } = report;
  const o = metrics.overall;
  const section = (title, m) => `### ${title} (n = ${m.n})

${metricsTable(m)}

Warning (suspicious or malicious) — precision ${pct(m.warn.precision)}, recall ${pct(m.warn.recall)}, **false-positive rate ${pct(m.warn.falsePositiveRate)}**, coverage ${pct(m.coverage)}, exact-tier accuracy ${pct(m.accuracy)}.

${confusionTable(m)}
`;
  const patterns = Object.entries(o.byRiskPattern)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([p, b]) => `| ${p} | ${b.label} | ${b.support} | ${b.exact} | ${b.warned} | ${b.unscored} |`)
    .join('\n');
  const errors = report.errors
    .map((e) => `| ${e.kind} | \`${e.id.length > 24 ? e.id.slice(0, 10) + '…' + e.id.slice(-6) : e.id}\` | ${e.persona ?? ''} | ${e.risk_pattern} | ${e.label} | ${e.predicted} | ${e.score ?? '—'} | ${e.direction} |`)
    .join('\n');

  return `# Gryd Lock evaluation — \`${meta.oracle}\`

- **Oracle:** ${meta.oracleDescription}
- **Dataset:** grydlock-testkit v${meta.dataset} — ${meta.counts.destinations} destinations, ${meta.counts.transactions} transaction XDRs
- **Generated:** ${meta.generatedAt}
- **Tier mapping:** low ≤ 20 → clean · elevated ≤ 50 and high ≤ 75 → suspicious · critical → malicious · no score → unscored (no warning)

## Headline

| Metric | Value |
| --- | ---: |
| Warning precision | ${pct(o.warn.precision)} |
| Warning recall | ${pct(o.warn.recall)} |
| False-positive rate (clean items warned) | ${pct(o.warn.falsePositiveRate)} |
| Coverage (items with a score) | ${pct(o.coverage)} |
| Exact-tier accuracy | ${pct(o.accuracy)} |
| Oracle call latency p50 / p95 | ${ms(latencyMs.oracleCall.p50)} / ${ms(latencyMs.oracleCall.p95)} (n = ${latencyMs.oracleCall.n}) |
| Per-fixture latency p50 / p95 | ${ms(latencyMs.perFixture.p50)} / ${ms(latencyMs.perFixture.p95)} (n = ${latencyMs.perFixture.n}) |

## Per tier

${section('All fixtures', o)}
${section('Destinations', metrics.destinations)}
${section('Transactions (decode → score counterparties → riskiest tier)', metrics.transactions)}

## By risk pattern

| Risk pattern | Label | Support | Exact tier | Warned | Unscored |
| --- | --- | ---: | ---: | ---: | ---: |
${patterns}

## Misclassified fixtures (${report.errors.length})

| Kind | Id | Persona | Risk pattern | Label | Predicted | Score | Direction |
| --- | --- | --- | --- | --- | --- | ---: | --- |
${errors}
`;
}

// ---------------------------------------------------------------- cli
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') || argv[i + 1] === undefined ? true : argv[++i];
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = parseArgs(process.argv.slice(2));
  if (!a.oracle || a.oracle === true) {
    console.error('usage: npm run eval -- --oracle <fixtures|soroban:CONTRACT_ID> [--out reports/name] [--rpc URL]');
    process.exit(2);
  }
  const oracle = oracleFromSpec(a.oracle, { rpcUrl: a.rpc });
  const concurrency = Number(a.concurrency ?? (a.oracle === 'fixtures' ? 1 : 4));
  const report = await runEvaluation(oracle, { concurrency });
  const slug = a.oracle === 'fixtures' ? 'fixtures' : 'soroban';
  const prefix = join(ROOT, a.out && a.out !== true ? a.out : `reports/latest-${slug}`);
  mkdirSync(dirname(prefix), { recursive: true });
  writeFileSync(`${prefix}.json`, JSON.stringify(report, null, 2) + '\n');
  writeFileSync(`${prefix}.md`, renderMarkdown(report));
  const o = report.metrics.overall;
  console.log(JSON.stringify({
    oracle: report.meta.oracle,
    n: o.n,
    perTier: Object.fromEntries(Object.entries(o.perTier).map(([k, v]) => [k, { precision: v.precision, recall: v.recall }])),
    falsePositiveRate: o.warn.falsePositiveRate,
    warnRecall: o.warn.recall,
    coverage: o.coverage,
    latencyMs: { p50: report.latencyMs.oracleCall.p50, p95: report.latencyMs.oracleCall.p95 },
    wrote: [`${prefix}.json`, `${prefix}.md`].map((p) => p.replace(ROOT, ''))
  }, null, 2));
}
