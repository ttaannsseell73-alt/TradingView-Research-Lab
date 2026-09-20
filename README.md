# TradingView Research Lab

Independent research repository for the Binance Futures price-action bot. It distills useful ideas from open TradingView indicators into original, repaint-free TypeScript features and validates them before any main-bot change.

## Boundary

- This repository is **not** an execution engine.
- It never submits orders and never needs API keys.
- It does not copy Pine source code.
- `BinanceGridBot` remains untouched until a feature passes `RESEARCH_GATE.md`.

## Canonical flow

```text
closed Binance candles
  -> canonical 18-feature engine
  -> deterministic replay / no-lookahead checks
  -> fee and slippage aware OOS research
  -> ACCEPT or REJECT
  -> controlled promotion to BinanceGridBot
```

## Locked canonical feature contract

`InternalStructure`, `ExternalStructure`, `BOSStrength`, `CHOCHStrength`, `SwingQuality`, `RangeBoundary`, `BreakoutDisplacement`, `LiquidityDensity`, `SweepDepth`, `ReclaimQuality`, `PostSweepDisplacement`, `StructureShiftAfterSweep`, `RetestQuality`, `CompressionDepth`, `CompressionDuration`, `ExpansionVelocity`, `TrendRangeScore`, `RelativeVolume`.

## Commands

```bash
npm install
npm run check
```

The first milestone implements the locked 18-feature contract, closed-candle enforcement, deterministic replay, repaint/no-lookahead prefix invariance, and 9 deterministic tests. Signal profitability is deliberately not claimed until real Binance replay and out-of-sample testing pass.
