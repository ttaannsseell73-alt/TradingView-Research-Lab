# jordantete/grid_trading_bot robustness benchmark

Pinned upstream revision: `93d5e57191bdf10ce3be4f8f6db30e768ba9dd60`.

The benchmark remains fully historical/offline and sends no orders.

Robustness matrix:
- BTCUSDT, ETHUSDT, SOLUSDT.
- May, June, July, August 2026.
- First 7 days of each month select the grid range only.
- Day 8 through month-end is out-of-sample evaluation.
- Both `simple_grid` and `hedged_grid`.
- 8 geometric grid levels.
- 10,000 USDT starting balance.
- 0.04% trading fee and 0.05% simulated backtest slippage.

Primary evidence is not ROI alone. The report also records grid-trading gains, drawdown, fees, trade count, and excess return versus buy-and-hold. A positive account ROI caused mainly by retained directional inventory is therefore not treated as proof of grid profitability.
