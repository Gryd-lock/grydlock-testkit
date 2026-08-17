# Spike: dataset growth and fixture-loading strategies

**Question:** how should fixture loading and lookup behave as the corpus grows from 12 entries to
hundreds or thousands?

**Answer in one line:** the current two-file raw-JSON layout is comfortable to roughly **5,000
entries**, needs a derived release artifact between **5,000 and 25,000**, and needs lazily-loaded
split packs beyond that. Nothing needs to change today.

Everything below is reproducible with `npm run bench`. The harness lives in
[scripts/bench/](../../scripts/bench/); measurements were taken with the harness at the commit that
introduced this document.

---

## TL;DR

| Corpus size | What to do | Why |
|---|---|---|
| ≤ 1,000 | Keep `destinations.json` + `scores.json` exactly as they are | 3.9 ms cold load, 415 KB heap, 82 KB gzipped release. Every alternative is a rounding error's worth of gain against real added complexity. |
| 1,000 – 5,000 | Same, plus switch consumers from plain-object lookup to a `Map` index | Costs ~0.5 ms at load, removes prototype-inherited-key hazards, and cuts retained heap by ~3.5x. |
| 5,000 – 25,000 | Keep the JSON files as the reviewable source of truth; publish a **derived, minimal, gzipped artifact** alongside them | Halves the shipped bytes and the parse time by dropping the ~50% of each record that is review metadata the runtime never reads. |
| > 25,000 | Move to **lazily-loaded split packs** | Startup and memory stop depending on corpus size entirely: 1.6 ms and 10 KB at 100,000 entries, against 221 ms and 41 MB for the baseline. |

The single most important number in this document: at 100,000 entries a cold extension session
(load the index, score 10 destinations) costs **220 ms and 41 MB** on the current strategy and
**20 ms and 389 KB** on split packs.

---

## Method

### Harness

```bash
npm run bench                                        # default sizes, median of 3 processes
node scripts/bench/run-benchmarks.mjs \
  --sizes 12,100,1000,10000,100000 --repeat 5        # what produced the tables below
node scripts/bench/generate-corpus.mjs --sizes 1000  # corpora only, no measurement
```

Results are written to `.bench/results.json` and `.bench/results.md`. `.bench/` is git-ignored:
the corpora are regenerated deterministically, so there is nothing to commit.

| File | Role |
|---|---|
| `scripts/bench/generate-corpus.mjs` | Builds synthetic corpora at any size |
| `scripts/bench/strkey.mjs` | Mints valid synthetic `G…` account IDs; seeded PRNG |
| `scripts/bench/strategies.mjs` | The five strategies, each `build()` + `load()` |
| `scripts/bench/measure.mjs` | Measures one (strategy, corpus) pair in an isolated process |
| `scripts/bench/run-benchmarks.mjs` | Drives the sweep, aggregates, renders the tables |

### Corpora

Sizes **12, 100, 1,000, 10,000, 100,000**. The 12-entry corpus is the real
`destinations.json` / `scores.json` copied verbatim, so the baseline row is what consumers load
today rather than a synthetic stand-in. Larger corpora keep all 12 real entries and top up with
synthetic ones drawn from the same label mix (34% clean / 25% suspicious / 41% malicious), the same
`risk_pattern` vocabulary, roughly 1-in-12 assets, and `notes` strings of realistic length — notes
are the largest per-entry contributor to byte size, so short filler would have flattered every
artifact-size number.

Generated account IDs are real Stellar strkeys (version byte, 32-byte payload, CRC16-XModem
checksum, base32) built from a seeded PRNG, so corpora are byte-identical across machines and runs.
Only the `G…` public-key form is implemented, deliberately: nothing in this harness can emit
something that looks like a secret seed.

### Measurement

Each (size, strategy) cell is the **median of 5 independent `node --expose-gc` processes**. A fresh
process per cell keeps one strategy's module cache, JIT state, and heap out of the next one's
numbers. Within a process the phases run in a fixed order:

1. **Cold load** on an untouched heap — `heapUsed` before, `load()`, forced GC, `heapUsed` after.
2. **Cold session** — the first 10 distinct lookups against the freshly loaded index, plus bytes
   and shards pulled to answer them.
3. **Sustained lookups** — 200,000 timed lookups cycling a 512-ID working set (hits), then the
   same for misses, after a JIT warm-up pass.
4. **Warm loads** — five further `load()` calls, median reported.

