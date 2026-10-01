# FULL RESET RESEARCH — 2026-10-01

## Locked goal
Everything is rescanned from scratch. Old PASS/FAIL results are evidence only; they do not grant acceptance in this run.

## Universe
- Scan the full locally archived Binance USD-M history, including old/inactive/delisted symbols.
- Historical dead coins remain in reports so old strategy behavior is visible.
- Dead/inactive/illiquid coins are **never promotable** to the current candidate list.
- Current candidate promotion is a separate market-health gate after backtest qualification.

## Mandatory recent-performance gates
A strategy × coin × timeframe × direction candidate cannot advance unless:
1. last 3 eligible months: **3/3 PASS**
2. last 6 eligible months: **6/6 PASS**
Only after both are true do 9m/12m/older history, drawdown, PF, expectancy and regime behavior affect ranking.

## September 2026
Backfill missing September data through 2026-10-01T00:00:00Z, re-audit coverage, then rerun every affected recent window. No candidate is final on partial September data.

## Coin health gate
Backtest PASS is not enough. A current candidate must also be currently trading and satisfy current execution-quality thresholds from the configurable policy. Inactive/delisted symbols are HISTORICAL_ONLY. Liquidity collapse is a blocker.

## Strategy isolation
Existing strategies are immutable for this sweep. Families are run separately and retain provenance:
SR35, Sweep20, ALGO9/Kivanc, Fibonacci/Elliott/Harmonic, Q-Class, Near-Pass/Recovery, STR100 exact-source, Freqtrade/scalp, model-based benchmarks, and newly discovered tactics.
No family overwrites or mutates another family's implementation or historical artifacts.

## Fibonacci / Elliott
Mandatory full-universe rescan:
- Golden Pocket
- Fibonacci 0.382 / 0.500 / 0.618 / 0.786
- Elliott W2→W3
- Elliott W4→W5
- Elliott ABC
- Harmonic XABCD PRZ

## Reporting
Every task writes an atomic checkpoint. Raw rows are preserved. Final outputs must include:
- MASTER_STATUS.json
- STRATEGY_INVENTORY.json
- ALL_RESULTS.ndjson
- RECENT_3M_PASS.csv
- RECENT_6M_PASS.csv
- PROMOTABLE_CURRENT.csv
- HISTORICAL_ONLY.csv
- REJECTED_COIN_HEALTH.csv
- FAILURES.json
- CHECKPOINT_INDEX.json
- FINAL_REPORT.md

Reports must expose coin, strategy, provenance, timeframe, direction, 3m/6m/9m/12m pass counts, monthly PnL, PF, DD, trades, expectancy, stress result, coverage, listing age, current trading status, volume, spread, depth, OI, and exact rejection reason.

## Modifiability
All thresholds and run scope live in JSON configuration. No threshold is hard-coded into strategy implementations.
