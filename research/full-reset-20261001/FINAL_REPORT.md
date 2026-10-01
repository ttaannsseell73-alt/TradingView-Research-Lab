# Full Reset Research — 6M Gate

- Active Binance USD-M universe: **527**
- Full 6-month history: **503**
- Stage-1 tradeable test universe: **248**
- Insufficient 6-month history: **24**
- Canonical strategies: **101**
- Variants: **none**
- Mandatory gate: **3/3 AND 6/6 PASS**
- Total tested combinations: **122016**
- 3/3 survivors: **1196**
- 6/6 survivors: **84**

## Families

| Family | Tested | 3/3 | 6/6 | Failures |
|---|---:|---:|---:|---:|
| algo9 | 11070 | 56 | 3 | 10 |
| sr35 | 43050 | 480 | 30 | 10 |
| sweep20 | 24600 | 428 | 34 | 10 |
| visual28 | 34440 | 198 | 14 | 10 |
| fib9 | 8856 | 34 | 3 | 8 |

## Top 6/6 research survivors

| # | Family | Coin | TF | Strategy | 6M stress net | PF | DD | Trades |
|---:|---|---|---|---|---:|---:|---:|---:|
| 1 | algo9 | SKYAIUSDT | 4h | ott | 116216.05% | 4.055 | 58.04% | 88 |
| 2 | sr35 | QUSDT | 5m | sr_range_edge | 29263.31% | 2.219 | 35.77% | 651 |
| 3 | sweep20 | QUSDT | 15m | swp_range48_reclaim | 11852.15% | 3.136 | 52.11% | 223 |
| 4 | visual28 | SKYAIUSDT | 15m | vis_sr_breaks | 8383.30% | 2.521 | 67.17% | 147 |
| 5 | sr35 | QUSDT | 5m | sr25_liquidity_absorption | 5821.50% | 1.836 | 31.24% | 679 |
| 6 | sweep20 | GPSUSDT | 1h | swp_volume_absorption | 3792.25% | 7.872 | 16.02% | 86 |
| 7 | visual28 | SKYAIUSDT | 1h | vis_supertrend_10_3 | 3172.68% | 3.098 | 49.82% | 94 |
| 8 | visual28 | FOLKSUSDT | 5m | vis_bollinger_rsi_double | 2148.44% | 1.939 | 36.08% | 351 |
| 9 | sr35 | GRASSUSDT | 5m | sr25_poc_mean_reversion | 1950.40% | 1.976 | 40.08% | 443 |
| 10 | sr35 | GPSUSDT | 1h | sr_liquidity_sweep | 1860.90% | 4.018 | 16.28% | 106 |
| 11 | sr35 | GPSUSDT | 1h | sr25_liquidity_sweep_reclaim | 1860.90% | 4.018 | 16.28% | 106 |
| 12 | sweep20 | GPSUSDT | 1h | swp_range24_reclaim | 1860.90% | 4.018 | 16.28% | 106 |
| 13 | sr35 | 4USDT | 1h | sr25_camarilla_h3_l3 | 1674.36% | 2.362 | 42.25% | 146 |
| 14 | sweep20 | SOONUSDT | 5m | swp_range48_reclaim | 1649.89% | 1.671 | 25.73% | 623 |
| 15 | sr35 | GRASSUSDT | 1h | sr_prior_day_sweep | 1546.32% | 3.287 | 32.76% | 86 |
| 16 | sr35 | GRASSUSDT | 1h | sr25_previous_day_sweep | 1546.32% | 3.287 | 32.76% | 86 |
| 17 | sweep20 | GRASSUSDT | 1h | swp_prior_day | 1546.32% | 3.287 | 32.76% | 86 |
| 18 | sweep20 | GPSUSDT | 1h | swp_wick_sfp | 1213.72% | 4.137 | 18.39% | 74 |
| 19 | sweep20 | BOMEUSDT | 1h | swp_pivot_sfp_body | 1033.80% | 3.338 | 21.44% | 122 |
| 20 | visual28 | MAGMAUSDT | 4h | vis_candlestick_reversal | 1002.65% | 2.243 | 46.95% | 90 |
| 21 | sr35 | BRUSDT | 1h | sr25_kernel_supply_demand | 984.77% | 1.710 | 50.88% | 210 |
| 22 | sr35 | GPSUSDT | 15m | sr_liquidity_sweep | 921.02% | 1.773 | 26.85% | 426 |
| 23 | sr35 | GPSUSDT | 15m | sr25_liquidity_sweep_reclaim | 921.02% | 1.773 | 26.85% | 426 |
| 24 | sweep20 | GPSUSDT | 15m | swp_range24_reclaim | 921.02% | 1.773 | 26.85% | 426 |
| 25 | sweep20 | FLOCKUSDT | 15m | swp_rsi_exhaustion | 879.97% | 1.887 | 28.43% | 225 |
| 26 | visual28 | PARTIUSDT | 1h | vis_bb_mean_reversion | 806.43% | 3.728 | 25.20% | 73 |
| 27 | sweep20 | NOMUSDT | 1h | swp_wick_sfp | 614.61% | 2.766 | 37.22% | 82 |
| 28 | sweep20 | FLOCKUSDT | 5m | swp_atr_expansion | 604.14% | 1.393 | 37.21% | 783 |
| 29 | sr35 | GRASSUSDT | 1m | sr25_poc_mean_reversion | 573.57% | 1.596 | 37.17% | 916 |
| 30 | sweep20 | QUSDT | 15m | swp_volume_absorption | 569.22% | 1.657 | 46.18% | 247 |
| 31 | sr35 | DASHUSDT | 1h | sr_liquidity_sweep | 565.42% | 2.164 | 30.65% | 118 |
| 32 | sr35 | DASHUSDT | 1h | sr25_liquidity_sweep_reclaim | 565.42% | 2.164 | 30.65% | 118 |
| 33 | sweep20 | DASHUSDT | 1h | swp_range24_reclaim | 565.42% | 2.164 | 30.65% | 118 |
| 34 | sr35 | MONUSDT | 15m | sr_liquidity_sweep | 549.72% | 1.608 | 31.23% | 431 |
| 35 | sr35 | MONUSDT | 15m | sr25_liquidity_sweep_reclaim | 549.72% | 1.608 | 31.23% | 431 |
| 36 | sweep20 | MONUSDT | 15m | swp_range24_reclaim | 549.72% | 1.608 | 31.23% | 431 |
| 37 | sr35 | EULUSDT | 15m | sr25_value_area_80 | 532.43% | 2.635 | 26.16% | 124 |
| 38 | sr35 | GRASSUSDT | 15m | sr25_poc_mean_reversion | 511.31% | 1.762 | 28.85% | 252 |
| 39 | sweep20 | FLOCKUSDT | 5m | swp_range48_reclaim | 506.97% | 1.430 | 41.02% | 605 |
| 40 | sr35 | GRASSUSDT | 15m | sr25_value_area_80 | 486.25% | 1.982 | 40.95% | 122 |
| 41 | sr35 | PIEVERSEUSDT | 5m | sr25_pdh_fvg_mss | 463.38% | 1.934 | 50.34% | 81 |
| 42 | visual28 | SAGAUSDT | 15m | vis_rsi_entries | 450.25% | 1.968 | 31.31% | 126 |
| 43 | sr35 | MONUSDT | 1h | sr25_poc_mean_reversion | 422.12% | 1.809 | 24.12% | 148 |
| 44 | sr35 | POWERUSDT | 15m | sr25_inverse_fvg | 390.71% | 1.713 | 34.90% | 198 |
| 45 | sweep20 | MONUSDT | 15m | swp_range48_reclaim | 356.97% | 1.648 | 26.65% | 212 |
| 46 | visual28 | GTCUSDT | 4h | vis_candlestick_reversal | 347.55% | 2.455 | 26.97% | 87 |
| 47 | sweep20 | ZETAUSDT | 4h | swp_opening_range | 338.51% | 2.693 | 17.91% | 96 |
| 48 | sr35 | EULUSDT | 15m | sr25_lsob | 317.67% | 1.729 | 44.02% | 162 |
| 49 | visual28 | 0GUSDT | 1h | vis_squeeze_momentum | 308.86% | 1.707 | 25.90% | 194 |
| 50 | sweep20 | WLFIUSDT | 15m | swp_range48_reclaim | 306.71% | 1.970 | 37.45% | 217 |
| 51 | sweep20 | MONUSDT | 15m | swp_atr_expansion | 303.16% | 1.572 | 28.96% | 257 |
| 52 | sweep20 | GUSDT | 4h | swp_asia_range | 292.79% | 2.235 | 32.07% | 89 |
| 53 | sweep20 | LITUSDT | 15m | swp_range48_reclaim | 292.62% | 1.542 | 29.92% | 210 |
| 54 | sweep20 | MOODENGUSDT | 15m | swp_wick_sfp | 285.34% | 1.626 | 21.91% | 262 |
| 55 | sweep20 | MONUSDT | 15m | swp_volume_absorption | 282.65% | 1.593 | 22.72% | 233 |
| 56 | algo9 | GTCUSDT | 1h | mavilimw | 247.74% | 2.116 | 19.83% | 91 |
| 57 | sweep20 | SUSHIUSDT | 15m | swp_failed_breakout | 238.86% | 1.516 | 22.08% | 346 |
| 58 | sweep20 | GUSDT | 1h | swp_asia_range | 230.77% | 2.112 | 40.68% | 104 |
| 59 | visual28 | CVCUSDT | 5m | vis_bollinger_rsi_double | 221.29% | 1.619 | 34.69% | 360 |
| 60 | sweep20 | GPSUSDT | 1h | swp_range12_reclaim | 217.62% | 1.671 | 30.31% | 156 |
| 61 | visual28 | WUSDT | 15m | vis_nadaraya_watson | 214.37% | 1.616 | 24.77% | 203 |
| 62 | sweep20 | AUSDT | 5m | swp_compression_reclaim | 212.19% | 1.535 | 16.48% | 399 |
| 63 | visual28 | LDOUSDT | 1h | vis_bb_mean_reversion | 210.97% | 2.189 | 12.99% | 83 |
| 64 | visual28 | WLFIUSDT | 1h | vis_bb_mean_reversion | 195.73% | 3.092 | 14.88% | 81 |
| 65 | sweep20 | VIRTUALUSDT | 15m | swp_failed_breakout | 192.97% | 1.401 | 23.83% | 347 |
| 66 | visual28 | CVCUSDT | 5m | vis_rsi_entries | 189.14% | 1.526 | 35.35% | 398 |
| 67 | fib9 | USELESSUSDT | 1h | elliott_abc | 188.96% | 3.100 | 13.75% | 44 |
| 68 | sweep20 | AUSDT | 1m | swp_asia_range | 188.17% | 1.806 | 24.56% | 155 |
| 69 | sweep20 | ARKMUSDT | 4h | swp_asia_range | 185.71% | 1.950 | 22.93% | 85 |
| 70 | sr35 | MANAUSDT | 5m | sr25_poc_mean_reversion | 183.29% | 1.714 | 19.24% | 425 |
| 71 | sr35 | RENDERUSDT | 1h | sr25_value_area_80 | 180.72% | 2.307 | 14.52% | 108 |
| 72 | algo9 | PHAUSDT | 1h | mavilimw | 172.89% | 1.669 | 56.34% | 94 |
| 73 | sweep20 | AUSDT | 5m | swp_asia_range | 168.90% | 1.772 | 18.12% | 151 |
| 74 | sr35 | BBUSDT | 1m | sr25_camarilla_h3_l3 | 149.21% | 1.603 | 33.17% | 191 |
| 75 | sweep20 | ETHFIUSDT | 15m | swp_rsi_exhaustion | 142.79% | 1.376 | 33.04% | 262 |
| 76 | sr35 | CELOUSDT | 1h | sr_liquidity_sweep | 139.91% | 2.134 | 23.31% | 102 |
| 77 | sr35 | CELOUSDT | 1h | sr25_liquidity_sweep_reclaim | 139.91% | 2.134 | 23.31% | 102 |
| 78 | sweep20 | CELOUSDT | 1h | swp_range24_reclaim | 139.91% | 2.134 | 23.31% | 102 |
| 79 | visual28 | GUSDT | 5m | vis_nadaraya_watson | 131.82% | 1.302 | 36.12% | 594 |
| 80 | sr35 | COMPUSDT | 1m | sr25_camarilla_h3_l3 | 126.99% | 1.576 | 17.19% | 192 |
| 81 | sr35 | SNXUSDT | 5m | sr25_pdh_fvg_mss | 123.23% | 2.072 | 27.62% | 79 |
| 82 | sweep20 | 1INCHUSDT | 15m | swp_pivot_sfp_body | 123.16% | 1.463 | 20.71% | 426 |
| 83 | fib9 | JUPUSDT | 1h | fib_golden_pocket | 44.26% | 1.186 | 32.92% | 126 |
| 84 | fib9 | JUPUSDT | 1h | fib_retrace_618 | 44.26% | 1.186 | 32.92% | 126 |