The harness also asserts correctness on every cell: sampled IDs must resolve to their true score,
misses must resolve to `undefined`, and inherited keys (`constructor`, `toString`, `__proto__`,
`valueOf`) must resolve to `undefined`. Any failure is reported in the results.

### Environment

Node v22.23.0, win32/x64, AMD Ryzen 7 PRO 7730U, 15 GB RAM. **Absolute numbers are
machine-specific; the ratios and the scaling shapes are what the recommendation rests on.** The
1,000- and 10,000-entry sweeps were repeated on Node v20.20.2 (the version CI pins): every load
figure came out 10–30% slower, and the ordering, the crossover points, and the per-entry constants
were unchanged.

### What is *not* measured

- **Real browser conditions.** These are Node numbers. A browser adds bundler overhead, and turns
  split-pack shard reads into async `fetch`/IndexedDB round trips (see caveats).
- **Disk cold-start.** The OS page cache is warm across repetitions, so first-ever-read I/O is
  excluded. That flatters every eager strategy equally.
- **Scoring correctness.** Out of scope here; that is `grydlock-research`'s job.

---

## Strategies compared

| # | Strategy | Artifact | Startup work | Lookup |
|---|---|---|---|---|
| 1 | **Raw JSON + object lookup** (baseline) | `destinations.json` + `scores.json`, verbatim | Read + `JSON.parse` both files | `scores[id]` |
| 2 | **Raw JSON + `Map` index** | identical to baseline | Parse both, then build a `Map` | `index.get(id)` |
| 3 | **Generated ES module** | one `fixtures.mjs` exporting packed rows | `import()` + build `Map` | `index.get(id)` |
| 4 | **Gzipped JSON archive** | one `fixtures.json.gz` of packed rows | Inflate, parse, build `Map` | `index.get(id)` |
| 5 | **Split packs, lazily loaded** | `manifest.json` + `packs/N.json` (1,000 entries/shard) | Read the manifest only | FNV-1a hash → shard, read shard on first touch, then `Map` |

Strategies 3–5 ship a **packed** record — `[id, score, label, risk_pattern]` — rather than the full
review record. That is a real difference, not an accounting trick: `notes`, `address`, `type`, and
the JSON key names exist for human review and account for roughly half of the raw bytes, and no
consumer reads them at lookup time. Where a table compares strategy 1 against 3–5 on artifact size,
part of the gap is compression and part is dropping fields the runtime never touches; both are
things a release build gets to do, and neither requires changing the source of truth.

Split packs place an ID by hashing it, so no global index has to be shipped or held in memory to
know which shard to fetch — the manifest stays at 100 bytes for 1,000 entries and 3.9 KB for
100,000.

---

## Results

### Startup: cold load (ms)

| Strategy | 12 | 100 | 1,000 | 10,000 | 100,000 |
|---|---:|---:|---:|---:|---:|
| Raw JSON + object lookup (baseline) | 1.78 | 1.78 | 3.85 | 23.81 | 220.51 |
| Raw JSON + Map index | 2.00 | 2.00 | 4.36 | 31.38 | 348.19 |
| Generated ES module | 2.50 | 2.19 | 3.40 | 15.65 | 159.30 |
| Gzipped JSON archive | 2.45 | 2.53 | 3.35 | 11.40 | 129.76 |
| Split packs, lazily loaded | 1.46 | 1.31 | 1.04 | 1.25 | 1.62 |

Below 1,000 entries every strategy sits inside process-noise of every other. Past 1,000 the eager
strategies go linear at roughly **2.2 µs per entry** for the baseline; split packs stay flat because
startup only reads the manifest.

### Memory: heap retained after load

| Strategy | 12 | 100 | 1,000 | 10,000 | 100,000 |
|---|---:|---:|---:|---:|---:|
| Raw JSON + object lookup (baseline) | 8.4 KB | 41.2 KB | 414.7 KB | 3.9 MB | 41.3 MB |
| Raw JSON + Map index | 4.2 KB | 22.8 KB | 117.9 KB | 1.4 MB | 13.2 MB |
| Generated ES module | 18.4 KB | 40.5 KB | 249.9 KB | 2.5 MB | 23.5 MB |
| Gzipped JSON archive | 18.5 KB | 27.8 KB | 124.1 KB | 1.2 MB | 10.5 MB |
| Split packs, lazily loaded | 4.2 KB | 4.2 KB | 4.2 KB | 2.9 KB | 9.9 KB |

