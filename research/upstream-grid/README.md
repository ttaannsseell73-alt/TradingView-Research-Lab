# Upstream Grid Benchmark V1

This lane is isolated from the canonical TradingView feature research.

It does not place orders, does not use API secrets, and does not modify BinanceGridBot.

## Initial candidates

- enarjord/passivbot v8.1.0
- jordantete/grid_trading_bot
- 51bitquant/binance_grid_trader (legacy compatibility reference)

## Gate 1 — technical readiness

A project must install cleanly, expose a usable backtest/simulation entry point, and pass its own deterministic tests or an equivalent reproducible smoke.

Repository popularity is not treated as evidence of profitability.

## Gate 2 — common performance benchmark

Technical survivors are compared under the same conditions:

- BTCUSDT, ETHUSDT, SOLUSDT
- same historical windows
- same fee/slippage assumptions
- net return after costs
- maximum drawdown
- profit factor
- fill/trade count
- exposure utilization
- stability across symbols and chronological windows

Only after this common benchmark do we decide whether any project is worth paper/testnet evaluation.
