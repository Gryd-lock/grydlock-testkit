/**
 * Fixture-loading strategies under evaluation.
 *
 * Every strategy exposes the same two-phase contract:
 *
 *   build(corpusDir, artifactDir) -> artifact metadata (what a release ships)
 *   load(artifactDir)             -> { lookup(id), touchedBytes() }
 *
 * `load()` is what a consumer pays at startup; `lookup(id)` is what it pays
 * per scored destination. Keeping the shape identical across strategies is
 * what makes the numbers comparable.
 *
 * `lookup()` is synchronous everywhere, including for the lazily-loaded split
 * packs, because Node consumers can read a shard synchronously. A browser
 * consumer would pay an async `fetch` there instead — see the report for how
 * that changes the picture.
 */

import {
  cpSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

/** Entries per shard for the split-pack strategy. */
export const SHARD_SIZE = 1000;

function readCorpus(corpusDir) {
  const destinations = JSON.parse(
    readFileSync(join(corpusDir, 'destinations.json'), 'utf-8')
  ).destinations;
  const scores = JSON.parse(readFileSync(join(corpusDir, 'scores.json'), 'utf-8'));
  return { destinations, scores };
}

function freshDir(dir) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Summarise every file in an artifact directory, on disk and gzipped.
 * `initial` names the files a consumer must fetch before its first lookup;
 * everything else is deferred.
 */
function measureArtifact(dir, initialFiles) {
  const files = readdirSync(dir, { recursive: true, encoding: 'utf-8' })
    .filter((name) => statSync(join(dir, name)).isFile())
    .map((name) => {
      const buf = readFileSync(join(dir, name));
      return { name: name.split('\\').join('/'), bytes: buf.length, gzipBytes: gzipSync(buf).length };
    });

  const initial = new Set(initialFiles);
  const sum = (list, key) => list.reduce((acc, f) => acc + f[key], 0);
  const initialList = files.filter((f) => initial.has(f.name));

  return {
    fileCount: files.length,
    totalBytes: sum(files, 'bytes'),
    totalGzipBytes: sum(files, 'gzipBytes'),
    initialBytes: sum(initialList, 'bytes'),
    initialGzipBytes: sum(initialList, 'gzipBytes')
  };
}

/** FNV-1a, used to place an ID in a shard without shipping a global index. */
export function shardOf(id, shardCount) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % shardCount;
}

/**
 * Strategy 1 (baseline) - exactly what `StubOracle` does today: read both
 * JSON files, parse them, and index scores by plain-object property access.
 */
const rawJson = {
  id: 'raw-json',
  label: 'Raw JSON + object lookup (baseline)',
  build(corpusDir, artifactDir) {
    freshDir(artifactDir);
    cpSync(join(corpusDir, 'destinations.json'), join(artifactDir, 'destinations.json'));
    cpSync(join(corpusDir, 'scores.json'), join(artifactDir, 'scores.json'));
    return measureArtifact(artifactDir, ['destinations.json', 'scores.json']);
  },
  async load(artifactDir) {
    const destinations = JSON.parse(
      readFileSync(join(artifactDir, 'destinations.json'), 'utf-8')
    ).destinations;
    const scores = JSON.parse(readFileSync(join(artifactDir, 'scores.json'), 'utf-8'));
    return {
      size: destinations.length,
      retain: { destinations, scores },
      lookup(id) {
        return scores[id];
      }
    };
  }
};

/**
 * Strategy 2 - same artifact, but parsed once into a `Map`. Costs a little
 * more at startup and buys prototype-safe, monomorphic lookups.
 */
const rawJsonIndex = {
  id: 'raw-json-index',
  label: 'Raw JSON + Map index',
  build(corpusDir, artifactDir) {
    return rawJson.build(corpusDir, artifactDir);
  },
  async load(artifactDir) {
    const destinations = JSON.parse(
      readFileSync(join(artifactDir, 'destinations.json'), 'utf-8')
    ).destinations;
    const scores = JSON.parse(readFileSync(join(artifactDir, 'scores.json'), 'utf-8'));
    const index = new Map();
    for (const d of destinations) {
      index.set(d.id, { score: scores[d.id], label: d.label, risk_pattern: d.risk_pattern });
    }
    return {
      size: index.size,
      retain: index,
      lookup(id) {
        return index.get(id)?.score;
      }
    };
  }
};

/**
 * Strategy 3 - ship a generated ES module instead of data files. The engine
 * parses JS rather than JSON, but the artifact is importable from a bundler
 * with no filesystem or fetch access at all.
 */
