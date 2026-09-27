# Visual Strategy Pool — canonical catalog

Rule: no strategy is rejected because it looks weak, unusual, closed-source, or redundant. If its rules can be made deterministic, it stays in the research pool. Closed/opaque items remain SOURCE_NEEDED rather than being silently dropped.

## Direct / strategy-like
- Bollinger + RSI Double Strategy — IMPLEMENTED_DERIVED: vis_bollinger_rsi_double
- MACD + SMA 200 Strategy — IMPLEMENTED_DERIVED: vis_macd_sma200
- SuperTrend STRATEGY — Kıvanç — IMPLEMENTED_DERIVED: vis_supertrend_10_3
- MACD Bull Crossover + RSI — IMPLEMENTED_DERIVED: vis_macd_rsi
- PMax Explorer Strategy — EXISTING_ENGINE: pmax
- 3Commas Bot — CATALOGUED_NEXT_ADAPTER
- Hull Suite Strategy — IMPLEMENTED_DERIVED: vis_hull_suite
- AO + Stoch + RSI + ATR — CATALOGUED_NEXT_ADAPTER
- Ultimate Strategy Template — CATALOGUED_NEXT_ADAPTER
- Single EMA Cross — IMPLEMENTED_DERIVED: vis_ema_cross_9_21
- Golden Cross SMA50/200 — IMPLEMENTED_DERIVED: vis_golden_cross_50_200
- Flawless Victory Strategy — CATALOGUED_NEXT_ADAPTER
- Ichimoku + Daily Candle + Hull — IMPLEMENTED_DERIVED: vis_ichimoku_hull
- RSI Divergence Strategy — CATALOGUED_NEXT_ADAPTER
- Open Close Cross Strategy R5 — IMPLEMENTED_DERIVED: vis_open_close_cross
- Bjorgum Double Tap — CATALOGUED_NEXT_ADAPTER
- Bollinger + RSI Long Only — CATALOGUED_NEXT_ADAPTER
- Fractal Breakout Strategy — IMPLEMENTED_DERIVED: vis_fractal_breakout
- UT Bot Strategy — EXISTING_ENGINE: ut_bot_quantnomad
- Twin Optimized Trend Tracker / TOTT — EXISTING_ENGINE: tott
- ANN Strategy V2 — CATALOGUED_NEXT_ADAPTER
- MACD + Stochastic Double — IMPLEMENTED_DERIVED: vis_macd_stoch
- EMA Slope + EMA Cross — IMPLEMENTED_DERIVED: vis_ema_slope_cross
- TradingView Alerts → MT4/MT5 strategy — CATALOGUED_NEXT_ADAPTER
- MACD ReLoaded Strategy — CATALOGUED_NEXT_ADAPTER
- Moon Phases Strategy — CATALOGUED_NEXT_ADAPTER
- Super Scalper 5m/15m — IMPLEMENTED_DERIVED: vis_super_scalper

## Momentum / oscillator
- Squeeze Momentum — LazyBear — IMPLEMENTED_DERIVED: vis_squeeze_momentum
- WaveTrend Oscillator — CATALOGUED_NEXT_ADAPTER
- MACD Custom MTF — CATALOGUED_NEXT_ADAPTER
- Williams Vix Fix — IMPLEMENTED_DERIVED: vis_vixfix_reversal
- ADX + DI — IMPLEMENTED_DERIVED: vis_adx_di
- TMA Overlay — IMPLEMENTED_DERIVED: vis_tma_overlay
- Divergence for Many Indicators — CATALOGUED_NEXT_ADAPTER
- CM Sling Shot — CATALOGUED_NEXT_ADAPTER
- Williams Variable A/D Pressure — CATALOGUED_NEXT_ADAPTER
- Coppock Curve Multi-Filter — IMPLEMENTED_DERIVED: vis_coppock
- RSI Signals Entries — IMPLEMENTED_DERIVED: vis_rsi_entries

## SMC / liquidity / sweep
- Smart Money Concepts — LuxAlgo — CATALOGUED_NEXT_ADAPTER
- Market Structure Break & Order Block — CATALOGUED_NEXT_ADAPTER
- ICT Killzones + Pivots — CATALOGUED_NEXT_ADAPTER
- Liquidity Swings — LuxAlgo — COVERED_BY_SWEEP_FAMILY
- Order Block Finder — CATALOGUED_NEXT_ADAPTER
- Order Block Detector — CATALOGUED_NEXT_ADAPTER
- FVG — EXISTING_ENGINE: sr25_fvg_first_touch
- ICT Concepts — LuxAlgo — CATALOGUED_NEXT_ADAPTER
- Buyside & Sellside Liquidity — LuxAlgo — COVERED_BY_SWEEP_FAMILY
- Order Blocks & Breaker Blocks — CATALOGUED_NEXT_ADAPTER
- BOS/CHOCH/MSB/FVG — CATALOGUED_NEXT_ADAPTER
- Sweep Reversal Map+ — COVERED_BY_SWEEP_FAMILY
- AMD Po3 — CATALOGUED_NEXT_ADAPTER
- Smart Money Breakout Channels — AlgoAlpha — CATALOGUED_NEXT_ADAPTER

