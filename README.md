# TradingView Research Lab

Independent research repository for the Binance Futures price-action bot. It
distills useful ideas from open TradingView indicators into original,
repaint-free TypeScript features and validates them before any main-bot change.

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

## Commands

```bash
npm install
npm run check
```

The first milestone implements the locked feature contract and integrity gates.
Signal profitability is deliberately not claimed until real Binance replay and
out-of-sample testing pass.
