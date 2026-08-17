/**
 * Measure one (strategy, corpus) pair in an isolated process.
 *
 * Run by `run-benchmarks.mjs`, never directly in the normal workflow:
 *
 *   node --expose-gc scripts/bench/measure.mjs <strategyId> <artifactDir> <corpusDir>
 *
 * A fresh process per measurement keeps the module cache, the JIT state and
 * the heap from one strategy out of the next one's numbers. Results are
 * printed to stdout as a single JSON line.
 *
 * Phase order is deliberate:
 *   1. memory + cold load, on an untouched heap
 *   2. lookups, against that same loaded index
 *   3. repeated loads, for a warm startup figure
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

import { getStrategy } from './strategies.mjs';

const [strategyId, artifactDir, corpusDir] = process.argv.slice(2);

/** Lookups timed per phase. Large enough to swamp timer resolution. */
const LOOKUP_OPS = 200_000;
/** Distinct IDs cycled through, to defeat single-entry caching effects. */
const SAMPLE_SIZE = 512;
/** Warm load repetitions after the cold one. */
const WARM_LOADS = 5;
/**
 * Distinct destinations a single extension session is assumed to score. A
 * user signing a few transactions touches a handful of addresses, not the
 * whole corpus - the gap between the two is what lazy loading trades on.
 */
const SESSION_LOOKUPS = 10;

function gc() {
  if (typeof global.gc === 'function') {
    global.gc();
    global.gc();
  }
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Deterministic sample so every strategy is asked for the same IDs. */
function sampleIds(ids, count) {
  const step = Math.max(1, Math.floor(ids.length / count));
  const out = [];
  for (let i = 0; i < ids.length && out.length < count; i += step) {
    out.push(ids[i]);
  }
  return out;
}

function timeLookups(handle, ids) {
  let checksum = 0;
  const start = performance.now();
  for (let i = 0; i < LOOKUP_OPS; i++) {
    const value = handle.lookup(ids[i % ids.length]);
    checksum += value === undefined ? 0 : value;
  }
  const elapsedMs = performance.now() - start;
  return { nsPerOp: (elapsedMs * 1e6) / LOOKUP_OPS, checksum };
}

async function main() {
  const strategy = getStrategy(strategyId);

  const destinations = JSON.parse(
    readFileSync(join(corpusDir, 'destinations.json'), 'utf-8')
  ).destinations;
  const scores = JSON.parse(readFileSync(join(corpusDir, 'scores.json'), 'utf-8'));
  const allIds = destinations.map((d) => d.id);
  const hitIds = sampleIds(allIds, SAMPLE_SIZE);
  const missIds = hitIds.map((id) => `MISS${id.slice(4)}`);

  // Drop the corpus we only needed to pick query IDs, so it is not counted as
  // the strategy's memory.
  destinations.length = 0;

  // --- Phase 1: cold load, on a clean heap -------------------------------
  gc();
  const heapBefore = process.memoryUsage().heapUsed;
  const coldStart = performance.now();
  const handle = await strategy.load(artifactDir);
  const coldLoadMs = performance.now() - coldStart;
  gc();
  const heapAfterLoad = process.memoryUsage().heapUsed;

  // --- Phase 2: cold session probe ---------------------------------------
  // What one extension session actually costs: a handful of distinct
  // destinations scored against a freshly loaded index. This is the number
  // that decides whether lazy loading pays off, because a lazy strategy only
  // wins while the working set stays small relative to the corpus.
  const sessionIds = sampleIds(allIds, SESSION_LOOKUPS);
  const firstLookupStart = performance.now();
  const firstValue = handle.lookup(sessionIds[0]);
  const firstLookupUs = (performance.now() - firstLookupStart) * 1000;

  for (let i = 1; i < sessionIds.length; i++) {
    handle.lookup(sessionIds[i]);
  }
  const sessionMs = coldLoadMs + (performance.now() - firstLookupStart);
  const sessionTouchedBytes =
    typeof handle.touchedBytes === 'function' ? handle.touchedBytes() : null;
  const sessionShards = typeof handle.loadedShards === 'function' ? handle.loadedShards() : null;
  gc();
  const heapAfterSession = process.memoryUsage().heapUsed;

  // --- Phase 3: sustained lookup throughput -------------------------------
  // Warm the JIT before timing.
  timeLookups(handle, hitIds.slice(0, 32));

  const hit = timeLookups(handle, hitIds);

  // Snapshot before the miss sweep: a miss hashes to an arbitrary shard, so
  // sweeping misses would pull the entire corpus into a lazy strategy and
  // hide the whole point of loading lazily.
  gc();
  const heapAfterHits = process.memoryUsage().heapUsed;
  const touchedAfterHits = typeof handle.touchedBytes === 'function' ? handle.touchedBytes() : null;
  const shardsAfterHits = typeof handle.loadedShards === 'function' ? handle.loadedShards() : null;

  const miss = timeLookups(handle, missIds);

  // --- Correctness -------------------------------------------------------
  const wrong = hitIds.filter((id) => handle.lookup(id) !== scores[id]);
  const missesClean = missIds.every((id) => handle.lookup(id) === undefined);
  // A plain-object index answers `constructor` and `toString` with inherited
  // values instead of `undefined`; a Map does not.
  const prototypeSafe = ['constructor', 'toString', '__proto__', 'valueOf'].every(
    (key) => handle.lookup(key) === undefined
  );

  // --- Phase 4: warm loads ------------------------------------------------
  const warmLoadMs = [];
  for (let i = 0; i < WARM_LOADS; i++) {
    const start = performance.now();
    // eslint-disable-next-line no-await-in-loop -- sequential timing is the point
    const reloaded = await strategy.load(artifactDir);
    warmLoadMs.push(performance.now() - start);
    if (reloaded.size !== handle.size) {
      throw new Error('reload produced a different corpus size');
    }
  }

  process.stdout.write(
    JSON.stringify({
      strategy: strategyId,
      entries: handle.size,
      coldLoadMs,
      warmLoadMs: median(warmLoadMs),
      firstLookupUs,
      sessionMs,
      sessionLookups: SESSION_LOOKUPS,
      sessionTouchedBytes,
      sessionShards,
      heapAfterSessionBytes: heapAfterSession - heapBefore,
      hitLookupNs: hit.nsPerOp,
      missLookupNs: miss.nsPerOp,
      heapAfterLoadBytes: heapAfterLoad - heapBefore,
      heapAfterHitsBytes: heapAfterHits - heapBefore,
      lazyTouchedBytes: touchedAfterHits,
      loadedShards: shardsAfterHits,
      correct: wrong.length === 0 && missesClean && firstValue === scores[hitIds[0]],
      prototypeSafe,
      checksum: hit.checksum
    })
  );
}

main().catch((err) => {
  console.error(err.stack || String(err));
  process.exit(1);
});
