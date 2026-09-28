# SPEED STATE

Canonical speed checkpoint: 2026-09-28

## Purpose

Two separate speed tracks are locked:

1. Repository/backtest execution speed.
2. Operator/context speed: continue from this checkpoint instead of rebuilding project history.

## Data state

- Approximately two years of local Binance Futures history is already downloaded.
- Only part of September 2026 remains incomplete.
- Do not redownload the completed historical dataset for research runs.
- Canonical local DataHub root: `D:/Futures-Research-Data`.
- Existing Freqtrade futures root: `C:/Users/TANSEL/Desktop/SCALPING_LAB/freqtrade/user_data/data/binance/futures`.

## Repository speed architecture

New fast path:

- Canonical 1m Feather is read at most once per symbol per batch.
- Requested 1m/5m/15m/1h/4h datasets are derived from that same in-memory source.
- Derived CSVs are persisted under the research cache.
- Cache entries are invalidated when date range or source file size/mtime changes.
- Existing `run-datahub-plan-checkpointed.mjs` remains the evaluation engine.
- `REUSE_EXISTING_CSV=1` makes evaluation consume the prepared cache without spawning one Python exporter per task.

Implementation:

- `scripts/export-freqtrade-feather-batch.py`
- Added in commit `6e5cd4b70f2b33055e119107d9061bf85faf164c`.

Expected large-run improvement:

- Previous ALGO9 725 symbols × 5 timeframes = 3,625 task-level data preparations.
- Fast path targets about 725 source reads on a cold cache and zero source reads on an unchanged warm cache.

## Benchmark

Reference coin: `TLMUSDT`.

Benchmark dataset:

- timeframe: 15m
- start: 2024-09-20T00:00:00Z
- end: 2026-09-20T00:00:00Z
- canonical ALGO9 nine-strategy pack
- monthly breakdown enabled

Workflow:

- `.github/workflows/tlm-2y-speed-benchmark.yml`
- Added in commit `a3f0e533effad06052f18a6f0717acbe9fe17cf8`.
- Trigger issue: #96
- Workflow run: `36457015198`

Safety gate:

- New batch export must be byte-identical to the legacy TLMUSDT 15m exporter output by SHA-256.
- Benchmark fails before research execution if parity differs.

Current runtime status:

- Run `36457015198` is queued.
- Multiple self-hosted local workflows are queued and no local workflow is currently in progress, so the local runner is not taking jobs at this checkpoint.

## Continuation rule

Future speed-related requests start from this file and current repo HEAD.

Do not reconstruct prior conversations unless a required fact is absent or conflicts with the repo state.

Do not reopen architecture decisions during commands such as:

- continue
- run
- test
- status
- benchmark

Only inspect the delta needed for the new command.


## Canonical speed implementation — 2026-09-28

The speed optimization is now unconditional; it is not gated on the abandoned TLM benchmark.

Repository execution:
- Local batch cache is canonical in both checkpointed and standard research runners.
- One 1m Feather read per symbol prepares all requested timeframes.
- Derived CSV cache is persistent under D:/Futures-Research-Data/research-cache.
- SR25, SR35 and ALGO9 share the same 2026 multi-timeframe cache.
- Range48 uses its own persistent 1Y/15m cache.
- Monthly candle slicing is single-pass instead of repeated full-array filtering.
- NDJSON result emission is buffered instead of row-by-row synchronous append.
- Heavy local workflows use 4 parallel Node shards inside the self-hosted runner.
- Parallel wrapper preserves same-topology checkpoints for resume and removes stale incompatible shard topology.
- SR35/ALGO9 and Range48 summarizers read all parallel checkpoint directories.

Primary implementation files:
- scripts/export-freqtrade-feather-batch.py
- scripts/run-datahub-plan-checkpointed.mjs
- scripts/run-datahub-plan.mjs
- scripts/run-datahub-plan-parallel-local.mjs
- scripts/summarize-sr35.mjs
- scripts/summarize-range48-1y.mjs

Heavy workflows configured for the fast path:
- .github/workflows/algo9-2026-full-local.yml
- .github/workflows/sr25-2026-full-local.yml
- .github/workflows/sr35-2026-full-local.yml
- .github/workflows/range48-1y-15m-full-local.yml

TLM benchmark run 36457015198 was cancelled. Speed optimization remains enabled regardless of benchmark comparison.
