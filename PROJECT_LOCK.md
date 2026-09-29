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


## Q RUNTIME — RETIRED 2026-09-29

Decision:
- QUSDT Range48 research evidence remains historical/canonical research evidence, but the Q live/demo runtime lane is retired.
- Local task `QDemoForwardMonitor` must be removed and no further automatic Q cycles are allowed.
- Existing Binance TESTNET position state is not to be altered merely by retirement of the monitor; no close/cancel action is implied by this lock.
- Issue #109 is archival Q status only after the local stop is applied.
- Issue #127 Q status lookup contract is retired.
- Do not spend runner/queue capacity on Q bootstrap, Q scheduler repair, Q publisher, or Q live monitoring unless the user explicitly reopens Q later.


## DEMO-10 LIVE MONITOR — CANONICAL 2026-09-29

Purpose: replace Q as the active forward-observation lane.

Canonical cohort:
- `demo-10-forward-v2`
- GUA / RIVER / GPS / TRADOOR / TLM / Q / HANA / XPIN / FF / ALLO
- Configuration source: `research/demo_cohort_10.json`
- Canonical status source: GitHub Issue #150 (`DEMO10 LIVE STATUS`)

Runtime contract:
- Local Windows task: `Demo10LiveMonitor`
- Cadence: 1 minute.
- Data: Binance USD-M Futures public market data.
- Signals: confirmed closed candles only; next-bar open remains the canonical paper execution assumption.
- Mode: `PAPER_SHADOW_ONLY`.
- Real exchange orders: DISABLED.
- Persistent local shadow state: `C:\demo10-live\state\SHADOW_STATE.json`.
- Status publication: Issue #150 after every successful/failed local cycle.
- GitHub `Demo Cohort 10 Shadow` workflow is manual fallback/evidence only; it is not the continuous scheduler.
- 1m and 15m timeframes are mandatory because the selected cohort includes TLM 1m and multiple 15m setups.
- Generic evidence flags remain visible, but for this explicitly selected paper cohort they are advisory and must not silently exclude a selected setup from shadow observation.
- Cohort ID is part of shadow state; a cohort change must reset stale positions/history rather than carrying positions from an older candidate list.

When the user asks for Demo-10 status:
1. Read Issue #150.
2. Report scheduler timestamp/age and cycle state.
3. Report all 10 setup states, including direction, signal state, execution/tradability state, freshness and age.
4. Report open paper positions and normalized realized/unrealized PnL.
5. If Issue #150 is stale or failed, inspect the local `Demo10LiveMonitor` runtime before treating the report as current.


## TEST MASTER INDEX — CANONICAL TEST INVENTORY

- Canonical file: `TEST_MASTER_INDEX.md`
- Purpose: single source of truth for historical and current research/backtest families, their completion state, report state, retries, invalid runs and recovery priority.
- Rule: do not infer a valid test result from GitHub workflow SUCCESS alone; use the status in `TEST_MASTER_INDEX.md` and underlying artifacts/evidence.
- Current STR100 canonical line: Exact v2 / Issue #139; v1 is invalid historical evidence only.
- Current priority: stabilize TANSEL-DATAHUB, recover reports from compute-complete families, then resume STR100 Exact v2 from checkpoint.