The baseline retains the whole parsed `destinations` array — every `notes` string included — at
about **420 bytes per entry**. Discarding review metadata at load time and keeping only a `Map` of
what lookups need cuts that by ~3.5x for free; strategy 2 is the cheapest such change because it
keeps the artifact untouched.

### Lookup: sustained, warm (ns/op)

| Strategy | 12 | 100 | 1,000 | 10,000 | 100,000 | miss @ 100,000 |
|---|---:|---:|---:|---:|---:|---:|
| Raw JSON + object lookup (baseline) | 11 | 22 | 10 | 13 | 19 | 41 |
| Raw JSON + Map index | 18 | 17 | 22 | 38 | 79 | 66 |
| Generated ES module | 20 | 19 | 24 | 30 | 51 | 53 |
| Gzipped JSON archive | 15 | 17 | 21 | 28 | 47 | 50 |
| Split packs, lazily loaded | 136 | 143 | 148 | 155 | 721 | 232 |

**Lookup latency is not a real constraint at any size measured.** Even the slowest cell is under a
microsecond, against a scoring path that already does XDR decoding and (in production) a network
call. The baseline's plain-object lookup is genuinely the fastest — V8 dictionary-mode objects with
interned string keys beat `Map.get` here — but a 60 ns difference cannot justify a decision when
startup differs by 200 ms. Split packs pay an FNV-1a hash over a 56-character key per lookup on top
of the `Map`, which is where their ~140 ns floor comes from.

### Artifact size (KB)

Gzipped total, which is what a release download and a browser transfer actually cost:

| Strategy | 12 | 100 | 1,000 | 10,000 | 100,000 |
|---|---:|---:|---:|---:|---:|
| Raw JSON + object lookup (baseline) | 1.8 | 9.5 | 82.2 | 809.2 | 8,074.8 |
| Raw JSON + Map index | 1.8 | 9.5 | 82.2 | 809.2 | 8,074.8 |
| Generated ES module | 0.8 | 4.4 | 39.3 | 385.6 | 3,847.3 |
| Gzipped JSON archive | 0.6 | 4.2 | 39.1 | 385.5 | 3,848.2 |
| Split packs, lazily loaded | 0.6 | 3.9 | 37.3 | 372.4 | 3,721.9 |

Bytes that must be fetched **before the first lookup can be answered** — the number that matters for
extension startup and browser bundle size:

| Strategy | 12 | 100 | 1,000 | 10,000 | 100,000 |
|---|---:|---:|---:|---:|---:|
| Raw JSON + object lookup (baseline) | 5.0 | 41.5 | 416.0 | 4,164.0 | 41,616.1 |
| Raw JSON + Map index | 5.0 | 41.5 | 416.0 | 4,164.0 | 41,616.1 |
| Generated ES module | 1.2 | 8.9 | 88.2 | 879.8 | 8,792.4 |
| Gzipped JSON archive | 0.6 | 4.2 | 39.0 | 385.3 | 3,847.0 |
| Split packs, lazily loaded | 0.1 | 0.1 | 0.1 | 0.4 | 3.9 |

Raw JSON grows at **~416 bytes/entry uncompressed, ~81 bytes/entry gzipped**. A bundler that inlines
`destinations.json` into the extension pays the uncompressed column.

### Cold session: load + 10 distinct lookups

This is the metric that decides the recommendation. An extension does not sweep the corpus; it
scores a handful of destinations and then the MV3 service worker is torn down and has to do it all
again on the next wake-up.

| Strategy | 12 | 100 | 1,000 | 10,000 | 100,000 |
|---|---:|---:|---:|---:|---:|
| Raw JSON + object lookup (baseline) | 1.9 ms | 1.9 ms | 3.9 ms | 23.9 ms | 220.6 ms |
| Raw JSON + Map index | 2.1 ms | 2.1 ms | 4.4 ms | 31.5 ms | 348.3 ms |
| Generated ES module | 2.6 ms | 2.3 ms | 3.5 ms | 15.8 ms | 159.4 ms |
| Gzipped JSON archive | 2.6 ms | 2.6 ms | 3.4 ms | 11.6 ms | 129.9 ms |
| Split packs, lazily loaded | 3.1 ms | 2.8 ms | 3.2 ms | 16.2 ms | 19.7 ms |

Heap held at the end of that session:

