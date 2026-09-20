import assert from 'node:assert/strict';
import test from 'node:test';
import { FeatureEngine, replay } from '../dist/index.js';

const candle = (timestamp, overrides = {}) => ({
  timestamp,
  open: 100,
  high: 101,
  low: 99,
  close: 100,
  volume: 100,
  closed: true,
  ...overrides,
});

const cfg = {
  internalLookback: 2,
  externalLookback: 4,
  levelLookback: 4,
  volumeLookback: 4,
  compressionLookback: 2,
};

test('rejects open candles', () => {
  const engine = new FeatureEngine(cfg);
  assert.throws(() => engine.process(candle(1, { closed: false })), /closed/);
});

test('rejects non-increasing timestamps', () => {
  const engine = new FeatureEngine(cfg);
  engine.process(candle(1));
  assert.throws(() => engine.process(candle(1)), /strictly increasing/);
});

test('rejects non-finite OHLC values', () => {
  const engine = new FeatureEngine(cfg);
  assert.throws(() => engine.process(candle(1, { close: Number.NaN })), /non-finite/);
});

test('emits exactly the locked 18 canonical features', () => {
  const engine = new FeatureEngine(cfg);
  const row = engine.process(candle(1));
  assert.equal(Object.keys(row.features).length, 18);
  assert.deepEqual(Object.keys(row.features), [
    'InternalStructure', 'ExternalStructure', 'BOSStrength', 'CHOCHStrength',
    'SwingQuality', 'RangeBoundary', 'BreakoutDisplacement', 'LiquidityDensity',
    'SweepDepth', 'ReclaimQuality', 'PostSweepDisplacement', 'StructureShiftAfterSweep',
    'RetestQuality', 'CompressionDepth', 'CompressionDuration', 'ExpansionVelocity',
    'TrendRangeScore', 'RelativeVolume',
  ]);
});

test('current candle cannot leak into its prior breakout boundary', () => {
  const engine = new FeatureEngine(cfg);
  engine.process(candle(1, { high: 101, low: 99, close: 100 }));
  engine.process(candle(2, { high: 102, low: 99, close: 101 }));
  const row = engine.process(candle(3, { open: 101, high: 120, low: 100, close: 110 }));
  assert.ok(row.features.BOSStrength > 0);
  assert.ok(row.features.BreakoutDisplacement > 0);
});

test('downside breakout carries negative signed strength', () => {
  const engine = new FeatureEngine(cfg);
  engine.process(candle(1, { high: 101, low: 99, close: 100 }));
  engine.process(candle(2, { high: 101, low: 98, close: 99 }));
  const row = engine.process(candle(3, { open: 99, high: 99, low: 90, close: 92 }));
  assert.ok(row.features.BOSStrength < 0);
  assert.ok(row.features.BreakoutDisplacement < 0);
});

test('detects high liquidity sweep and reclaim', () => {
  const engine = new FeatureEngine(cfg);
  engine.process(candle(1, { high: 101, low: 99, close: 100 }));
  engine.process(candle(2, { high: 102, low: 99, close: 101 }));
  const row = engine.process(candle(3, { open: 101, high: 104, low: 100, close: 101.5 }));
  assert.ok(row.features.SweepDepth < 0);
  assert.ok(row.features.ReclaimQuality < 0);
  assert.equal(row.features.BOSStrength, 0);
});

test('relative volume uses prior candles only', () => {
  const engine = new FeatureEngine(cfg);
  engine.process(candle(1, { volume: 100 }));
  engine.process(candle(2, { volume: 100 }));
  const row = engine.process(candle(3, { volume: 250 }));
  assert.equal(row.features.RelativeVolume, 2.5);
});

test('compression then wide body candle produces expansion velocity', () => {
  const engine = new FeatureEngine(cfg);
  engine.process(candle(1, { high: 105, low: 95 }));
  engine.process(candle(2, { high: 105, low: 95 }));
  engine.process(candle(3, { high: 101, low: 99 }));
  engine.process(candle(4, { high: 101, low: 99 }));
  const row = engine.process(candle(5, { open: 100, high: 110, low: 99, close: 109 }));
  assert.ok(row.features.CompressionDepth > 0);
  assert.ok(row.features.ExpansionVelocity > 1);
});

test('replay is deterministic', () => {
  const candles = [candle(1), candle(2, { close: 100.5 }), candle(3, { close: 101 })];
  const a = replay(candles, cfg);
  const b = replay(candles, cfg);
  assert.equal(a.signature, b.signature);
  assert.deepEqual(a.rows, b.rows);
});

test('prefix invariance proves no future-candle mutation', () => {
  const base = [
    candle(1),
    candle(2, { high: 102, close: 101 }),
    candle(3, { high: 103, close: 102 }),
    candle(4, { high: 104, close: 103 }),
  ];
  const future = [
    ...base,
    candle(5, { high: 200, low: 20, close: 150, volume: 99999 }),
    candle(6, { high: 300, low: 10, close: 250, volume: 99999 }),
  ];
  const prefix = replay(base, cfg).rows;
  const extended = replay(future, cfg).rows.slice(0, base.length);
  assert.deepEqual(extended, prefix);
});
