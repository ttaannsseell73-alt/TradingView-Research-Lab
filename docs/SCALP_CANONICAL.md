# Canonical Scalping Lane v1

## Scope

This branch is an isolated Binance USDⓈ-M Futures scalping research lane.

It does **not** modify the 30-strategy main system and it does **not** place live orders.

Canonical horizon:

- 5m context
- 1m trigger
- all eligible USDⓈ-M perpetual symbols
- closed-candle signals only
- long and short evaluated separately
- fee + slippage aware evidence
- chronological train / validation / holdout
- paper/testnet before any live promotion

## Core pipeline

```text
Binance futures universe
  -> liquidity/data-quality gate
  -> 5m context
  -> 1m trigger
  -> strategy adapters
  -> coin × strategy × direction replay
  -> fees + slippage
  -> walk-forward + holdout
  -> robustness / evidence gate
  -> ranked candidate board
  -> fresh closed-candle signal
  -> conflict resolver
  -> risk gate
  -> paper/testnet execution
  -> Turkish monitoring panel
```

## Profit-realisation rule

A fixed 1%-5% *price* move is not required. At 5x leverage, a 0.20% underlying move is approximately 1% gross ROE before fees and slippage.

The canonical exit model therefore measures **net ROE after estimated round-trip costs**:

1. profit lock activates only after net ROE reaches the configured activation threshold;
2. once activated, a peak-profit giveback rule can realise gains;
3. a hard upper realise threshold closes without waiting for a reversal;
4. no candidate is promoted only because its raw win rate is high.

Defaults in `research/scalp_gate.mjs` are research defaults, not production guarantees.

## Evidence gates

A candidate is rejected when any hard gate fails:

- too few trades;
- non-positive net expectancy;
- weak validation/holdout profit factor;
- negative holdout return;
- unacceptable drawdown;
- failure under stressed costs.

Very high PF with a thin sample is labelled `EVIDENCE_REVIEW`, not promoted.

Ranking happens **after** hard evidence gates.

## Initial reference sources

See `research/scalp_sources.json`.

The strongest external reference for execution realism is hftbacktest because it models tick replay, latency and queue position. Freqtrade remains a control/reference backtesting engine. External strategy repositories are never copied blindly; ideas are reimplemented under our closed-candle/no-lookahead contract.
