# PROJECT STATE

Canonical branch: `main`

## Software state

- Canonical 18-feature price-action contract implemented.
- Closed-candle, monotonic timestamp and OHLCV validation implemented.
- Deterministic replay and no-lookahead prefix invariance implemented.
- Kıvanç/TradingView candidate map implemented without copying Pine source.
- Breakout, liquidity sweep/reclaim and compression-release setup families implemented.
- Fee/slippage-aware event study implemented.
- Chronological 60/20/20 train/validation/holdout isolation implemented.
- Train-only threshold tuning implemented. Validation and holdout are never used to select thresholds.
- Multi-horizon 3/6/12/24 robustness matrix implemented.
- Base and stressed transaction-cost scenarios implemented.
- Final data-quality and acceptance gate implemented.
- Main `BinanceGridBot` remains untouched.

## Promotion rule

Promotion is per setup, not all-or-nothing. A setup is a candidate only if every configured validation/holdout horizon and cost scenario is `PASS` with the minimum sample count. `REJECT` and `INSUFFICIENT_DATA` remain blocked.

## Final acceptance — CLOSED

Final evidence commit: `1f6ccefa7a697ac986e9b1a9b6686b45b7fe629c`

Dataset:
- BTCUSDT 1m: 50,000 candles, quality PASS, zero detected gaps, SHA-256 recorded in `FINAL_ACCEPTANCE.json`.
- BTCUSDT 5m: 50,000 candles, quality PASS, zero detected gaps, SHA-256 recorded in `FINAL_ACCEPTANCE.json`.
- Source implementation commit recorded by the evidence: `6e695b52537406036ae521aa7337e9b92c83b6d3`.
- Evidence CI: PASS.

Final status: `NO_PROMOTABLE_SETUP`.

Per-setup result on both 1m and 5m across the configured 3/6/12/24 horizons and base/stress cost scenarios:
- `breakout`: REJECT.
- `liquidity_sweep_reclaim`: REJECT.
- `compression_release`: INSUFFICIENT_DATA.

Therefore no TradingView/Kıvanç setup from this research lane is approved for promotion into `BinanceGridBot`. The rejection is the final research result for this version; gates are not to be loosened to manufacture a PASS.

Raw CSV market data remains local and ignored. Only compact acceptance evidence is committed.

## Project disposition

This research lane is complete and frozen at the final acceptance result above. Reopen only for a materially new hypothesis, setup family, dataset scope, or explicit user decision.


## Explicit reopen — Strategy Selector program (2026-09-24)

The earlier BTC-only setup-family conclusion remains valid for that historical experiment, but the research lane has been explicitly reopened for a materially different hypothesis and dataset scope.

New canonical question:

> Which TradingView strategies work best on which Binance Futures coins and timeframes?

Kıvanç's five strategies are the first implemented pack. The program is now author-agnostic and extensible. New strategies are admitted through a deterministic closed-candle adapter and evaluated as `strategy × coin × timeframe`.

Primary product output is a profitability-first **Top-5 per strategy/timeframe** plus a cross-strategy Opportunity Board. Risk metrics are surfaced for decision-making; they are not used to redefine the objective as a zero-risk search.

Main `binance-bot` remains untouched until explicit promotion.


## Canonical multi-timeframe checkpoint — 2026-09-25

Completed evidence run: `35999372964` — SUCCESS.

Scope:
- 559 comparable Binance USDⓈ-M Futures symbols.
- 9 implemented strategy adapters.
- 5m / 1h / 4h / 1d.
- 20,124 strategy × coin × timeframe combinations.
- Cost-aware: 14 bps canonical round-trip, 15 bps stress.
- Closed candle -> next-bar-open execution.
- REVERSAL and TARGET_POSITION execution modes.
- Indicator warm-up separated from the 90-day trade window.

Evidence PASS totals:
- 5m: 185 / 5,031 combinations.
- 1h: 961 / 5,031 combinations.
- 4h: 1,006 / 5,031 combinations.
- 1d: 519 / 5,031 combinations.

Broadest strategy by PASS rate per timeframe:
- 5m: TOTT (~21.65%).
- 1h: MavilimW (~35.78%).
- 4h: SSL Hybrid + QQE (~40.43%).
- 1d: UT Bot QuantNomad (~29.87%).

Interpretation:
- 4h currently has the broadest evidence surface.
- 1h remains a strong secondary operating timeframe.
- 5m is strongly cost-sensitive and useful only on selected strategy/coin matches.
- 1d is sparse and should be treated as confirmation / lower-frequency evidence, not directly compared with intraday trade counts.

Cross-timeframe management layer:
- Profitability-first Top-5 remains canonical.
- A separate management/deployment layer now rewards evidence repeated across multiple timeframes and independent strategy families.
- High-return/high-drawdown cases remain visible as REVIEW instead of being hidden.
- Current recurring evidence candidates include 1000BONK, UNI, ZEC, ALCH, RVN, AAVE, ARB, BICO and MINA families; this is a research shortlist, not an automatic live order list.

Next promotion gate:
1. Cross-timeframe board.
2. Tradability/liquidity check.
3. Current-signal check.
4. Paper/shadow management.
5. Only then small-capital real execution.

