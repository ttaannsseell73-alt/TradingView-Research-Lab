# jordantete/grid_trading_bot common benchmark

This benchmark is historical and offline. It sends no exchange orders and uses no API secrets.

Data:
- official Binance Vision USD-M futures 1m candles
- BTCUSDT, ETHUSDT, SOLUSDT
- August 2026

Method:
- 2026-08-01 through 2026-08-07 is used only to freeze each grid range.
- 2026-08-08 through 2026-08-31 is the evaluation window.
- Grid range uses the train-only 2nd/98th percentile low/high, expanded by 0.5%.
- Hedged geometric grid, 8 levels.
- Initial balance: 10,000 USDT.
- Trading fee: 0.04% per fill.
- Backtest slippage: 0.05%.

The output is evidence for comparison, not proof of future profitability.
