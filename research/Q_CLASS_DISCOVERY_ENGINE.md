# Q-Class Discovery Engine

Purpose: find coin + strategy-variant + timeframe combinations that behave like the QUSDT/Range48 discovery, then recover near-pass systems such as 8/9 -> 9/9 and 11/12 -> 12/12 without mutating canonical live strategies.

## Engine invariants

- Existing canonical strategies are read-only inputs. Q-Class variants are separate research identities.
- Every run is fingerprinted by normalized plan + engine source + runner source.
- Every dataset is SHA256 fingerprinted.
- Every coin/timeframe/variant has an immutable combination ID and result ID.
- Checkpoints are accepted only when schema, engine version, task fingerprint, variant fingerprint and result ID all match.
- Cached OHLCV is read once per coin/timeframe; ATR and rolling range arrays are cached and reused across all variants.
- Parallel shards split coin/timeframe tasks. Variant sweeps inside a task share one feature cache.
- Monthly classification is ENTRY_MONTH_STREAM_V2: one full-history signal/trade stream is produced, then trades are attributed to their entry month. Strategy features are not recomputed twelve times.
- A recovery candidate is only valid when the baseline is exactly one month short of full pass, the variant reaches full pass, and every month that already passed in the baseline remains passing.
- Holdout months are reported separately. A validated recovery must also pass every eligible holdout month.
- The baseline Range48 variant is immutable: lookback 48, threshold 0.05 ATR, no body/wick/range filter, both directions.

## Default sweep

Range-reclaim family:

- lookback: 24, 36, 48, 64, 96
- threshold ATR: 0.03, 0.05, 0.08, 0.12
- body confirmation: off/on
- wick ratio: 0/1.5
- min bar range ATR: 0
- direction: both
- ATR period: 14

This is 80 variants per coin/timeframe.

## Local execution

```bash
npm run qclass:run -- qclass-plan.json
```

Persistent locations on the self-hosted research runner:

- CSV cache: `C:/actions-runner-datahub/qclass-cache/...`
- checkpoint root: `C:/actions-runner-datahub/qclass-checkpoints`

GitHub issue triggers:

- `[QCLASS SMOKE]` -> QUSDT, BTCUSDT, ETHUSDT
- `[QCLASS RUN]` -> exact guarded 725-symbol local futures universe

The workflow uploads only compact evidence. Detailed task/checkpoint state stays local and resumable.