Main `binance-bot` remains untouched until explicit promotion.


## Current-signal and shadow checkpoint — 2026-09-25

Implemented on the canonical Strategy Selector branch:

- `evaluateCurrentSignals` reuses the same 9 strategy adapters as the research engine; no second decision engine exists.
- Only confirmed closed candles can create strategy-state changes.
- REVERSAL adapters expose current LONG/SHORT state and signal age.
- TARGET_POSITION adapters expose LONG/SHORT/FLAT and explicit exit-to-flat transitions.
- Live Binance USDⓈ-M candle snapshots retain the still-open next bar only for canonical next-bar-open paper fill pricing; the open bar is never fed into signal generation.
- Current-signal output separates FRESH_ENTRY, RECENT_SIGNAL, ACTIVE_TREND, EVIDENCE_REVIEW, DIRECTION_CONFLICT and OBSERVE_ONLY.
- Paper eligibility requires STRONG/TRADEABLE execution, no evidence-review flags and no conflicting fresh direction.
- Multiple fresh same-direction strategies on one underlying aggregate into one paper position intent; they do not create duplicate positions.
- USDT/USDC remain underlying-deduplicated and the chosen execution contract carries live bid/ask/mid/last fields.
- Persistent `SHADOW_STATE.json` is carried between workflow runs via GitHub Actions artifacts.
- Shadow journal tracks open positions, reversals, target-position exits, tradability-block exits, realized return and mark-to-market unrealized return.
- Shadow entry uses the actual next-bar open captured from Binance Futures.
- Shadow results subtract the same 14 bps modeled round-trip cost used by the research baseline.
- PnL is reported against a normalized 1,000 USDT reference notional per independent paper trade; this is a measurement unit, not a live allocation rule.
- No real orders are sent.

Validation:
- Current-signal closed-candle determinism tests added.
- Shadow journal tests cover open, same-direction hold, opposite-direction reverse and hard tradability-block exit.
- Normal CI PASS at commit `86606563d77279801256a759dc21ca36d5ef3aa1`.

Manual live sanity snapshot after implementation:
- BCHUSDT 4h SHORT paper intent: entry 331.98; current spot-check price 337.48; modeled net if closed approximately -1.77%.
- AAVEUSDT 1h LONG: entry 145.87; price 148.22; modeled net if closed approximately +1.47%.
- DOTUSDT 4h LONG: entry 1.1579; price 1.1815; modeled net if closed approximately +1.90%.
- RVNUSDT 4h LONG: entry 0.002398; price 0.002440; modeled net if closed approximately +1.61%.
- KITEUSDT 1h LONG: entry 0.13031; price 0.13174; modeled net if closed approximately +0.96%.

The manual figures above are a time-stamped sanity check only. Canonical shadow evidence comes from persisted workflow artifacts across repeated runs.


## Canonical main shadow monitor — 2026-09-25

PR #12 was merged to `main`.
- Merge commit: `48cc3e2801c753a8a340fbedd233105845d72a0c`.
- Shadow monitor main push validation run: `36131145129` — SUCCESS.
- Main CI run: `36131145148` — SUCCESS.
- Persistent artifacts:
  - `strategy-selector-shadow-monitor`
  - `strategy-selector-shadow-state`
- The lightweight shadow workflow is scheduled every 15 minutes on the default branch.
- No real orders are sent and `binance-bot` remains untouched.

First canonical main shadow snapshot:
- 63 execution contracts requested; 63 market snapshots succeeded.
- 118 candle series requested; 118 succeeded.
- 250 strategy/coin/timeframe live states evaluated.
- 28 fresh signals.
- 17 individually eligible fresh signals.
- 15 underlying-level paper position intents.
- 10 direction-conflict rows excluded from paper entry.
- 0 missing candle series.
- 15 open normalized paper positions.
- 0 closed trades.
- Normalized open reference exposure: 15,000 USDT (15 independent × 1,000 reference units).
- Unrealized normalized PnL: +157.45 USDT.
- Unrealized return on open reference exposure: approximately +1.05% at that snapshot.

Open paper positions in the first canonical main snapshot:
- LONG: FET, AAVE, WLD, 1000PEPE, DOT, KITE, ZETA, ATOM, AERO, FF, KMNO.
- SHORT: BCH, RIVER, S, XTZ.
- BCH SHORT had support from two same-direction 4h strategies and still produced exactly one position intent.

The first snapshot is not a profitability conclusion. Promotion decisions require accumulated shadow evidence with realized closes/reversals, not only unrealized PnL.

Data-outage behavior:
- Temporary Binance API failure cannot erase or force-close existing shadow positions.
- If market/candle data is unavailable, the last successful `SHADOW_STATE.json` is carried forward and the successful snapshot timestamp is not advanced.
- Synthetic/unit coverage validates outage carry-forward and scheduler catch-up behavior.

Next canonical objective:
1. Accumulate 15-minute shadow observations.
2. Record realized closes, reversals, win rate and PnL after modeled costs.
3. Compare live shadow behavior against the 90-day evidence profile.
4. Do not promote to real capital solely from early unrealized performance.
