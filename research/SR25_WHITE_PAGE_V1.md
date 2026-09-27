# SR25 White-Page Candidate Catalog v1

Status: IMPLEMENTED RESEARCH ADAPTERS. All 25 candidates are executable as `sr25-v1`; none is promoted until it passes our own 9-month continuity and cost/stress tests.

Canonical research question:
> Which Coin × ONE Strategy pair stayed profitable most consistently over the last 9 months, and among those persistent pairs which produced the highest return with acceptable PF/DD/trade count?

## 25 primary support/resistance candidates

1. Fractal Cluster Zone Rejection
   - Confirmed fractal highs/lows clustered inside ATR tolerance.
   - Require repeated touches before zone activation.
   - Entry on confirmed rejection from active zone.
   - Source inspiration: TradingView Fractal Support and Resistance Zones Engine; BigBeluga Fractal S/R.

2. Confirmed Pivot Breakout
   - Confirmed pivot support/resistance.
   - Entry only after closed candle breaks level by ATR buffer.
   - No intrabar/repaint entry.

3. Breakout + Retest
   - Confirmed S/R break, then return to broken level.
   - Entry on rejection/confirmation after retest.
   - Source: TradingView Breakout + Retest Strategy; Support Resistance with Breaks and Retests.

4. S/R Role-Reversal Level Flip
   - Broken resistance becomes support / broken support becomes resistance.
   - Entry only after role-reversal retest confirms.

5. Wick Rejection at Confirmed Zone
   - Long lower/upper wick into a confirmed level/zone.
   - Body/wick and ATR thresholds make it objective.

6. Liquidity Sweep + Reclaim
   - Wick through recent confirmed swing high/low followed by close back inside.
   - Opposite-direction reversal entry.

7. Liquidity Sweep + Delta/Volume Absorption
   - Sweep/reclaim plus elevated volume and absorption/delta proxy.
   - Source: TradingView Liquidity Sweep + Delta Absorption.

8. Previous-Day High/Low Sweep
   - Sweep PDH/PDL and reclaim.
   - 24/7 crypto uses explicit UTC day boundaries.

9. Previous-Week / Previous-Month Extreme Sweep
   - Same concept on PWH/PWL and PMH/PML.
   - Tests whether higher-timeframe liquidity levels produce more persistent edges.

10. Liquidity Sweep + Order Block (LSOB)
    - Sweep, displacement confirmation, then limit/retest entry at the order-block zone.
    - External GitHub LSOB study claims strong BTC 1h historical results; claim is unverified by us.

11. Impulse Order Block Retest
    - Strong ATR/volume displacement defines the originating order-block zone.
    - First valid revisit/rejection triggers entry.

12. Fair Value Gap First-Touch Rejection
    - Objective 3-candle FVG.
    - Enter on first revisit/rejection of unmitigated gap.

13. Inverse Fair Value Gap (IFVG)
    - FVG invalidates/flips and becomes support/resistance in the opposite direction.
    - Entry after confirmed close through the gap and retest/inversion.

14. PDH/PDL Sweep + FVG / Market-Structure Shift
    - Previous-day liquidity sweep followed by FVG or structural confirmation.
    - Source inspiration: public ICT-style backtest repos.

15. Rally-Base-Drop / Drop-Base-Rally Supply-Demand Retest
    - ATR-defined impulse after a compact base creates supply/demand zone.
    - First fresh retest only.
    - Source: TradingView ATR Supply/Demand Zones.

16. Kernel/Volume-Scored Supply-Demand Zone
    - Pivot zones scored by price clustering, volume anomaly and reaction strength.
    - Tests the more exotic statistically-scored S/D claim.
    - Source: TradingView Supply & Demand Zones with Radial Kernel Scoring.

17. Camarilla H3/L3 Mean Reversion
    - Previous-day H/L/C creates Camarilla levels.
    - Fade H3/L3 with objective invalidation near H4/L4.

18. Camarilla H4/L4 Breakout
    - Momentum continuation after confirmed H4/L4 break.
    - Kept separate from H3/L3 because behavior is fundamentally different.

19. Narrow CPR Breakout
    - Previous-period Central Pivot Range.
    - Trade break from unusually narrow CPR; width normalized by ATR/range.
    - Source: open-source CPR implementations.

20. Volume Profile POC Mean Reversion
    - Rolling/session profile.
    - POC acts as fair-value magnet; trade extensions back toward POC.
    - Profile construction must be deterministic and fixed-window.

21. Value-Area Edge / 80% Rule
    - Use VAH/VAL as support/resistance.
    - After accepted re-entry into value, target traversal toward opposite value-area edge.
    - Source: market-profile/volume-profile research implementations.

