# SonarScalp V1

SonarScalp V1 is a new hypothesis inside the isolated TradingView research repository.

- 5m closed candle = directional context.
- 1m closed candle = trigger.
- Entry = next 1m candle open.
- Triggers = sweep/reclaim, retest, or structure shift.
- Relative-volume confirmation is required.
- Opposing 5m breakout blocks entry.
- No RSI/MACD decision layer.
- No execution/order code.

Robustness uses 2/3/5/8-bar exits, base and stressed costs, chronological 60/20/20 windows, and a minimum of 30 validation and holdout events. Every run must pass.

Historical OHLCV does not contain real CVD, taker imbalance, or Open Interest. These are not fabricated. If candle-only V1 survives, live Sonar dimensions can be added later as forward filters.

Local acceptance:

```bash
npm run sonar:local:publish
```

Existing 50k 1m/5m CSV files are reused when available. Raw data remains local; only `SONAR_SCALP_ACCEPTANCE.json` is published.
