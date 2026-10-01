# Full Reset Research — Final V2

## Locked rules
- Active Binance USD-M USDT perpetuals only; delisted/inactive excluded.
- Canonical/original strategy implementations only.
- No parameter sweep, tuning, recovery variant, direction variant, or synthetic variant.
- Mandatory promotion gate: last 3 months 3/3 PASS and last 6 months 6/6 PASS.
- September 2026 completed through 2026-09-30 closed data before final scoring.
- Current market-health gate is separate from historical strategy performance.

## Stage 1 — Canonical universe scan
- Active universe: 527 symbols
- Full 6-month history: 503
- Current tradeable stage-1 universe: 248
- Canonical strategies: 101
- Total tested combinations: 122,016
- 3/3 survivors: 1,196
- 6/6 survivors: 84
- Variants: none

Family 6/6 survivors:
- ALGO9/Kivanc: 3
- SR35: 30
- Sweep20: 34
- Visual28: 14
- Fibonacci/Elliott/Harmonic: 3

## Stage 2 — Current coin health
The 84 historical 6/6 setups represented 44 symbols.
After 24h volume, spread, open-interest notional and 10 bps two-sided book-depth checks:
- Promotable-current setups: 63
- Promotable-current symbols: 32
- Rejected-health symbols: 12

Notable removals:
- QUSDT: rejected — thin 10 bps ask-side book
- SKYAIUSDT: rejected — thin 10 bps two-sided book
- GUAUSDT / HANAUSDT / TRADOORUSDT: did not reach the 6/6 survivor set

## Stage 3 — Exact 9M / 12M diagnostics
Only the 63 health-passing 6/6 setups were re-evaluated. No cross-product and no new variants.
- Exact setups tested: 63
- Failures: 0
- 9/9 PASS: 3
- 12/12 PASS: 0
- >=11/12 PASS: 1

9/9:
- GPSUSDT 15m — sr_liquidity_sweep — 9/9, 9/12
- GPSUSDT 15m — sr25_liquidity_sweep_reclaim — 9/9, 9/12
- GPSUSDT 15m — swp_range24_reclaim — 9/9, 9/12
These three are closely related canonical liquidity-reclaim rules and must remain separate in provenance.

Best 12-month consistency:
- MOODENGUSDT 15m — swp_wick_sfp — 11/12, last 9 months 8/9, 12M stress net +601.00%, PF 1.410, DD 43.68%, 534 trades.
- GPSUSDT 1h — swp_wick_sfp — 10/12, last 9 months 8/9, 12M stress net +4817.28%, PF 2.985, DD 34.33%, 140 trades.
- GPSUSDT 1h — sr_liquidity_sweep / sr25_liquidity_sweep_reclaim / swp_range24_reclaim — each 10/12, last 9 months 8/9.

## Separate new-research queue
Not mixed into the canonical 101-strategy run:
- funding mean-reversion / carry
- OI-price divergence
- taker-flow momentum
- cointegration / statistical arbitrage

These require separate data/provenance and will remain standalone canonical research candidates, with no variants in their first implementation.

## Canonical files
- MASTER_STATUS.json — completed 6M master scan
- RECENT_3M_PASS.csv — 3/3 results
- RECENT_6M_PASS.csv — 6/6 results
- SURVIVORS_6M.json — exact 84 setup survivor set
- coin_health.json — current health evidence
- promotable_current.json — exact 63 health-passing setups
- PROMOTABLE_12M.json / .csv — exact 9M/12M diagnostics
- PROMOTABLE_12M_SUMMARY.json — compact 9M/12M summary
- CHECKPOINT_INDEX.json — family checkpoint index
- ALL_RESULTS.ndjson — raw combined result stream
- new_strategy_candidates.json — isolated second research queue

## Decision rule retained
3/3 and 6/6 remain mandatory. No automatic extra hard rule was added for 9/12 months; those results are diagnostic for the next selection decision.
