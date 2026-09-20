# SonarScalp V1–V4 Final Research Result

## Final disposition

The SonarScalp research family is closed at V4 with **no promotable symbol**.

Final V4 evidence commit:
`cfd6981a1ec65289ac71567bdd32caac341c85e5`

CI on the evidence commit: PASS.

## What was tested

- V1: 5m context + 1m candle-derived trigger.
- V2: separate trend-retest and range-sweep hypotheses.
- V3: real Binance 5m taker buy/sell volume + 5m Open Interest + 1m price-action trigger.
- V4: real Binance 1m taker-buy imbalance + 5m Open Interest + 1m price-action trigger + train-only TP/SL/time barrier selection.

V4 universe:
BTCUSDT, ETHUSDT, SOLUSDT, XRPUSDT, DOGEUSDT, AVAXUSDT, ENAUSDT, NEARUSDT, SUIUSDT, 1000PEPEUSDT, ARBUSDT, INJUSDT.

## Result

Every V4 symbol is `REJECT` in both base and stress transaction-cost scenarios.

There is no evidence that the failure can be fixed by simply relaxing the gate:
the train-selected V4 profiles are already net-negative across all 12 symbols. Validation and holdout also remain negative, and profit factors stay below 1.

## Research rule

Do **not** continue tuning thresholds, symbol-specific settings, or exit profiles against the same V4 holdouts. That would turn the acceptance set into a training set and destroy the evidentiary value of the experiment.

A future Sonar scalp experiment must introduce a materially different hypothesis or data source, for example true trade-by-trade/tick sequencing, order-book depth/imbalance, liquidation flow, or a different event definition. Such work should start on a fresh branch and fresh holdout period.

No SonarScalp V1–V4 code is approved for promotion into `BinanceGridBot`.
