# Demo-11 Canonical Architecture Contract

## Authority flow

`Market Data -> StrategyCore -> SignalEvent Journal -> ExecutionDecision -> Intent/Risk -> Q Executor -> Fill -> Protection -> Reconcile`

Side controllers: Arming, Emergency Stop, Census/Telemetry.

## Cross-cutting invariants

1. `SignalEvent` is immutable and independent of execution state.
2. Strategy state is reconstructed deterministically; historical events may be journaled but cannot create live intents before the arming point.
3. Uncertainty blocks new entries but never closes an otherwise protected open position.
4. One fresh `signal_event_id` can create at most one entry intent.
5. Every fill must trace back to a signal event; an untraceable fill is `ORPHAN_FILL` and critical.
6. Infrastructure unavailability is `DEFER(infra_fault)` and eventually `MISSED(infra_fault)`, never a market-policy `REJECT`.
7. Entry liquidity is directional: LONG consumes asks, SHORT consumes bids. Opposite-side liquidity is an exit-risk/sizing input, not a signal mutation.
8. Restart parity compares `(state_hash, event)` per closed candle and must be exact for an ACTIVE strategy.
9. A parity-broken strategy is `QUARANTINED_PARITY`; it cannot trade but must not block unrelated strategies from migration work.
10. Emergency shutdown succeeds only after exchange reconciliation proves both zero position and zero open orders for the cohort. Unknown is failure, not success.

## Cutover gate

A one-cycle comparison is insufficient. Cutover requires a predeclared observation set containing enough closed bars and raw signals to exercise ALLOW/DEFER/REJECT/SUPPRESSED paths, with zero unexplained decision differences and a tested rollback switch.
