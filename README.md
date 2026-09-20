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
  -> data-quality gate
  -> 18-feature engine
  -> deterministic replay / no-lookahead checks
  -> breakout | sweep/reclaim | compression-release events
  -> fee + slippage aware forward-return study
  -> chronological train / validation / holdout
  -> multi-horizon + stressed-cost robustness matrix
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
npm run fetch:binance -- BTCUSDT 1m 50000 BTCUSDT-1m.csv
```

Run the final acceptance gate:

```bash
npm run acceptance -- BTCUSDT-1m.csv BTCUSDT-1m-acceptance.json
```

CSV schema:

```text
timestamp,open,high,low,close,volume
```

The acceptance output includes data-quality results, deterministic replay signature, event count, 3/6/12/24-bar studies, base/stressed transaction costs, walk-forward metrics, and robust promotion decisions.

A PASS means only that the configured research gate passed on the supplied historical sample; it is not a guarantee of future performance. See `docs/ACCEPTANCE.md`.