22. Naked POC Revisit
    - Prior session POC not yet revisited remains active.
    - Test first-touch rejection and/or magnet-to-touch variants separately inside the model.

23. Swing-Anchored VWAP Rejection / Flip
    - Automatically anchor VWAP to confirmed major swing high/low.
    - Test rejection while holding and flip-retest after break.
    - Source: open-source Anchored VWAP implementations and touch-statistics libraries.

24. Multi-Touch Trendline Breakout
    - Confirmed pivots build support/resistance trendline.
    - Require minimum touch count and ATR-normalized slope/tolerance.
    - Enter on confirmed close beyond line.
    - Source: TradingView multi-pivot trendline breakout systems.

25. Donchian Dynamic S/R Breakout
    - Highest-high / lowest-low channel from prior N bars.
    - Break previous channel on close; opposite channel or ATR for exit.
    - Included as dynamic horizontal support/resistance benchmark.

## Important candidates deliberately NOT discarded

These are retained for a second SR wave if the first 25 do not dominate:
- Opening Range Breakout / ORB retest
- Initial Balance breakout + pullback
- Fibonacci retracement reaction (0.382/0.5/0.618/0.786)
- Volume Profile HVN rejection / LVN breakout
- Traditional/Fibonacci/Woodie/DM pivot-family breakout/reversal comparisons
- Breaker Block / mitigation-block variants
- RSI-derived support/resistance zones with order-block filtering

## Research rules

- Closed candles only.
- No look-ahead.
- Confirmed pivots/fractals only.
- RAW results first; no silent filtering.
- Same cost/stress model across candidates.
- Monthly breakdown is mandatory.
- Canonical timeframes: 1m, 5m, 15m, 1h (60m), 4h.
- Promotion unit is Coin × ONE Strategy × ONE Timeframe.
- Continuity first, then return; PF/DD/trades are quality controls.
- Strategy-family quotas are forbidden in the final global ranking.
- External performance claims are treated only as hypotheses.

## Public source families reviewed

TradingView:
- Support and Resistance strategies category
- Breakout + Retest Strategy
- Support Resistance with Breaks and Retests
- Fractal Support and Resistance Zones Engine
- Fractal Support and Resistance [BigBeluga]
- Liquidity Sweep + Delta Absorption
- Smart Money Breakout & Order Block Strategy
- Order Block Support Resistance Candle
- Fair Value Gap Detector / SMC
- Camarilla Pivot Points V2 Backtest
- Pivot Points Standard
- CPR open-source scripts
- Volume Profile POC/VAH/VAL/HVN/LVN scripts
- Naked POC scripts
- Anchored VWAP Pro
- Trendline Breakout systems
- ATR / kernel-scored Supply & Demand Zones
- Donchian Breakout Strategy
- Opening Range / Initial Balance systems

GitHub:
- maxs231/lsob-backtest
- hindsight-finance ICT/FVG models
- frankabingale1111/smc-backtest
- kayasolomon/anchored-vwap
- pedrobraiti/volume-profile-trading
- public ICT order-block backtesting implementations


## Executable SR25 IDs

All 25 are implemented in `research/sr25_strategies.mjs` and wired into `strategy_engine_v2.mjs`.

1. `sr25_fractal_cluster_rejection`
2. `sr25_confirmed_pivot_breakout`
3. `sr25_breakout_retest`
4. `sr25_role_reversal_flip`
5. `sr25_wick_confirmed_zone`
6. `sr25_liquidity_sweep_reclaim`
7. `sr25_liquidity_absorption`
8. `sr25_previous_day_sweep`
9. `sr25_week_month_sweep`
10. `sr25_lsob`
11. `sr25_impulse_ob_retest`
12. `sr25_fvg_first_touch`
13. `sr25_inverse_fvg`
14. `sr25_pdh_fvg_mss`
15. `sr25_supply_demand_retest`
16. `sr25_kernel_supply_demand`
17. `sr25_camarilla_h3_l3`
18. `sr25_camarilla_h4_l4`
19. `sr25_narrow_cpr_breakout`
20. `sr25_poc_mean_reversion`
21. `sr25_value_area_80`
22. `sr25_naked_poc_revisit`
23. `sr25_swing_anchored_vwap`
24. `sr25_trendline_breakout`
25. `sr25_donchian_breakout`

Implementation note: these are deterministic independent research adapters based on the catalog rules. They do not copy external Pine/GitHub source code. Closed-bar execution and no-look-ahead are enforced by tests.
