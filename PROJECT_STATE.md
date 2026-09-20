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
- Main `binance-bot` remains untouched.

## Promotion rule

Promotion is per setup, not all-or-nothing. A setup is a candidate only if every configured validation/holdout horizon and cost scenario is `PASS` with the minimum sample count. `REJECT` and `INSUFFICIENT_DATA` remain blocked.

## Final physical gate

GitHub-hosted runners are not relied on for Binance Futures downloads because that endpoint can be geo-blocked from hosted infrastructure. The final full-size market-data acceptance is intentionally local.

One command performs the complete final gate for BTCUSDT on 1m and 5m with 50,000 candles each:

```bash
npm run final:local
```

It produces `FINAL_ACCEPTANCE.json`. No API key is required.
