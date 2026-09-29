# TEST MASTER INDEX

Canonical test inventory for TradingView-Research-Lab.

Last reconciled: 2026-09-29

## Rules

1. A GitHub workflow conclusion of `success` is **not** enough to mark a research test valid.
2. A test is `VALID_COMPLETE` only when the intended task set finished and usable result rows / summary evidence exist.
3. Retries, watchdog reruns and transport reruns belong to the same test family; they are not counted as separate research tests.
4. `INVALID_COMPLETE` means the workflow ended but the research output is unusable (for example all tasks skipped or all shards failed).
5. `PARTIAL` means some real computation finished but the intended full scope did not.
6. `REPORT_RECOVERY` means the compute scope appears complete from progress evidence, but the final compact ranking/report still needs to be recovered from artifacts.
7. Never promote a result solely from issue title, workflow status, or progress percentage.

## Canonical inventory

| Family | Canonical scope | Canonical issues | Status | Report state | Notes / next action |
|---|---|---:|---|---|---|
| SR25 | 25-strategy research family, 725 USD-M futures x 5 TF, 2026 | #69 #70 #71 | REPORT_RECOVERY | Progress evidence: 3625/3625 tasks complete on #71 | Recover final aggregate/ranking from artifacts before reuse. Do not rerun unless artifact is missing/corrupt. |
| SR35 | 35-strategy expansion, 725 futures x 5 TF, 2026 | #72 #73 | REPORT_RECOVERY | Progress evidence: 3625/3625 tasks complete on #73 | Recover canonical result set and repeat-audit details. |
| SR35 12M Heavy | 35 strategies, 725 futures x 5 TF, full-year robustness | #76 | PARTIAL | Only 70/3625 progress recorded before stop | Do not treat as completed. Resume only if still needed. |
| ALGO9 | 9 selected strategies, 725 futures x 5 TF, monthly 9/9 and 8/9 | #78 | REPORT_RECOVERY | Progress evidence: 3625/3625 tasks complete | Recover final 9/9 / 8/9 rankings from artifacts. |
| GUA 1Y | 15m Multi-Touch Trendline Breakout over archived futures universe | #74 #75 | REPORT_RECOVERY | 725/725 tasks complete | Recover coin ranking / monthly report; no rerun first. |
| Range48 1Y Universe | `swp_range48_reclaim`, 15m, full futures universe | #79 #81 #82 #83 | PARTIAL / MIXED | #82 cloud 725 run ended INVALID (8/8 shards failed); #83 remainder 302/302 completed cleanly | Do not call the 725 cloud run valid. Reconstruct valid coverage from successful artifacts before rerun. |
| Q 15m Showdown | QUSDT Prior-Day Sweep vs Range48 | #84 #85 | VALID_COMPLETE | Compact report exists in #85 | Historical research only. Prior-Day and Range48 monthly metrics recorded. |
| Near-Pass 2Y Baseline | 33 seed setups, lifetime-aware 2Y baseline | #110 #111 | VALID_COMPLETE | Summary exists | 33 seed; 15 full-history, 15 shorter-history, 3 data-gap; 5 one-month-short; 3 >=80% consistency. |
| Near-Pass Variant Recovery | Q/HANA/FF/ALLO x 1m/5m/15m x 28 variants | #112 | VALID_COMPLETE | Summary + raw artifact evidence | 12 tasks, 336 combinations, 131 PASS, 0 hard failures; LONG/SHORT separated. |
| Q-Class Discovery | Automated variant/recovery engine + checkpoint/resume | #104 #105 #107 #108 | VALID_COMPLETE (ENGINE SMOKE) | Engine verification summary exists | 240 variants; 5 full-pass; checkpoint-resume verified. This is engine validation, not full-universe promotion evidence. |
| Regime Y1/Y2 | Long-history regime comparison 2024-25 vs 2025-26 | #113 #114 | INVALID_COMPLETE at shard layer | Progress reached 100%, but each run reported failed shard state | Do not use raw Y1/Y2 outputs as canonical until repaired/reconstructed. |
| Full-Universe Regime Sweep | Local USD-M universe, 5 TF, 7-strategy core, Y1 vs Y2 | #115 | VALID_COMPLETE / REPORT_DETAIL_RECOVERY | Completion summary exists; LONG/SHORT in artifacts | Recover detailed ranking when needed. |
| Sweep Family Yearly | 20 sweep/reclaim strategies, full local futures universe, 5 TF, latest + previous year | #119 | VALID_COMPLETE / REPORT_DETAIL_RECOVERY | Completion summary exists; raw LONG/SHORT results retained | Recover ranked candidates from artifacts; do not confuse with STR100. |
| TLM 2Y Speed Benchmark | Batch-cache parity / warm-run speed test | #96 #98 | CANCELLED | No canonical completed benchmark report | Infrastructure benchmark only. |
| Q Range48 Micro 1Y | Immediate Q 15m Range48 micro-confirm variants | #121 | UNCONFIRMED / NO REPORT | No completion comment recorded | Verify workflow/artifact before any claim; do not assume complete. |
| STR100 Exact v1 | Canonical 39 exact-source yearly sweep, latest + previous year | #117 #118 #120 #126 | INVALID_COMPLETE | Workflow said completed, but effective result set was unusable: all yearly tasks skipped / no real ranking | Historical failed attempt only. Never use as strategy ranking. |
| STR100 Exact v2 | Pine v5+ exact-provider-v2, Binance metadata, Indicator cache, 20 runnable exact strategies | #128 #136 #139 | PARTIAL | prepare + turbo_cache complete; 3Commas latest 12m complete; previous 12m interrupted; final artifacts absent | Resume from checkpoint after TANSEL-DATAHUB runner is stable. This is the current canonical STR100 engine. |

## Older research lines kept separate

These are not aliases of STR100 and must not be merged into it:

- Freqtrade / MACD universe scans (1m / 15m / 4h), including the historical `NO_PROMOTABLE_SYMBOL` runs.
- 30-coin production-oriented futures pool (10 CORE + 20 ACTIVE), which is a portfolio/runtime selection layer rather than a strategy-discovery test family.
- Passivbot / grid research, which is a separate execution/grid line.
- Q live/demo forward, which is execution validation, not a discovery/backtest family.

## Current recovery priority

1. Stabilize `TANSEL-DATAHUB` runner.
2. Recover reports/artifacts for compute-complete older families before rerunning: **SR25, SR35, ALGO9, GUA 1Y, Sweep Family, Full-Universe Regime**.
3. Resume **STR100 Exact v2** from checkpoint.
4. Only rerun tests whose artifacts are missing, invalid, or provably incomplete.
5. Keep Q live/demo work secondary unless it blocks the research engine.

## Canonical interpretation shortcuts

- “SR25” => issues #69/#70/#71 as one family.
- “SR35” => issues #72/#73 as one family; #76 is the separate unfinished 12M heavy repeat.
- “Range48 yearly” => #79/#81/#82/#83 combined history; #82 alone is invalid.
- “Recovery” => Near-Pass baseline/variant + Q-Class engine; not STR100.
- “Sweep” => Sweep Family #119 unless the user explicitly means Q Range48.
- “STR100” => current canonical engine is **Exact v2 / #139**, not the invalid v1 result.
