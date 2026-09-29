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


## Q — REAL CANDIDATE LOCK 2026-09-29

Decision:
- QUSDT's dedicated demo/testnet forward-monitoring phase is complete.
- The old Q demo scheduler/runtime remains STOPPED; do not restart the Q demo lane.
- Q is now classified as an accepted REAL_CANDIDATE based on the user's decision plus the already-locked research/forward evidence.
- This promotion does NOT itself authorize a real-money order.
- Real execution requires an explicit later user command to enable live trading and must use the canonical Q strategy/risk configuration locked for production.
- Existing historical/testnet evidence remains preserved for audit.
- Demo-10 is independent of this Q decision and MUST continue running as the active 10-setup paper/shadow observation lane.


## DEMO-10 TESTNET — CANONICAL 2026-09-29

Purpose: active forward execution validation for the selected 10 setups on Binance USD-M Futures TESTNET.

Canonical cohort:
- `demo-10-forward-v2`
- GUA / RIVER / GPS / TRADOOR / TLM / Q / HANA / XPIN / FF / ALLO
- Configuration source: `research/demo_cohort_10.json`
- Canonical live status: GitHub Issue #150 (`DEMO10 LIVE STATUS`)

Runtime contract:
- Local Windows loop: `Demo10LiveMonitor`.
- Cadence: 1 minute.
- Signal data: Binance USD-M Futures public market data.
- Execution venue: Binance USD-M Futures TESTNET only.
- Mode: `BINANCE_USDM_TESTNET`.
- Production/live-money orders: DISABLED.
- Signal timing: confirmed closed candles only.
- Fresh eligible signal can create a TESTNET intent/order; no seeding of old shadow positions.
- Selected-cohort REVIEW/evidence flags are advisory; BLOCK, no-market and non-trading states remain hard execution blocks.
- x1 leverage, isolated margin.
- Reference testnet allocation: 100 USDT per new position.
- Maximum 10 Demo-10 positions / 1,000 USDT gross testnet notional.
- Catastrophic TESTNET protection: 20% from entry.
- Durable testnet journal: dedicated PostgreSQL `canonical-demo10-testnet-pg`; it is separate from the retired Q demo journal.
- Intent/outbox persistence, deterministic client-order IDs, exchange reconciliation, reduce-only exits, and protection verification are mandatory.
- Foreign/legacy exchange positions must never be silently adopted. A position/journal mismatch is `RECONCILIATION_HALTED` for that symbol.
- Persistent shadow state remains active as a reference/control track at `C:\demo10-live\state\SHADOW_STATE.json`.
- Status publication: Issue #150 after every successful/failed local cycle.
- GitHub workflow `Install Demo-10 Local Testnet Monitor` is deployment/verification; the continuous runtime is local.

Deployment evidence:
- Installer PowerShell parser: PASS.
- Local `binance-bot` TypeScript build: PASS.
- Canonical execution safety tests: 11/11 PASS.
- TESTNET journal bootstrap: PASS.
- Deployment run `36617764540`: SUCCESS.
- First confirmed TESTNET cycle opened TRADOOR SHORT and verified protection.
- Following cycle did not duplicate the entry; when TRADOOR became BLOCK it was safety-flattened.
- Initial TESTNET universe availability was 7/10; unavailable contracts remain visible and do not route orders.
- Legacy QUSDT testnet position was detected and isolated with `RECONCILIATION_HALTED`; Demo-10 did not adopt or alter it.

When the user asks for Demo-10 status:
1. Read Issue #150.
2. Report scheduler timestamp/age, cycle state, TESTNET result and data availability.
3. Report all 10 setup states and each symbol's TESTNET execution result.
4. Report TESTNET positions separately from shadow reference positions.
5. Explicitly identify unavailable TESTNET contracts and reconciliation halts.
6. If Issue #150 is stale/failed, inspect the local `Demo10LiveMonitor` runtime before treating the report as current.


## TEST MASTER INDEX — CANONICAL TEST INVENTORY

- Canonical file: `TEST_MASTER_INDEX.md`
- Purpose: single source of truth for historical and current research/backtest families, their completion state, report state, retries, invalid runs and recovery priority.
- Rule: do not infer a valid test result from GitHub workflow SUCCESS alone; use the status in `TEST_MASTER_INDEX.md` and underlying artifacts/evidence.
- Current STR100 canonical line: Exact v2 / Issue #139; v1 is invalid historical evidence only.
- Current priority: stabilize TANSEL-DATAHUB, recover reports from compute-complete families, then resume STR100 Exact v2 from checkpoint.