| Strategy | 12 | 100 | 1,000 | 10,000 | 100,000 |
|---|---:|---:|---:|---:|---:|
| Raw JSON + object lookup (baseline) | 9 KB | 41 KB | 415 KB | 3.9 MB | 41.3 MB |
| Raw JSON + Map index | 5 KB | 24 KB | 119 KB | 1.4 MB | 13.2 MB |
| Generated ES module | 20 KB | 42 KB | 251 KB | 2.5 MB | 23.5 MB |
| Gzipped JSON archive | 19 KB | 29 KB | 125 KB | 1.2 MB | 10.5 MB |
| Split packs, lazily loaded | 15 KB | 18 KB | 42 KB | 354 KB | 389 KB |

Split packs pulled **604 KB across 10 shards** to answer that 10-lookup session at 100,000 entries,
and **549 KB across 9 shards** at 10,000 — essentially the same cost, because lazy cost scales with
`working set x shard size`, not with corpus size. That is also why split packs *lose* at 10,000: the
whole corpus is only 10 shards, so a 10-lookup session touches nearly all of it and pays the hashing
overhead for nothing. Shard size (`SHARD_SIZE` in `strategies.mjs`, currently 1,000) is the knob:
smaller shards lower session cost and raise file count and request count.

---

## Comparison matrix

Measured columns are at 10,000 entries. Qualitative columns are judgements, marked as such.

| Strategy | Startup | Lookup | Memory | Ship size | Release complexity | Portability | Developer experience |
|---|---|---|---|---|---|---|---|
| **Raw JSON + object lookup** (baseline) | 23.8 ms | 13 ns | 3.9 MB | 809 KB gz | **None** — the files are the release | **Best** — any language, any runtime, `curl` and read | **Best** — reviewable diffs, no build step, `npm run validate` is the whole toolchain |
| **Raw JSON + `Map` index** | 31.4 ms | 38 ns | 1.4 MB | 809 KB gz | **None** — consumer-side change only | Same as baseline | Same as baseline; ~10 lines in each consumer |
| **Generated ES module** | 15.7 ms | 30 ns | 2.5 MB | 386 KB gz | Low — one generator, one checked artifact | **Poor** — JS consumers only; opaque to non-JS tooling | Bundler-friendly and tree-shakeable, but a generated file to keep in sync and to review |
| **Gzipped JSON archive** | 11.4 ms | 28 ns | 1.2 MB | 386 KB gz | Low — one generator; release asset, not a source file | Good — gzip is universal, though browsers need `DecompressionStream` or a bundler step | Opaque in diffs; the JSON files stay the reviewable source |
| **Split packs, lazily loaded** | **1.2 ms** | 155 ns | **2.9 KB** | 372 KB gz | **High** — manifest, shard layout, hash function, and cache invalidation all become a contract | Fair — plain JSON files, but every consumer must implement the manifest + hash | Worst — a fixture change reshuffles shards; needs a partial-fetch-capable consumer |

---

## Findings

1. **Nothing is wrong today.** At 12 entries the baseline loads in 1.8 ms and holds 8 KB. The
   spike found no reason to change anything now.
2. **Startup, not lookup, is the constraint.** Lookup stays under 1 µs everywhere; cold load spans
   1.8 ms to 348 ms across the sweep. Optimising lookup would be optimising the wrong axis.
3. **The baseline's cost is dominated by data the runtime never reads.** `notes`, `address`, `type`,
   and JSON key names are roughly half the bytes and most of the retained heap. Any derived
   artifact — module, gzip, or packs — gets that back without touching the source of truth.
4. **Retained heap is the baseline's worst axis**, at ~420 bytes/entry. It reaches 3.9 MB at 10,000
   and 41 MB at 100,000, which is a real problem for an MV3 service worker.
5. **MV3 amplifies startup cost.** The extension's service worker is evicted and respawned
   routinely, so cold load is paid many times per browsing session, not once per install. A 24 ms
   parse at 10,000 entries is not a one-off.
6. **Lazy loading only pays when the corpus is much larger than the working set.** Split packs lose
   at ≤ 10,000 entries and win by 11x at 100,000. Adopting them early would be a net loss.
7. **Plain-object lookup is not prototype-safe.** The harness records this on every baseline run:
   `scores['constructor']` returns a function rather than `undefined`. Stellar strkeys and
   `CODE:ISSUER` asset IDs cannot collide with `Object.prototype` keys, so this is a latent
   robustness issue rather than a live bug — but it is free to remove by indexing into a `Map`.
