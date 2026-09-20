# Project Lock

## Purpose

TradingView Research Lab is an isolated research lane for the Binance Futures price-action system. It measures ideas before they are allowed anywhere near execution.

## Locked rules

- `binance-bot` is not modified from this repository.
- Price action remains the decision core; classical oscillators are not promoted as primary signals.
- TradingView/Pine code is not copied. Public scripts are research references; implementations here are original.
- Only closed candles are accepted by the canonical feature engine.
- No-lookahead/repaint behavior is enforced with prefix-invariance tests.
- Research includes fees and slippage before expectancy is evaluated.
- Chronological train/validation/holdout windows are mandatory.
- Final acceptance includes 3/6/12/24-bar horizons and both base/stressed transaction-cost scenarios.
- Raw historical data must pass timestamp/OHLCV continuity checks before research evidence is accepted.
- A software PASS is not a profitability claim.
- Promotion requires validation **and** untouched holdout evidence with minimum sample counts.
- A setup must survive every configured robustness run; one insufficient or rejected run blocks robust acceptance.
- This repository has no order-placement code and needs no exchange API secret.
