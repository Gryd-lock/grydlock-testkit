/**
 * Generate synthetic fixture corpora at several sizes so fixture-loading
 * strategies can be benchmarked well past the 12 entries that exist today.
 *
 * Usage:
 *   node scripts/bench/generate-corpus.mjs [--sizes 12,100,1000,10000] [--out .bench]
 *
 * The size that matches the real corpus (12) is *copied* from the repository
 * root rather than synthesised, so the baseline measurement reflects the
 * fixtures consumers actually load today.
 *
 * Output is deterministic: the same `--sizes` always produce byte-identical
 * corpora, so numbers from two runs (or two machines) are comparable.
 */

import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { encodeAccountId, seededRandom } from './strkey.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

export const DEFAULT_SIZES = [12, 100, 1000, 10000];

/** Label mix, chosen to stay close to the real corpus (4/3/5 of 12). */
const LABEL_MIX = [
  { label: 'clean', weight: 0.34, scoreMin: 0, scoreMax: 25 },
  { label: 'suspicious', weight: 0.25, scoreMin: 40, scoreMax: 70 },
  { label: 'malicious', weight: 0.41, scoreMin: 75, scoreMax: 100 }
];

const RISK_PATTERNS = {
  clean: ['none', 'adversarial-clean'],
  suspicious: ['pass-through', 'scam-trustline', 'cold-start', 'sponsored-mule'],
  malicious: ['sweep', 'phishing-drainer', 'rug-pull', 'signer-takeover', 'memo-impersonation']
};

/**
 * Note templates. Length matters: `notes` is the single largest contributor to
 * per-entry byte size, so synthetic entries must be about as verbose as the
 * hand-written ones or every artifact-size number would be optimistic.
 */
const NOTE_TEMPLATES = {
  clean: [
    'Established testnet wallet with regular payment history; no red flags.',
    'Long-lived wallet, low transaction velocity, no shared funding source with flagged accounts.',
    'Holds a USDC trustline against a long-lived issuer; normal trading activity.',
    'Fixture stand-in for a well-known, long-lived asset issuer with broad distribution.'
  ],
  suspicious: [
    'Funded seconds before a large outgoing payment burst; pattern consistent with a pass-through wallet.',
    'Shares a funding source with two destinations already labelled malicious in this corpus.',
    'Holds a trustline to a flagged scam asset; no other activity on the account.',
    'Transaction velocity is unusual for the account age; no direct evidence of fraud yet.'
  ],
  malicious: [
    'Path-payment sweep pattern: drains newly funded wallets within seconds of receiving deposits.',
    "Repeated small 'test' payments precede a large drain; matches a known phishing-drainer shape.",
    'Destination of multiple change-trust + immediate max-sell patterns typical of rug-pull collection wallets.',
    'Issuer of a scam asset with no distributed supply outside the issuing account.'
  ]
};

const ASSET_CODES = ['SCAM', 'RUGX', 'FREEB', 'AIRDR', 'MOONX', 'YLDZ', 'PUMPZ', 'GIFTX'];

/** Roughly 1 in 12 entries is an asset, mirroring the real corpus. */
const ASSET_RATIO = 1 / 12;

function pick(rng, list) {
  return list[Math.floor(rng() * list.length) % list.length];
}

function pickLabel(rng) {
  const roll = rng();
  let cumulative = 0;
  for (const bucket of LABEL_MIX) {
    cumulative += bucket.weight;
    if (roll < cumulative) return bucket;
  }
  return LABEL_MIX[LABEL_MIX.length - 1];
}

function randomAccountId(rng) {
  const payload = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    payload[i] = Math.floor(rng() * 256);
  }
  return encodeAccountId(payload);
}

/**
 * Build a corpus of `size` destinations plus its matching score map.
 *
 * @param {number} size
 * @param {number} seed
 * @returns {{ destinations: object[], scores: Record<string, number> }}
 */
export function buildCorpus(size, seed = 0x51ee) {
  const rng = seededRandom(seed ^ size);
  const destinations = [];
  const scores = {};
  const seen = new Set();

  while (destinations.length < size) {
    const bucket = pickLabel(rng);
    const account = randomAccountId(rng);
    const isAsset = rng() < ASSET_RATIO;
    const score =
      bucket.scoreMin + Math.floor(rng() * (bucket.scoreMax - bucket.scoreMin + 1));

    const assetCode = pick(rng, ASSET_CODES);
    const entry = isAsset
      ? {
          id: `${assetCode}:${account}`,
          type: 'asset',
          asset_code: assetCode,
          asset_issuer: account,
          label: bucket.label,
          risk_pattern: pick(rng, RISK_PATTERNS[bucket.label]),
          notes: pick(rng, NOTE_TEMPLATES[bucket.label])
        }
      : {
          id: account,
          type: 'account',
          address: account,
          label: bucket.label,
          risk_pattern: pick(rng, RISK_PATTERNS[bucket.label]),
          notes: pick(rng, NOTE_TEMPLATES[bucket.label])
        };

    if (seen.has(entry.id)) continue;
    seen.add(entry.id);

    destinations.push(entry);
    scores[entry.id] = score;
  }

  return { destinations, scores };
}

/**
 * Materialise one corpus on disk in the same two-file shape consumers read
 * today (`destinations.json` + `scores.json`).
 *
 * @param {number} size
 * @param {string} outRoot absolute path of the benchmark working directory
 * @returns {{ size: number, dir: string, synthetic: boolean }}
 */
export function writeCorpus(size, outRoot) {
  const dir = join(outRoot, `corpus-${size}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  const realDestinations = JSON.parse(readFileSync(join(ROOT, 'destinations.json'), 'utf-8'));
  const realScores = JSON.parse(readFileSync(join(ROOT, 'scores.json'), 'utf-8'));
  const realSize = realDestinations.destinations.length;

  let payload;
  let synthetic;

  if (size === realSize) {
    // Baseline: the fixtures consumers load today, verbatim.
    payload = { destinations: realDestinations.destinations, scores: realScores };
    synthetic = false;
  } else if (size < realSize) {
    throw new Error(`corpus size ${size} is below the real corpus size (${realSize})`);
  } else {
    // Larger corpora keep every real entry so lookups against known IDs stay
    // valid, then top up with synthetic entries.
    const generated = buildCorpus(size - realSize);
    payload = {
      destinations: [...realDestinations.destinations, ...generated.destinations],
      scores: { ...realScores, ...generated.scores }
    };
    synthetic = true;
  }

  writeFileSync(
    join(dir, 'destinations.json'),
    JSON.stringify({ destinations: payload.destinations }, null, 2) + '\n'
  );
  writeFileSync(join(dir, 'scores.json'), JSON.stringify(payload.scores, null, 2) + '\n');

  return { size: payload.destinations.length, dir, synthetic };
}

function parseArgs(argv) {
  const args = { sizes: DEFAULT_SIZES, out: '.bench' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--sizes') {
      args.sizes = argv[++i]
        .split(',')
        .map((s) => Number.parseInt(s.trim(), 10))
        .filter((n) => Number.isInteger(n) && n > 0);
    } else if (argv[i] === '--out') {
      args.out = argv[++i];
    }
  }
  return args;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const outRoot = join(ROOT, args.out);
  mkdirSync(outRoot, { recursive: true });

  for (const size of args.sizes) {
    const result = writeCorpus(size, outRoot);
    const kind = result.synthetic ? 'synthetic' : 'real (baseline)';
    console.log(`corpus-${result.size}: ${kind} -> ${result.dir}`);
  }
}
