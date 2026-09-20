# Kıvanç / TradingView Candidate Map

Research review date: 2026-09-20.

The useful material is retained as **concepts**, not copied Pine code. The canonical engine stays price-action-first.

| Candidate | Disposition | What survives in this lab |
|---|---|---|
| Squeeze Momentum Indicator Version2 | MAPPED | compression depth/duration and release velocity |
| HOTT / LOTT | MAPPED | high/low range boundary, displacement and breakout strength |
| AlphaTrend | MAPPED | trend-vs-range state, dynamic boundary and retest quality; CCI/MFI/ATR signal internals are not imported |
| OTT | REFERENCE_ONLY | external benchmark for trend-state behavior |
| Follow Line | REFERENCE_ONLY | future volatility-aware exit/risk research |
| ST0P | REFERENCE_ONLY | future trailing-stop/risk research |
| TKE | EXCLUDED | classical multi-oscillator stack conflicts with locked price-action-first core |
| MACD ReLoaded | EXCLUDED | MACD-family signal logic is outside the canonical core |
| MavilimW | EXCLUDED | long-horizon smoothed-MA logic is outside this scalping research lane |

Canonical source URLs are encoded in `src/candidates.ts` so the mapping is machine-testable.
