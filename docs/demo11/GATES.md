# Demo-11 Evidence Gates

## Gate A — Engineering conformance

Run:

```bash
npm run gate:demo11
```

This gate is deterministic and exchange-write-free. It covers:

- immutable SignalEvent and deterministic lineage IDs;
- StrategyCore parity with legacy closed-candle direction;
- duplicate candle idempotency, gap detection and restart parity;
- reconstruction/arming separation and fail-closed state-hash mismatch;
- GUA directional liquidity (LONG ask / SHORT bid);
- missing or stale snapshot -> DEFER, never signal mutation;
- exactly-once intent creation, support_count and direction conflict;
- protected-position hold under execution DEFER/REJECT;
- orphan-fill critical semantics;
- emergency-shutdown result classification and proof requirements;
- Census conservation equations;
- Research / Shadow / read-only Runtime SignalEvent hash parity;
- readiness and cleanup guards.

Gate A does **not** approve a live or production trading mode.

## Gate B — Forward evidence

The frozen preregistration is `research/demo11/gate_b_preregistration.json`.

Evidence comes from mainnet **public market data in read-only shadow mode**. TESTNET is reserved for later execution correctness review, not strategy-market validation.

A duration by itself is not a pass criterion. The observation must contain enough fresh transitions and comparable execution decisions. If the minimum event counts are not reached, the outcome is `INSUFFICIENT_EVIDENCE`.

## Current observed evidence

The first canonical read-only real-data run:

- evaluated: 10 / 10;
- raw signal observations: 2;
- fresh state transitions: 0;
- execution decisions: 0;
- hypothetical intents: 0;
- Census: clean.

Therefore the current readiness state is **SHADOW_ONLY**. This is expected and is not a failure: the system now explains why no new trade intent existed in that bar instead of hiding the strategy state behind an execution status.

## Gate C — Manual review boundary

Even after Gate A and Gate B satisfy their criteria, the code may only report `READY_FOR_MANUAL_REVIEW`. There is deliberately no automatic execution-enable function in the canonical research layer.
