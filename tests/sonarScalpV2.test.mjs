import assert from 'node:assert/strict';
import test from 'node:test';
import {
  detectSonarScalpV2EventsFromRows,
  evaluateSonarScalpV2Events,
  summarizeSonarScalpV2Outcomes,
} from '../dist/index.js';

const candle = (timestamp, open, close = open, overrides = {}) => ({
  timestamp,
  open,
  high: Math.max(open, close) + 1,
  low: Math.min(open, close) - 1,
  close,
  volume: 100,
  closed: true,
  ...overrides,
});

const features = (overrides = {}) => ({
  InternalStructure: 0,
  ExternalStructure: 0,
  BOSStrength: 0,
  CHOCHStrength: 0,
  SwingQuality: 0,
  RangeBoundary: 0,
  BreakoutDisplacement: 0,
  LiquidityDensity: 0,
  SweepDepth: 0,
  ReclaimQuality: 0,
  PostSweepDisplacement: 0,
  StructureShiftAfterSweep: 0,
  RetestQuality: 0,
  CompressionDepth: 0,
  CompressionDuration: 0,
  ExpansionVelocity: 1,
  TrendRangeScore: 0,
  RelativeVolume: 1,
  ...overrides,
});

test('V2 trend retest requires aligned 5m trend context', () => {
  const one = Array.from({ length: 8 }, (_, i) => candle(i * 60000, 100));
  const five = [candle(0, 100), candle(300000, 101)];
  const oneRows = one.map((c) => ({ timestamp: c.timestamp, features: features() }));
  oneRows[5] = { timestamp: one[5].timestamp, features: features({ RetestQuality: 0.7, RelativeVolume: 1.2 }) };
  const aligned = five.map((c) => ({ timestamp: c.timestamp, features: features({ InternalStructure: 1, ExternalStructure: 1, TrendRangeScore: 1 }) }));
  const events = detectSonarScalpV2EventsFromRows(one, oneRows, five, aligned, { cooldownBars: 0 });
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'trend_retest');
  assert.equal(events[0].direction, 1);

  const opposed = five.map((c) => ({ timestamp: c.timestamp, features: features({ InternalStructure: -1, ExternalStructure: -1, TrendRangeScore: -1 }) }));
  assert.equal(detectSonarScalpV2EventsFromRows(one, oneRows, five, opposed, { cooldownBars: 0 }).length, 0);
});

test('V2 range sweep requires non-trending context and opposite range boundary', () => {
  const one = Array.from({ length: 8 }, (_, i) => candle(i * 60000, 100));
  const five = [candle(0, 100), candle(300000, 100)];
  const oneRows = one.map((c) => ({ timestamp: c.timestamp, features: features() }));
  oneRows[5] = { timestamp: one[5].timestamp, features: features({ SweepDepth: 0.5, ReclaimQuality: 0.6, RelativeVolume: 1.1 }) };
  const rangeRows = five.map((c) => ({ timestamp: c.timestamp, features: features({ RangeBoundary: -0.8 }) }));
  const events = detectSonarScalpV2EventsFromRows(one, oneRows, five, rangeRows, { cooldownBars: 0 });
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'range_sweep');
  assert.equal(events[0].direction, 1);

  const trendRows = five.map((c) => ({ timestamp: c.timestamp, features: features({ InternalStructure: 1, ExternalStructure: 1, TrendRangeScore: 1, RangeBoundary: -0.8 }) }));
  assert.equal(detectSonarScalpV2EventsFromRows(one, oneRows, five, trendRows, { cooldownBars: 0 }).length, 0);
});

test('V2 enters on next 1m open and charges costs', () => {
  const candles = [
    candle(0, 100),
    candle(60000, 101, 102, { high: 103, low: 100 }),
    candle(120000, 102, 104, { high: 105, low: 101 }),
  ];
  const events = [{
    index: 0,
    timestamp: 0,
    kind: 'trend_retest',
    direction: 1,
    strength: 1,
    contextTimestamp: 0,
    contextScore: 1,
    contextBoundary: 0,
    triggerScore: 1,
  }];
  const outcomes = evaluateSonarScalpV2Events(candles, events, { horizonBars: 2, feeRate: 0.001, slippageRate: 0.001 });
  assert.equal(outcomes[0].entryPrice, 101);
  const gross = (104 - 101) / 101;
  assert.ok(Math.abs(outcomes[0].netReturn - (gross - 0.004)) < 1e-12);
});

test('V2 summaries remain setup-specific', () => {
  const base = {
    index: 0, timestamp: 0, direction: 1, strength: 1, contextTimestamp: 0,
    contextScore: 1, contextBoundary: 0, triggerScore: 1, entryIndex: 1, exitIndex: 1,
    entryPrice: 100, exitPrice: 101, grossReturn: 0.01, netReturn: 0.009,
    mae: -0.002, mfe: 0.012,
  };
  const outcomes = [
    { ...base, kind: 'trend_retest' },
    { ...base, kind: 'range_sweep', netReturn: -0.01, grossReturn: -0.009 },
  ];
  assert.equal(summarizeSonarScalpV2Outcomes(outcomes, 'trend_retest').sampleCount, 1);
  assert.ok(summarizeSonarScalpV2Outcomes(outcomes, 'range_sweep').expectancy < 0);
});