8. **Compression does most of the work that split packs do, at a fraction of the complexity.**
   Gzipped JSON is within 4% of split packs on total ship size and beats every other eager strategy
   on startup and memory.

---

## Recommendation

**Keep the current layout. Do not build split packs now.**

`destinations.json` + `scores.json` should stay the reviewable source of truth at every size — the
labelling rubric, the changelog discipline, and the reviewer checklist in `CONTRIBUTING.md` all
depend on a fixture change being a readable diff. What should change as the corpus grows is what
gets *published*, not what gets *reviewed*.

Staged plan:

1. **Now (≤ 1,000 entries):** no change.
2. **Consumer-side, whenever convenient:** have `StubOracle` build a `Map` at load and drop the
   parsed `destinations` array once the index exists. Small change, ~3.5x less retained heap,
   removes the prototype-key hazard. Worth doing before the corpus reaches 1,000.
3. **At ~5,000 entries:** add a release build step emitting a packed, gzipped artifact alongside the
   JSON files, and have consumers prefer it. Halves both bytes shipped and parse time.
4. **At ~25,000 entries:** revisit split packs, with shard size tuned against the consumer's real
   working set — and re-run this harness first, since the crossover point depends on that working
   set far more than on the corpus size.

### Thresholds

Budgets chosen so that the fixture layer stays an insignificant fraction of a signing-path
interaction. Re-run `npm run bench` when the corpus crosses a size row, and treat a breached budget
as the trigger for the next stage.

| Metric | Budget | Baseline breaches it at | Notes |
|---|---|---|---|
| Cold load (Node) | 10 ms | **~5,000 entries** | Extrapolated at ~2.2 µs/entry; 3.9 ms measured at 1,000, 23.8 ms at 10,000 |
| Cold load (Node) | 50 ms | ~20,000 entries | Hard ceiling for an MV3 worker that respawns often |
| Retained heap | 5 MB | **~12,000 entries** | ~420 bytes/entry; 3.9 MB measured at 10,000 |
| Bytes before first lookup | 1 MB uncompressed | **~2,500 entries** | ~416 bytes/entry; matters most for a bundler that inlines the JSON |
| Release artifact | 5 MB gzipped | ~60,000 entries | ~81 bytes/entry gzipped |
| Warm lookup | 1 µs | not breached at 100,000 | Not a practical constraint at any size studied |

The **first** budget the current approach breaches is bytes-before-first-lookup at ~2,500 entries
for a bundler-inlining consumer, then cold load at ~5,000. Stated plainly: **the current approach
becomes insufficient somewhere between 2,500 and 5,000 entries, and stage 3 above is the response.**

---

## Caveats

- **Node, not a browser.** Split packs read shards synchronously here; in a browser each cold shard
  is an async `fetch` or IndexedDB read, adding milliseconds and making `getScore` unavoidably
  async. The adapter's `IOracle` is already async, so the interface survives — but a browser
  measurement should precede any split-pack adoption.
- **Uniform access assumed.** The 512-ID working set is spread evenly across the corpus. Real
  lookups are skewed toward a small set of hot destinations, which favours lazy loading more than
  these numbers show, and would favour it further with an LRU shard cache.
- **Synthetic entries above 12.** Field shapes and note lengths mirror the real corpus, but a future
  schema change (extra fields, longer notes, richer metadata) shifts every per-entry constant here.
  Re-run rather than re-reading these tables after a schema change.
- **Single machine.** The ratios are stable; the absolute milliseconds are not portable.
- **Gzip only.** Brotli would likely shave a further 15–20% off the artifact-size column and is
  worth measuring if ship size ever becomes the binding constraint.

## Cross-repository impact

- **`grydlock-testkit`:** no change now. Stage 3 adds a release build step and a second release
  asset; the JSON files stay canonical.
- **`grydlock-oracle-adapter`:** `StubOracle` currently vendors the JSON and indexes by plain-object
  access. The `Map` change (stage 2) belongs there and is worth doing regardless of corpus size.
  The consumer contract test should keep asserting against `destinations.json`, since that stays the
  source of truth under every stage.
- **`grydlock-extension`:** the beneficiary of every threshold here. Its MV3 service worker
  lifecycle is why startup latency is weighted above lookup latency throughout.
- **`grydlock-research`:** eager loading is correct for research — it sweeps the whole corpus, so
  lazy loading is strictly worse. If split packs are ever adopted, research should keep loading a
  single concatenated artifact.
