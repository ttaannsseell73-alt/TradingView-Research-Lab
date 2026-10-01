# Scalping Engine V1

## Goal
A separate leveraged scalp engine built from validated short-horizon evidence. It does not mutate the source strategy rules.

## Locked execution model
- One setup = one direction.
- One symbol = one open intent/position.
- No pyramiding.
- No in-place reversal.
- Opposite signal = exit only.
- New position requires a new fresh signal cycle.
- Same-behavior strategy aliases are deduplicated into one signal cluster.
- Source strategies remain canonical; exit/risk logic belongs to the engine layer.

## Leverage and risk
Leverage and account risk are separate.
- x3: primary research tier.
- x5: experimental tier only.
- x10: disabled until positive OOS evidence exists.
- Default account risk per trade: 0.5%.
- Position margin is sized from the stop-margin budget, not from full account equity.
- Full-equity leveraged compounding is forbidden.

## Exit policies under research
Quick impulse exit uses:
- fixed margin TP/SL translated to underlying price by leverage,
- opposite-signal exit,
- hard maximum holding time,
- conservative stop-first assumption when TP and SL occur in the same bar.

Current policy codes:
- M5_S3 = +5% / -3% position-margin move.
- M7_5_S5 = +7.5% / -5%.
- M10_S5 = +10% / -5%.

## Promotion rule
No setup is live-approved unless it passes:
1. current coin-health gate,
2. OOS last 3 months = 3/3 positive,
3. OOS last 6 months = 6/6 positive,
4. no duplicate-behavior inflation,
5. acceptable drawdown at the selected account-risk budget.

## Current evidence
- 33 source setups examined: 29 long-only, 4 short-only.
- Most original strategies are not naturally quick scalps; their profitable impulse often develops over hours.
- Global quick-exit policies did not produce a 6/6 setup.
- OOS per-setup exit selection improved results but still produced no 6/6 candidate.
- Strongest near-pass: MONUSDT 15m liquidity-reclaim cluster, LONG, x3, 0.5% account risk, M10_S5, max hold 4h: 3/3 recent, 5/6 recent six months, +15.85% OOS net, 5.82% max DD, PF 1.372.
- x5 has one meaningful experimental candidate (MONUSDT 15m ATR expansion) but only 3/6.
- x10 has no positive OOS candidate.

## Exact-source scalp research
- Super Scalper 5m/15m: failed 3/3 gate.
- MACD ReLoaded: 24 setups passed 3/3, none passed 6/6.
- Swing Failure Pattern 5m: runtime-heavy, pending.
- Institutional Liquidity Sweep: runtime-heavy, pending.

## Next research gate
Do not loosen 6/6. Add only genuinely short-horizon candidates and rerun the same OOS engine test. Priority families:
- liquidity sweep / reclaim,
- swing-failure pattern,
- POC / value-area mean reversion,
- Camarilla,
- FVG + market-structure shift,
- opening/range breakout,
- exact-source short-horizon strategies that survive 3/3 then 6/6.
