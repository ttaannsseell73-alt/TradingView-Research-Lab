# PROJECT STATE

Canonical branch: `main`

## Software state

- Canonical 18-feature price-action contract implemented.
- Closed-candle, monotonic timestamp and OHLCV validation implemented.
- Deterministic replay and no-lookahead prefix invariance implemented.
- Kıvanç/TradingView candidate map implemented without copying Pine source.
- Breakout, liquidity sweep/reclaim and compression-release setup families implemented.
- Fee/slippage-aware event study implemented.
- Chronological 60/20/20 train/validation/holdout isolation implemented.
- Train-only threshold tuning implemented. Validation and holdout are never used to select thresholds.
- Multi-horizon 3/6/12/24 robustness matrix implemented.
- Base and stressed transaction-cost scenarios implemented.
- Final data-quality and acceptance gate implemented.
- Main `BinanceGridBot` remains untouched.

## Promotion rule

Promotion is per setup, not all-or-nothing. A setup is a candidate only if every configured validation/holdout horizon and cost scenario is `PASS` with the minimum sample count. `REJECT` and `INSUFFICIENT_DATA` remain blocked.

## Final acceptance — CLOSED

Final evidence commit: `1f6ccefa7a697ac986e9b1a9b6686b45b7fe629c`

Dataset:
- BTCUSDT 1m: 50,000 candles, quality PASS, zero detected gaps, SHA-256 recorded in `FINAL_ACCEPTANCE.json`.
- BTCUSDT 5m: 50,000 candles, quality PASS, zero detected gaps, SHA-256 recorded in `FINAL_ACCEPTANCE.json`.
- Source implementation commit recorded by the evidence: `6e695b52537406036ae521aa7337e9b92c83b6d3`.
- Evidence CI: PASS.

Final status: `NO_PROMOTABLE_SETUP`.

Per-setup result on both 1m and 5m across the configured 3/6/12/24 horizons and base/stress cost scenarios:
- `breakout`: REJECT.
- `liquidity_sweep_reclaim`: REJECT.
- `compression_release`: INSUFFICIENT_DATA.

Therefore no TradingView/Kıvanç setup from this research lane is approved for promotion into `BinanceGridBot`. The rejection is the final research result for this version; gates are not to be loosened to manufacture a PASS.

Raw CSV market data remains local and ignored. Only compact acceptance evidence is committed.

## Project disposition

This research lane is complete and frozen at the final acceptance result above. Reopen only for a materially new hypothesis, setup family, dataset scope, or explicit user decision.

## Reopened research lane — SonarScalp V1

Branch: `research/sonar-scalping-v1`

This is a materially new hypothesis. The frozen Kıvanç/TradingView result remains unchanged. This branch tests 5m context + 1m trigger scalping with next-bar entry and fail-closed cost/holdout gates. `BinanceGridBot` and `Freqtrade-Research-Lab` remain untouched.
