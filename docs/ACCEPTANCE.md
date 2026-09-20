# Final Research Acceptance Gate

CI proves software integrity. Historical market evidence is a separate gate because hosted GitHub runners can be geo-blocked from Binance Futures endpoints.

## One-command final gate and evidence publication

On the target Windows machine:

```bash
npm run final:local:publish
```

This downloads 50,000 public USDⓈ-M candles for BTCUSDT on both 1m and 5m, runs the canonical acceptance pipeline, writes `FINAL_ACCEPTANCE.json`, commits the compact JSON evidence files, and pushes them to `main`.

Raw CSV market data is not committed. The final evidence contains its SHA-256 hashes and byte sizes.

Optional local-only run:

```bash
npm run final:local
```

Optional symbol / sample size:

```bash
npm run final:local -- ETHUSDT 50000
```

No API key is required.

## What acceptance does

- timestamp/OHLCV integrity and gap checks,
- deterministic 18-feature replay,
- train-only threshold tuning,
- breakout / liquidity-sweep-reclaim / compression-release event studies,
- chronological train/validation/holdout isolation,
- 3/6/12/24-bar horizons,
- base and stressed transaction costs,
- minimum sample enforcement,
- positive net expectancy requirement on validation and holdout.

Promotion is evaluated **per setup**. A setup becomes a candidate only when every configured robustness run passes. One rejected or insufficient run blocks that setup.

The generated JSON is research evidence, not an execution command. Main-bot integration remains blocked until a setup is listed under `promotable`.
