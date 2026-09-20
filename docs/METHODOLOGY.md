# Research Methodology

## 1. Feature computation

The engine produces exactly 18 locked features. Reference highs/lows, range baselines and volume baselines use prior candles only. The current candle can trigger an event but cannot rewrite its own reference history.

## 2. Setup families

Only three initial setup families are emitted:

- `breakout`
- `liquidity_sweep_reclaim`
- `compression_release`

These are measurable event families, not trading recommendations.

## 3. Cost-aware event study

For each event, the research layer records signed forward return, round-trip fee/slippage deduction, MAE and MFE. Long and short outcomes share the same signed-return convention.

## 4. Walk-forward isolation

The default split is chronological 60% train / 20% validation / 20% holdout. Events whose forward horizon crosses a window boundary are discarded from that window. Holdout is not used for tuning.

## 5. Promotion gate

A setup cannot PASS when either validation or holdout lacks the configured minimum samples. Both validation and holdout net expectancy must clear the configured threshold after costs. `INSUFFICIENT_DATA` is distinct from `REJECT`.

## 6. Reproducibility

Identical candles/config produce identical feature rows and replay signature. CI runs build plus deterministic tests. External live market downloads are deliberately not part of CI.
