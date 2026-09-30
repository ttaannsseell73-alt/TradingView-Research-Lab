# Fibonacci / Elliott Causal Benchmark V1

## Scope
This benchmark adds nine executable adapters across six research families:
- Fibonacci Golden Pocket 0.618-0.670
- Fibonacci retracement 0.382 / 0.500 / 0.618 / 0.786
- Elliott Wave 2 -> Wave 3
- Elliott Wave 4 -> Wave 5
- Elliott ABC completion reversal
- Harmonic XABCD PRZ: Gartley, Bat, Butterfly, Crab

## Causality contract
- Pivots use 3 left bars and 3 right bars.
- A pivot is invisible until its right-side confirmation bars have closed.
- New information may replace the current swing state only from its confirmation bar forward.
- Historical target arrays must be prefix invariant.
- Signals are executed by the common engine at the next candle open.
- No centered indicator writes a signal backward onto the pivot candle.

## Fixed V1 research choices
- Minimum impulse size: 2.5 current ATR(14).
- Elliott Wave-2 retracement: 0.382-0.786.
- Elliott Wave-4 retracement: 0.236-0.500.
- ABC B retracement: 0.382-0.786; C extension: 0.618-1.618.
- Target-position horizon: fixed 12 bars for every adapter.
- No per-coin or per-timeframe parameter optimization in V1.
- Common costs: 14 bps baseline, 15 bps stress, 6 bps low-cost diagnostic.

## One-year benchmark
Canonical window: 2025-09-20 through 2026-09-20.
Universe: exact 725-symbol local Binance USDT-M set.
Timeframes: 5m, 15m, 1h, 4h.
Total strategy combinations: 725 x 4 x 9 = 26,100.

The first one-year run is discovery only. Promotion still requires monthly robustness, holdout/replay and later forward evidence.
