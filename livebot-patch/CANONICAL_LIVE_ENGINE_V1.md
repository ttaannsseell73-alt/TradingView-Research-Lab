# Canonical Live Engine v1.0 — FROZEN

Pilot: QUSDT / 15m / Sweep Range-48 (`swp_range48_reclaim`, `sweep-v1`).

## Frozen rules

- Same StrategyCore semantics in research/shadow/live.
- Closed candles only. Missing, stale, out-of-order or open bars => NO_ENTRY.
- Same coin + same direction => one intent + support_count.
- Opposite direction => DIRECTION_CONFLICT / NO_TRADE.
- ONE-WAY + ISOLATED + separate sub-account/API key.
- Withdraw disabled; manual trading and grid bot forbidden on the pilot account.
- Intent + transactional outbox must commit before any exchange write.
- PostgreSQL advisory leader lock + fencing token: one execution writer only.
- Timeout / 503 => UNKNOWN; no blind retry.
- In-flight registry + quiescence before reconciliation.
- Server-side catastrophic STOP_MARKET via current Binance algo-order API.
- HALT_NEW_ENTRIES never blocks risk-reducing exits.
- Rate-limit governor observes exchange headers and throttles proactively.
- No automatic zero-volume fill-forward.
- No exposure increase to close dust.
- No Virtual Position Ledger; canonical aggregation is single intent + support_count.
- SHADOW -> CANARY -> staged LIVE. LIVE requires explicit dual approval.
- AI does not sit in the execution path.

## Q pilot initial circuit breakers

Shadow reference limits:
- one open symbol (Q only)
- daily loss breaker: 1%
- weekly loss breaker: 3%
- peak drawdown breaker: 5%
- symbol notional reference: 5% equity
- portfolio notional reference: 25% equity
- Q leverage: fixed x1 (no leverage)

These are safety defaults for shadow/canary design, not permission to trade live.
Spread, depth and shortfall constants are calibrated from shadow telemetry before canary. Q leverage is not calibrated: it is locked to x1.

## Binance API contract pinned 2026-09-28

- normal order: POST /fapi/v1/order
- conditional/algo order: POST /fapi/v1/algoOrder
- conditional query: GET /fapi/v1/algoOrder, GET /fapi/v1/openAlgoOrders, GET /fapi/v1/allAlgoOrders
- position mode: /fapi/v1/positionSide/dual
- account config: GET /fapi/v1/accountConfig
- symbol config: GET /fapi/v1/symbolConfig
- position risk: GET /fapi/v3/positionRisk
- margin type: POST /fapi/v1/marginType
- leverage: POST /fapi/v1/leverage
- exchange metadata: GET /fapi/v1/exchangeInfo
- catastrophic stop default: STOP_MARKET, MARK_PRICE, closePosition=true, positionSide=BOTH

Any Binance API contract change requires adapter contract review before deployment.
