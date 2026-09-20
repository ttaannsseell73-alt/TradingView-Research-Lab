# Passivbot Futures Benchmark V1

This benchmark evaluates a ready-made perpetual-futures grid/market-making engine without changing BinanceGridBot.

## Engine

- upstream: `enarjord/passivbot`
- revision: `v8.1.0`
- exchange: Binance USDT-M Futures
- symbols: BTC, ETH, SOL
- timeframe: Passivbot native 1-minute backtester
- window: 2026-08-01 through 2026-09-01
- starting balance: 10,000 quote units per independent symbol run

## Explicit cost assumptions

- maker fee: 0.0004
- taker fee: 0.00055
- market-order slippage: 0.0005

These are fixed benchmark assumptions, not a claim about any user's actual Binance fee tier.

## Output

Each symbol produces Passivbot's native `analysis.json`, fills and equity artifacts. The workflow also emits a normalized `PASSIVBOT_SUMMARY.json` containing gain, ADG, drawdown, loss/profit ratio, Sharpe, Sortino, fill count and completion metrics when present.

## Interpretation

This is historical research evidence only. Repository stars, example screenshots, or a positive single-window backtest are not treated as proof of future profitability. A candidate that looks promising here must still survive longer windows, stressed costs and TESTNET/paper execution.
