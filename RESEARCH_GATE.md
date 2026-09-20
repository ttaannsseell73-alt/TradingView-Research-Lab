# Research Gate

A TradingView/Kıvanç-derived idea may move toward `BinanceGridBot` only after all of the following are true:

1. **Original implementation only** — do not copy Pine source code.
2. **Closed-candle semantics** — no decision may depend on an unfinished candle.
3. **No lookahead / no repaint** — prefix-invariance tests must pass.
4. **Deterministic replay** — identical input/config must produce identical output/signature.
5. **Costs included** — fee and slippage assumptions must be explicit in the evaluation layer.
6. **Out-of-sample validation** — train/validation/holdout periods stay separated.
7. **Regime coverage** — trend, range, compression and expansion regimes are tested separately.
8. **Failure threshold** — a feature with unstable expectancy, insufficient samples, or material regime fragility is rejected.
9. **Controlled promotion** — accepted features enter the main bot through a reviewed adapter; this repository never places orders.

Passing the software integrity gate means only that the feature is measurable and non-repainting. It is not evidence of profitability.
