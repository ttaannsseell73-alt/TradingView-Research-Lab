# Project Lock

## Purpose

TradingView Research Lab is an isolated research lane for the Binance Futures price-action system. It measures ideas before they are allowed anywhere near execution.

## Locked rules

- `binance-bot` is not modified from this repository.
- Price action remains the decision core; classical oscillators are not promoted as primary signals.
- TradingView/Pine code is not copied. Public scripts are research references; implementations here are original.
- Only closed candles are accepted by the canonical feature engine.
- No-lookahead/repaint behavior is enforced with prefix-invariance tests.
- Research includes fees and slippage before expectancy is evaluated.
- Chronological train/validation/holdout windows are mandatory.
- Final acceptance includes 3/6/12/24-bar horizons and both base/stressed transaction-cost scenarios.
- Raw historical data must pass timestamp/OHLCV continuity checks before research evidence is accepted.
- A software PASS is not a profitability claim.
- Promotion requires validation **and** untouched holdout evidence with minimum sample counts.
- A setup must survive every configured robustness run; one insufficient or rejected run blocks robust acceptance.
- This repository has no order-placement code and needs no exchange API secret.


## Runtime monitoring standard — LOCKED 2026-09-28

For every coin/strategy promoted into the runtime monitoring/execution layer, the monitoring contract is mandatory and must be derived from that strategy's real entry conditions:

- current position state: open/flat, direction, entry and execution result;
- fresh closed-candle signal state;
- independent LONG proximity score and label;
- independent SHORT proximity score and label;
- missing condition for LONG and SHORT;
- current candidate direction;
- final trade decision and execution outcome.

Proximity is an execution-awareness metric, not a win probability. It must not change, loosen, or front-run the canonical strategy. Open-candle data may be used only as preview/proximity context; actual entries remain closed-candle/fresh-signal only.

Canonical labels:
- 0–29: UZAK
- 30–59: ORTA
- 60–79: YAKIN
- 80–99: ACILMAYA_COK_YAKIN
- 100: TETIK_KOSULU_PREVIEW (entry conditions visible on the preview candle; closed-candle confirmation still required)

QUSDT / swp_range48_reclaim is the reference implementation. Future monitored coins must expose the same runtime fields, with proximity logic computed from their own canonical strategy conditions rather than a generic heuristic.


## ÇYYM — Çift Yön Yakınlık Modülü — LOCKED 2026-09-28

Canonical shorthand: **ÇYYM**

User command form:
> `XYZ coin'e ÇYYM uygula`

ÇYYM means the complete dual-side runtime proximity package:
- current position state;
- fresh closed-candle signal state;
- independent LONG proximity score + label;
- independent SHORT proximity score + label;
- LONG sweep/reclaim state;
- SHORT sweep/reclaim state;
- missing condition for each side;
- current candidate direction;
- final trade decision;
- execution result.

Scoring rule:
- proximity must move continuously as price approaches the strategy's actual trigger;
- 0 is reserved for genuinely distant conditions;
- 0–29 UZAK;
- 30–59 ORTA;
- 60–79 YAKIN;
- 80–99 ACILMAYA_COK_YAKIN;
- 100 TETIK_KOSULU_PREVIEW.

ÇYYM is not win probability and must never alter the strategy itself. It is an observability layer derived from the canonical strategy's real entry conditions. Open-candle information may be used only for preview/proximity; actual execution remains fresh closed-candle only.

Reference implementation: QUSDT / swp_range48_reclaim.


## QUSDT Range48 micro-confirmation branch — STOPPED 2026-09-29

Decision:
- Original `swp_range48_reclaim` remains canonical for QUSDT.
- The tested micro-structure confirmation variants did not produce a sufficiently clear overall improvement to justify additional tuning/scanning time.
- Do not continue P22/P33/MSS confirmation variant searches for QUSDT unless a future test shows a clearly material improvement in overall performance, not merely a fix for one recent trade.
- Current live/demo Range48 logic remains unchanged.


## Q DURUM — CANONICAL LOOKUP CONTRACT

Purpose: make `Q durum` work the same way across new chats; do not rely on chat-local context.

When the user says `Q durum`:
1. Read GitHub Issue #109 (`Q LIVE STATUS`) in this repository.
2. Read current Binance USD-M Futures QUSDT price.
3. If needed, read the latest QUSDT 15m candles to distinguish open-candle preview from closed-candle execution state.
4. Report, at minimum:
   - scheduler timestamp and age
   - cycle_state
   - actual open position from `positionAmt_before` (side, quantity, entry)
   - leverage and margin type
   - fresh / signal_action / action / result / decision
   - current QUSDT price
   - approximate unrealized PnL versus entry when a position exists
   - ÇYYM LONG score/label/sweep/reclaim/missing condition
   - ÇYYM SHORT score/label/sweep/reclaim/missing condition
5. If Issue #109 is older than about 6 minutes or `cycle_state != SUCCESS`, mark status STALE and inspect the local Q scheduler before treating the status as current.
6. `direction`, `HOLD_LONG`, or `HOLD_SHORT` alone do NOT prove an open position. Use `positionAmt_before` as the canonical position field.
7. ÇYYM scores are proximity to mechanical conditions, not win probabilities.
8. Open-candle preview is observability only; execution remains closed-candle/fresh-signal based.
9. Do not change Q strategy logic merely to answer `Q durum`.
10. Canonical Q strategy remains `swp_range48_reclaim`, 15m, x1, ISOLATED unless an explicit later lock changes it.
