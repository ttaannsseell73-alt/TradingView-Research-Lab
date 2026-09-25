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
