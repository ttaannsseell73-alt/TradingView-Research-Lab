# Final Research Acceptance Gate

The repository is software-complete when CI is green. Strategy evidence is intentionally a separate gate because hosted GitHub runners can be geo-blocked from Binance Futures market-data endpoints.

## Required local evidence

Use a sufficiently large public USDⓈ-M candle sample. No API key is required.

```bash
npm ci
npm run fetch:binance -- BTCUSDT 1m 50000 BTCUSDT-1m.csv
npm run acceptance -- BTCUSDT-1m.csv BTCUSDT-1m-acceptance.json
```

The acceptance command performs:

- timestamp/OHLCV integrity and gap checks,
- deterministic 18-feature replay,
- all three canonical setup families,
- chronological train/validation/holdout isolation,
- horizons 3/6/12/24 bars,
- base and stressed transaction-cost assumptions,
- minimum-sample and positive-net-expectancy promotion gates.

A setup is robustly accepted only when **every** configured horizon/cost run passes. Any insufficient window remains `INSUFFICIENT_DATA`; it is never converted into a pass.

The generated JSON is evidence, not an execution command. Main-bot integration remains blocked until this local evidence exists.
