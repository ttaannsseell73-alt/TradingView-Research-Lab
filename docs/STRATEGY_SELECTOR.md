# Strategy Selector — Canonical Product Direction

## Locked objective

This research lane is no longer a one-author or one-indicator experiment.

The target system searches an extensible catalog of TradingView strategies across the Binance USDⓈ-M Futures universe and discovers where each strategy actually works.

The primary research object is:

```
strategy × coin × timeframe
```

There is no assumption that one strategy should work on every coin.

## Canonical flow

```
TradingView strategy discovery
  -> reproducible closed-candle adapter
  -> Binance Futures universe
  -> 1m / 5m / 1h / 4h / 1d replay
  -> fee + slippage aware metrics
  -> profitability ranking
  -> Top-5 per strategy/timeframe
  -> cross-strategy Opportunity Board
  -> watchlist
  -> live signal observation
  -> paper / small-capital execution gate
  -> position management
```

## Ranking philosophy

The product is not trying to find a risk-free strategy.

Primary ranking is **net profitability after modeled trading costs**.

Risk statistics remain visible and actionable:
- profit factor,
- maximum drawdown,
- trade count,
- win rate,
- expectancy,
- chronological stability,
- stressed transaction cost result.

They are not allowed to silently turn the system into "lowest drawdown wins".

Clearly suspicious cases are flagged for review rather than automatically promoted or hidden.

## Opportunity Board outputs

For every research run the board must expose:

1. **Top 5 by strategy + timeframe** — the five most profitable eligible coins.
2. **Global opportunities** — strongest strategy/coin/timeframe combinations.
3. **Coin card** — best observed strategy/timeframe candidates for each coin.
4. **Consensus** — coins that work under more than one independent strategy family.
5. **Review flags** — extreme drawdown, extreme compounding, low trade count, partial data, or other suspicious evidence.

## Strategy plug-in contract

Every new strategy adapter must provide:

- stable strategy id and version,
- source/provenance metadata,
- explicit parameters,
- signal function over closed OHLCV,
- long/short semantics,
- no repainting / no future-data behavior,
- deterministic output,
- declared execution timing.

The scanner, metrics, ranking and UI must not be rewritten when a strategy is added.

## Promotion path

A high backtest rank is an **investment candidate**, not an automatic live order.

The intended path is:

```
research rank -> shortlist -> current-market signal -> paper/shadow -> small real allocation -> scale only with evidence
```

The main `binance-bot` execution engine remains separate until a candidate is explicitly promoted.
