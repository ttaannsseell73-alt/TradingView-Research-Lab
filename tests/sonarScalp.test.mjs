import assert from 'node:assert/strict';
import test from 'node:test';
import {
  detectSonarScalpEventsFromRows,
  evaluateSonarScalpEvents,
  latestClosedContextIndex,
  summarizeSonarScalpOutcomes,
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

test('Sonar context alignment never uses an unclosed 5m candle', () => {
  const five = [candle(0, 100), candle(300000, 101), candle(600000, 102)];
  assert.equal(latestClosedContextIndex(180000, 60000, five, 300000), -1);
  assert.equal(latestClosedContextIndex(240000, 60000, five, 300000), 0);
  assert.equal(latestClosedContextIndex(540000, 60000, five, 300000), 1);
});

test('Sonar emits long only when 5m context and 1m trigger agree', () => {
  const one = Array.from({ length: 8 }, (_, i) => candle(i * 60000, 100 + i * 0.1));
  const five = [candle(0, 100), candle(300000, 101)];
  const oneRows = one.map((c) => ({ timestamp: c.timestamp, features: features() }));
  oneRows[5] = { timestamp: one[5].timestamp, features: features({ SweepDepth: 0.6, ReclaimQuality: 0.5, PostSweepDisplacement: 0.3, RelativeVolume: 1.2 }) };
  const fiveRows = five.map((c) => ({ timestamp: c.timestamp, features: features({ InternalStructure: 1, ExternalStructure: 1, TrendRangeScore: 1 }) }));
  const events = detectSonarScalpEventsFromRows(one, oneRows, five, fiveRows, { cooldownBars: 0 });
  assert.equal(events.length, 1);
  assert.equal(events[0].direction, 1);
  assert.equal(events[0].triggerKind, 'sweep_reclaim');
});

test('Sonar rejects trigger when higher timeframe context disagrees', () => {
  const one = Array.from({ length: 8 }, (_, i) => candle(i * 60000, 100));
  const five = [candle(0, 100), candle(300000, 99)];
  const oneRows = one.map((c) => ({ timestamp: c.timestamp, features: features() }));
  oneRows[5] = { timestamp: one[5].timestamp, features: features({ RetestQuality: 0.8, RelativeVolume: 1.3 }) };
  const fiveRows = five.map((c) => ({ timestamp: c.timestamp, features: features({ InternalStructure: -1, ExternalStructure: -1, TrendRangeScore: -1 }) }));
  assert.equal(detectSonarScalpEventsFromRows(one, oneRows, five, fiveRows, { cooldownBars: 0 }).length, 0);
});

test('Sonar enters at next 1m open and charges round-trip cost', () => {
  const candles = [
    candle(0, 100, 100),
    candle(60000, 101, 102, { high: 103, low: 100 }),
    candle(120000, 102, 104, { high: 105, low: 101 }),
  ];
  const events = [{ index: 0, timestamp: 0, direction: 1, strength: 1, contextTimestamp: 0, contextScore: 1, triggerScore: 1, triggerKind: 'retest' }];
  const outcomes = evaluateSonarScalpEvents(candles, events, { horizonBars: 2, feeRate: 0.001, slippageRate: 0.001 });
  assert.equal(outcomes[0].entryPrice, 101);
  const gross = (104 - 101) / 101;
  assert.ok(Math.abs(outcomes[0].grossReturn - gross) < 1e-12);
  assert.ok(Math.abs(outcomes[0].netReturn - (gross - 0.004)) < 1e-12);
});

test('Sonar summary preserves negative expectancy', () => {
  const outcomes = [
    { netReturn: -0.01, grossReturn: -0.009, mae: -0.02, mfe: 0.001 },
    { netReturn: -0.02, grossReturn: -0.019, mae: -0.03, mfe: 0.002 },
  ].map((x, index) => ({
    index, timestamp: index, direction: 1, strength: 1, contextTimestamp: 0, contextScore: 1, triggerScore: 1, triggerKind: 'retest',
    entryIndex: index + 1, exitIndex: index + 1, entryPrice: 100, exitPrice: 99, ...x,
  }));
  const stats = summarizeSonarScalpOutcomes(outcomes);
  assert.equal(stats.sampleCount, 2);
  assert.ok(stats.expectancy < 0);
  assert.equal(stats.hitRate, 0);
});
