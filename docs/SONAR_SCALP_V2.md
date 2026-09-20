# SonarScalp V2 — Regime Separation

V1 mixed trend-continuation and sweep/reclaim behavior under one directional-context rule. Its validation and holdout gross expectancy were already negative before transaction costs, so V2 does not loosen V1 thresholds.

V2 tests two distinct hypotheses independently:

1. **trend_retest** — strong 5m directional context + 1m retest in the same direction.
2. **range_sweep** — neutral 5m directional context + 1m sweep/reclaim from the opposite side of the 5m range.

Both enter on the next 1m open. No future candle is used in signal formation. No RSI/MACD layer is added.

Acceptance:
- 3 / 5 / 8 / 12 minute fixed horizons,
- base and stressed transaction costs,
- chronological 60/20/20 train / validation / holdout,
- minimum 30 samples in both validation and holdout,
- each setup is judged independently,
- a setup must pass every horizon/cost run.

This is a new hypothesis, not a re-tuning of V1 on its holdout.

Run locally:

```bash
npm run sonar:v2:local:publish
```
