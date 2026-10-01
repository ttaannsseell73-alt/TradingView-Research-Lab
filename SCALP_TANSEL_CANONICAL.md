# SCALP TANSEL — CANONICAL LOCK

Updated: 2026-10-01

## Lookup contract
Command: **SCALP TANSEL**

When this command is used, start from this canonical scalp-only state. Do not re-derive old work unless explicitly requested.

## Scope
- Separate scalping research lane.
- Candidate discovery is evaluated **without leverage first**.
- Leverage (x3/x5/x10) is a later execution/risk layer and must not be used to discard the underlying scalp candidate pool.
- Primary timeframes: **1m / 5m / 15m**.
- Target final universe: **5–10 independent strong scalp candidates**.
- Same coin + materially same signal behaviour = **one candidate cluster**, not multiple votes.
- Source strategy rules remain canonical; no silent strategy mutation.

## Candidate tiers
### S — 9/9
- **GPSUSDT — 15m — Liquidity Reclaim cluster**
  - 9/9 PASS.
  - Equivalent implementations (count as ONE candidate):
    - sr_liquidity_sweep
    - sr25_liquidity_sweep_reclaim
    - swp_range24_reclaim

### A — 6/6 + current health
Current strong scalp pool includes:
- LITUSDT — 5m — Quickie
- MMTUSDT — 1m — ReinforcedSmoothScalp
- BICOUSDT — 1m — CCI Strategy
- ETHUSDT — 5m — ORB
- UBUSDT — 5m — ORB
- UBUSDT — 5m — MACD Crossed
- VVVUSDT — 5m — MACD Crossed
- PLUMEUSDT — 5m — MACD Crossed
- XMRUSDT — 5m — MACD Crossed
- PUMPUSDT — 5m — MACD Crossed
- AEROUSDT — 5m — MACD Crossed
- ALGOUSDT — 5m — ReinforcedQuickie

Notes:
- UB has two genuinely different strategy behaviours and may remain two setups, but still one coin for portfolio limits.
- Health/reliquidity must be rechecked when promoting to live/paper.

### B — 3/3
- **3/3 PASS setups are INCLUDED in the candidate pool.**
- Before being counted as independent candidates they must pass:
  1. current health/liquidity,
  2. duplicate/correlation dedupe,
  3. minimum trade-count sanity.
- Do not inflate the candidate count with repeated implementations of the same behaviour.

## Promotion logic
Research ordering:
1. 9/9
2. 6/6
3. 3/3
Then:
- current health,
- duplicate/correlation dedupe,
- trade-count sanity,
- only afterward leverage/risk testing.

## Known invalid/stale state
- Old STR100 scalp-native RUNNING state became stale after worker PIDs died in timeout/restart loops.
- FVG Motion / Turtle Soup exact-source checkpoints are preserved but must NOT be reported as actively running unless live PIDs are verified.
- Anonymous strategy001/004 results are NOT canonical candidates until provenance/source identity is resolved.

## Working rule
When asked **"SCALP TANSEL"** or **"scalp tansel durum"**, report this lane only and update it with newly validated scalp results.
