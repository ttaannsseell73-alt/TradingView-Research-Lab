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

## SonarScalp V2 — regime separation

Branch: `research/sonar-scalping-v2-regime`

V1 evidence is preserved. V2 separates trend-retest from range-sweep instead of mixing incompatible regimes. It remains isolated from `BinanceGridBot` and `Freqtrade-Research-Lab`.

## SonarScalp V3 — orderflow

Branch: `research/sonar-scalping-v3-orderflow`

V3 is the first Sonar scalp hypothesis in this lab that uses real Binance public taker-volume and open-interest history instead of candle-only proxies. V1/V2 evidence remains preserved. `BinanceGridBot` and `Freqtrade-Research-Lab` remain untouched.

## SonarScalp V4 — 1m taker microstructure

Branch: `research/sonar-scalping-v4-taker1m`

V3 multi-symbol evidence remains preserved as rejected. V4 tests real 1m Binance taker-buy imbalance, 5m Open Interest and train-only TP/SL/time barrier selection. It is a new hypothesis, not a relaxation of V3. BinanceGridBot and Freqtrade-Research-Lab remain untouched.


## SonarScalp V4 final acceptance — CLOSED

Evidence commit: `cfd6981a1ec65289ac71567bdd32caac341c85e5`

Universe:
- BTCUSDT
- ETHUSDT
- SOLUSDT
- XRPUSDT
- DOGEUSDT
- AVAXUSDT
- ENAUSDT
- NEARUSDT
- SUIUSDT
- 1000PEPEUSDT
- ARBUSDT
- INJUSDT

Final status: `NO_PROMOTABLE_SYMBOL`.

All 12 symbols are `REJECT` under both base and stress cost scenarios. No symbol produced a positive validation+holdout robustness result. Importantly, the train-selected profiles are already net-negative across the universe, so the failure is not merely a holdout or transaction-cost artifact.

Decision:
- Do not loosen V4 thresholds or re-optimize the same hypothesis against these holdouts.
- Do not promote any SonarScalp V1–V4 logic into `BinanceGridBot`.
- Freeze the SonarScalp V1–V4 family here.
- Reopen only for a materially different signal family or data source, not another threshold variant of the same candle/taker/OI construction.

`BinanceGridBot` and `Freqtrade-Research-Lab` remain untouched.