## S/R / breakout / range
- Support & Resistance Levels with Breaks — IMPLEMENTED_DERIVED: vis_sr_breaks
- Trendlines with Breaks — LuxAlgo — EXISTING_ENGINE: sr25_trendline_breakout
- Support Resistance Channels — CATALOGUED_NEXT_ADAPTER
- Swing High/Low S/R — EXISTING_ENGINE: sr_pivot_bounce / sr_pivot_breakout
- High Volume Boxes — IMPLEMENTED_DERIVED: vis_high_volume_box
- Breakout Probability — CATALOGUED_NEXT_ADAPTER
- Auto Range Detector — IMPLEMENTED_DERIVED: vis_auto_range_breakout
- Pivot Channel TrendLines — CATALOGUED_NEXT_ADAPTER
- Reversal Probability Profile — AlgoAlpha — CATALOGUED_NEXT_ADAPTER

## Trend / MA / adaptive
- SuperTrend indicator — IMPLEMENTED_DERIVED: vis_supertrend_10_3
- CM Ultimate MA MTF V2 — CATALOGUED_NEXT_ADAPTER
- Ultimate MA MTF — CATALOGUED_NEXT_ADAPTER
- Machine Learning Adaptive SuperTrend — CATALOGUED_NEXT_ADAPTER
- SuperTrend AI Clustering — CATALOGUED_NEXT_ADAPTER
- Trend Target Ribbon — CATALOGUED_NEXT_ADAPTER
- Structure-Anchored VWAP — IMPLEMENTED_DERIVED: vis_structure_vwap
- Dynamic Grid Indicator — CATALOGUED_NEXT_ADAPTER

## ML / statistical
- Lorentzian Classification — CATALOGUED_NEXT_ADAPTER
- ANN Strategy V2 — CATALOGUED_NEXT_ADAPTER
- Nadaraya-Watson Envelope — IMPLEMENTED_DERIVED_CAUSAL: vis_nadaraya_watson
- Machine Learning Adaptive SuperTrend — CATALOGUED_NEXT_ADAPTER
- SuperTrend AI — CATALOGUED_NEXT_ADAPTER

## Pattern / candle
- Candlestick Patterns Identified — IMPLEMENTED_DERIVED: vis_candlestick_reversal
- Trinity Reversal Pattern — AlgoAlpha — CATALOGUED_NEXT_ADAPTER
- Wyckoff — CATALOGUED_NEXT_ADAPTER
- TMA Overlay — IMPLEMENTED_DERIVED: vis_tma_overlay

## Profile / band / volatility
- Fibonacci Bollinger Bands — IMPLEMENTED_DERIVED: vis_fibonacci_bb
- Nadaraya-Watson Envelope — IMPLEMENTED_DERIVED_CAUSAL: vis_nadaraya_watson
- Reversal Probability Profile — CATALOGUED_NEXT_ADAPTER
- Volume Delta Pivot Matrix — IMPLEMENTED_DERIVED: vis_volume_delta_pivot
- Dynamic Grid — CATALOGUED_NEXT_ADAPTER
- Vix Fix — IMPLEMENTED_DERIVED: vis_vixfix_reversal

## Session / time
- Sessions — LuxAlgo — CATALOGUED_NEXT_ADAPTER
- ICT Killzones + Pivots — CATALOGUED_NEXT_ADAPTER
- Moon Phases Strategy — CATALOGUED_NEXT_ADAPTER
- AMD Po3 — CATALOGUED_NEXT_ADAPTER

## Exact source needed — retained, not dropped
- LongBuyLongSell 90% Profit — SOURCE_NEEDED
- GainzAlgo Suite — SOURCE_NEEDED
- LuxAlgo Signals & Overlays — SOURCE_NEEDED
- LuxAlgo Price Action Concepts — SOURCE_NEEDED

## Current overnight visual batch
The first runnable visual batch contains 28 new deterministic derived adapters. They are labeled DERIVED_ADAPTER and are not represented as exact publisher implementations. Remaining catalog entries stay queued for adapter/source work; none are removed from the canonical pool.
