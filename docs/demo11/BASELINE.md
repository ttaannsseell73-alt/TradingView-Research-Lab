# Demo-11 Canonical Rebuild — C0 Baseline

Baseline commit: `f4261f080ab83dfdab2a547f145445e77ee89ff3`
Baseline branch: `main`
Migration branch: `demo11-canonical-rebuild`

## Non-negotiable migration rules

1. Q's proven execution spine is preserved until the replacement path proves parity.
2. Existing behavior is never silently promoted to signal truth.
3. Schema changes are additive until controlled cutover.
4. Behavior changes run behind a shadow/feature boundary before cutover.
5. Legacy code is removed only after controlled cutover and rollback proof.
6. Production execution remains disabled. Demo-11 work is TESTNET/shadow only.

## Baseline evidence classes

C0 deliberately separates two fixture classes:

- `SIGNAL_TRUTH_GOLDEN`: strategy semantics only. Execution quality, market snapshots, watchlists and tradability state are forbidden inputs.
- `LEGACY_BEHAVIOR_CAPTURE`: records current Demo-10 behavior, including known defects, only for regression comparison. It is not an oracle.

This split prevents known Demo-10 defects such as `BLOCK/NO_MARKET_SNAPSHOT -> BLOCKED` from becoming protected canonical behavior.

## Confirmed baseline defects

- `scripts/build-current-signal-watchlist.mjs` maps execution `BLOCK` and `NO_MARKET_SNAPSHOT` to signal status `BLOCKED`.
- `scripts/build-execution-watchlist.mjs` still uses generic `min(bidDepth10bps, askDepth10bps)` in classification logic.
- `livebot-patch/src/tools/stopDemo10AndClosePositions.ts` throws on an unclassified per-symbol error, aborting later symbols.
- Shadow mark validation already rejects null/undefined/zero/non-finite prices in the current baseline; C2 therefore protects this with regression tests rather than reintroducing a new implementation.

## C0 acceptance

- Main is not modified by the migration.
- The migration starts from the exact baseline SHA above.
- All subsequent behavior changes are made only on `demo11-canonical-rebuild` until cutover acceptance is satisfied.
