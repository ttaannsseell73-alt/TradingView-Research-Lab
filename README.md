# TradingView Research Lab

Independent research lane for the Binance Futures price-action bot. The repository converts useful TradingView/Kıvanç concepts into original, closed-candle, non-repainting features and subjects them to cost-aware out-of-sample research before any main-bot integration.

## Hard boundary

- No order placement.
- No API secrets.
- No copied Pine code.
- No modification of `binance-bot`.
- No RSI/MACD/TKE-style classical oscillator stack as the canonical decision core.

## Canonical 18-feature contract

`InternalStructure`, `ExternalStructure`, `BOSStrength`, `CHOCHStrength`, `SwingQuality`, `RangeBoundary`, `BreakoutDisplacement`, `LiquidityDensity`, `SweepDepth`, `ReclaimQuality`, `PostSweepDisplacement`, `StructureShiftAfterSweep`, `RetestQuality`, `CompressionDepth`, `CompressionDuration`, `ExpansionVelocity`, `TrendRangeScore`, `RelativeVolume`.

## Research pipeline

```text
closed OHLCV
  -> 18-feature engine
  -> deterministic replay / no-lookahead checks
  -> breakout | sweep/reclaim | compression-release events
  -> fee + slippage aware forward-return study
  -> chronological train / validation / holdout
  -> PASS | REJECT | INSUFFICIENT_DATA
  -> only then controlled promotion to the main bot
```

## Commands

```bash
npm ci
npm run check
```

Download public Binance USDⓈ-M candles without API keys:

```bash
npm run fetch:binance -- BTCUSDT 1m 5000 BTCUSDT-1m.csv
```

Run the research gate on a canonical CSV:

```bash
npm run research -- BTCUSDT-1m.csv 12
```

CSV schema:

```text
timestamp,open,high,low,close,volume
```

The CLI prints candle count, deterministic replay signature, event count, train/validation/holdout metrics and promotion decisions. A PASS means only that the configured research gate passed on the supplied data; it is not a guarantee of future performance.
