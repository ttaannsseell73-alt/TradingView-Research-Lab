# SonarScalp V3 — Real Orderflow Layer

V1 and V2 used candle-derived Sonar proxies. V3 tests a materially different hypothesis with **real Binance Futures public orderflow statistics**.

Inputs:
- existing BTCUSDT 1m and 5m candles,
- Binance USDⓈ-M 5m taker buy/sell volume,
- Binance USDⓈ-M 5m open-interest history.

Signal:
- 1m price-action trigger,
- taker pressure aligned with trigger direction,
- open interest rising,
- 5m context must not strongly oppose the trade,
- relative-volume filter,
- next-1m-open entry.

No CVD is fabricated from candles. No main bot code is touched.

Binance retains these futures-data statistics for only the latest 30 days, so the local runner downloads 29 days and automatically restricts the study to the overlapping 1m window.

Run:

```bash
npm run sonar:v3:local:publish
```