const esmModule = {
  id: 'esm-module',
  label: 'Generated ES module',
  build(corpusDir, artifactDir) {
    freshDir(artifactDir);
    const { destinations, scores } = readCorpus(corpusDir);
    const rows = destinations.map((d) => [d.id, scores[d.id], d.label, d.risk_pattern]);
    const source =
      '// Generated by scripts/bench/strategies.mjs - do not edit.\n' +
      `export const rows = ${JSON.stringify(rows)};\n` +
      'export const index = new Map(rows.map((r) => [r[0], r[1]]));\n' +
      'export function getScore(id) {\n  return index.get(id);\n}\n';
    writeFileSync(join(artifactDir, 'fixtures.mjs'), source);
    return measureArtifact(artifactDir, ['fixtures.mjs']);
  },
  async load(artifactDir) {
    // Cache-bust so repeated loads in one process are not free.
    const url = `${pathToFileURL(join(artifactDir, 'fixtures.mjs')).href}?v=${Math.random()}`;
    const mod = await import(url);
    return {
      size: mod.index.size,
      retain: mod,
      lookup(id) {
        return mod.getScore(id);
      }
    };
  }
};

/**
 * Strategy 4 - one gzipped JSON blob, inflated at startup. Smallest thing to
 * ship and to host; pays decompression on every cold start.
 */
const gzipJson = {
  id: 'gzip-json',
  label: 'Gzipped JSON archive',
  build(corpusDir, artifactDir) {
    freshDir(artifactDir);
    const { destinations, scores } = readCorpus(corpusDir);
    const rows = destinations.map((d) => [d.id, scores[d.id], d.label, d.risk_pattern]);
    writeFileSync(join(artifactDir, 'fixtures.json.gz'), gzipSync(Buffer.from(JSON.stringify(rows))));
    return measureArtifact(artifactDir, ['fixtures.json.gz']);
  },
  async load(artifactDir) {
    const { gunzipSync } = await import('node:zlib');
    const raw = gunzipSync(readFileSync(join(artifactDir, 'fixtures.json.gz'))).toString('utf-8');
    const index = new Map(JSON.parse(raw).map((r) => [r[0], r[1]]));
    return {
      size: index.size,
      retain: index,
      lookup(id) {
        return index.get(id);
      }
    };
  }
};

/**
 * Strategy 5 - split packs. Startup reads only a tiny manifest; each shard is
 * pulled in the first time a lookup lands in it. Shard placement is a hash of
 * the ID, so no global index has to be shipped or held in memory.
 */
const splitPacks = {
  id: 'split-packs',
  label: 'Split packs, lazily loaded',
  build(corpusDir, artifactDir) {
    freshDir(artifactDir);
    const { destinations, scores } = readCorpus(corpusDir);
    const shardCount = Math.max(1, Math.ceil(destinations.length / SHARD_SIZE));
    const shards = Array.from({ length: shardCount }, () => ({}));

    for (const d of destinations) {
      shards[shardOf(d.id, shardCount)][d.id] = scores[d.id];
    }

    mkdirSync(join(artifactDir, 'packs'), { recursive: true });
    shards.forEach((shard, i) => {
      writeFileSync(join(artifactDir, 'packs', `${i}.json`), JSON.stringify(shard));
    });
    writeFileSync(
      join(artifactDir, 'manifest.json'),
      JSON.stringify({
        version: 1,
        hash: 'fnv1a',
        shardCount,
        total: destinations.length,
        packs: shards.map((s, i) => ({ file: `packs/${i}.json`, entries: Object.keys(s).length }))
      })
    );
    return measureArtifact(artifactDir, ['manifest.json']);
  },
  async load(artifactDir) {
    const manifest = JSON.parse(readFileSync(join(artifactDir, 'manifest.json'), 'utf-8'));
    const loaded = new Map();
    let touchedBytes = 0;

    function shard(n) {
      let entries = loaded.get(n);
      if (!entries) {
        const buf = readFileSync(join(artifactDir, manifest.packs[n].file));
        touchedBytes += buf.length;
        entries = new Map(Object.entries(JSON.parse(buf.toString('utf-8'))));
        loaded.set(n, entries);
      }
      return entries;
    }

    return {
      size: manifest.total,
      retain: { manifest, loaded },
      lookup(id) {
        return shard(shardOf(id, manifest.shardCount)).get(id);
      },
      touchedBytes() {
        return touchedBytes;
      },
      loadedShards() {
        return loaded.size;
      }
    };
  }
};

export const STRATEGIES = [rawJson, rawJsonIndex, esmModule, gzipJson, splitPacks];

export function getStrategy(id) {
  const strategy = STRATEGIES.find((s) => s.id === id);
  if (!strategy) {
    throw new Error(`unknown strategy "${id}" (have: ${STRATEGIES.map((s) => s.id).join(', ')})`);
  }
  return strategy;
}
