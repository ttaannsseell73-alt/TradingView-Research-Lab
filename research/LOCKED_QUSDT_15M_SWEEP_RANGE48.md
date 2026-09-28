# LOCKED CANDIDATE — QUSDT 15m / Sweep Range-48 Reclaim

Status: **LOCKED / RETAIN**
Provenance: **RESEARCH_GENERATED_VARIANT** (not an external exact-source strategy)
Strategy ID: `swp_range48_reclaim`
Implementation: `research/sweep_strategies.mjs`
Run: Night Queue Sweep Visual — `36358058182`
Artifact: `sweep20-2026-full-result` / artifact ID `10947220360`

## Verified artifact result
- Symbol: QUSDT
- Timeframe: 15m
- Grade: A_9_OF_9
- Eligible months: 9
- PASS months: 9
- Positive months: 9
- Stress-positive months: 9
- Trades: 308
- Win rate: 72.7273%
- PF: 2.93848
- Compounded net: +44,123.6702%
- Stress-cost compounded net: +42,803.2567%
- Max DD: 52.1083%
- Coverage: 100%
- Rows: 25,152
- History: 262 days

## Monthly net
- 2026-01: +426.2982%
- 2026-02: +85.3088%
- 2026-03: +406.1861%
- 2026-04: +60.1481%
- 2026-05: +20.3924%
- 2026-06: +59.1704%
- 2026-07: +66.0130%
- 2026-08: +11.7482%
- 2026-09 (through Sep 20): +65.4660%

## Rule
15m, previous 48 completed bars. Long when current low sweeps below the previous-48 low by > 0.05 × ATR(14) and closes back above that low. Short is symmetric above the previous-48 high. Research engine executes signal on bar i and enters on next bar open.

## Canonical handling
This candidate is **not to be deleted or excluded** because it is research-generated. It must remain in a separate provenance class from SOURCE_EXACT/SOURCE_PORT strategies. Any future report must preserve the distinction rather than mixing provenance labels.
