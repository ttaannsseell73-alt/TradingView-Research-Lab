# SonarScalp V4 — 1m Taker Microstructure + Barrier Exits

V3 failed across the multi-symbol universe. V4 changes the hypothesis instead of relaxing the failed gate.

- Real Binance Futures 1m taker-buy volume creates synchronous 1m taker imbalance.
- Public 5m Open Interest history confirms participation expansion.
- 1m price action remains the structural trigger.
- 5m context blocks strongly opposing structure.
- Entry is the next 1m open.
- Exits use predeclared TP/SL/time barrier profiles.
- If TP and SL are both touched in one 1m bar, the stop is assumed first.
- The exit profile is selected only on the train window, then frozen for validation and holdout.
- Base and stress transaction-cost cases must both pass.
- The same rules run across majors and liquid alts; no symbol-specific threshold tuning.

This remains isolated from BinanceGridBot and Freqtrade-Research-Lab.

Run:

```bash
npm run sonar:v4:universe:local:publish
```
