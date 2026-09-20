# Passivbot v8.1.0 futures robustness benchmark

The candidate is pinned to `enarjord/passivbot v8.1.0`.

The benchmark is historical/offline and places no orders. Binance Vision USD-M 1m data is supplied through Passivbot's caller-managed OHLCV source directory.

Robustness matrix:
- BTC, ETH, SOL.
- May, June, July, August 2026.
- Evaluation begins on day 8 and runs to month-end.
- Representative upstream `default_trailing_martingale_long.json` configuration.
- 10,000 USDT starting balance.
- Maker fee 0.04%, taker fee 0.055%, market-order slippage 0.05%.

The report records strategy-equity gain, drawdown, Sharpe/Sortino, fill count, turnover and holding duration. Positive results are treated only as historical evidence, not as proof of future profitability.
