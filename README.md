# TradingView Research Lab

Independent research lane for the Binance Futures price-action bot. The repository converts useful TradingView strategies and indicator concepts into original, closed-candle, non-repainting research adapters, scans them coin-by-coin across Binance Futures, and ranks strategy × coin × timeframe opportunities before any main-bot integration.

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
  -> train-only setup-threshold tuning
  -> breakout | sweep/reclaim | compression-release events
  -> fee + slippage aware forward-return study
  -> chronological train / validation / holdout
  -> multi-horizon + stressed-cost robustness matrix
  -> PASS | REJECT | INSUFFICIENT_DATA per setup
  -> only then controlled promotion to the main bot
```

## Software validation

```bash
npm ci
npm run check
```

## Final local market-data gate

One command downloads 50,000 public Binance USDⓈ-M candles on both 1m and 5m, runs the full acceptance matrix, and writes `FINAL_ACCEPTANCE.json`:

```bash
npm run final:local
```

No API key is required. Optional symbol/sample size:

```bash
npm run final:local -- ETHUSDT 50000
```

A setup is promotable only when it appears under `promotable` in `FINAL_ACCEPTANCE.json`. This is historical research evidence, not a guarantee of future performance.

See `PROJECT_STATE.md` and `docs/ACCEPTANCE.md`.


## Strategy Selector expansion

The active research direction is now broader than Kıvanç. Kıvanç is the first implemented strategy pack, not the product boundary.

Canonical target:

```
extensible TradingView strategy catalog
  -> all eligible Binance Futures coins
  -> 1m / 5m / 1h / 4h / 1d
  -> cost-aware backtest
  -> Top-5 profitable coins per strategy/timeframe
  -> Opportunity Board
```

See `docs/STRATEGY_SELECTOR.md` and `research/strategy_catalog.json`.
