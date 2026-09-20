import assert from 'node:assert/strict';
import test from 'node:test';
import {
  detectSonarOrderflowEventsFromRows,
  evaluateSonarOrderflowEvents,
  parseSonarOrderflowCsv,
} from '../dist/index.js';

const candle = (timestamp, close = 100) => ({
  timestamp,
  open: close,
  high: close + 1,
  low: close - 1,
  close,
  volume: 100,
  closed: true,
});

const features = (overrides = {}) => ({
  InternalStructure: 0, ExternalStructure: 0, BOSStrength: 0, CHOCHStrength: 0,
  SwingQuality: 0, RangeBoundary: 0, BreakoutDisplacement: 0, LiquidityDensity: 0,
  SweepDepth: 0, ReclaimQuality: 0, PostSweepDisplacement: 0,
  StructureShiftAfterSweep: 0, RetestQuality: 0, CompressionDepth: 0,
  CompressionDuration: 0, ExpansionVelocity: 1, TrendRangeScore: 0, RelativeVolume: 1,
  ...overrides,
});

test('orderflow CSV parser accepts canonical rows', () => {
  const rows = parseSonarOrderflowCsv(
    'timestamp,buyVol,sellVol,buySellRatio,openInterest,openInterestValue\n0,120,80,1.5,1000,100000\n300000,140,60,2.3333,1010,101000\n',
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[1].openInterest, 1010);
});

test('orderflow-confirmed signal requires aligned taker pressure and rising OI', () => {
  const one = Array.from({ length: 12 }, (_, i) => candle(i * 60000));
  const five = [candle(0), candle(300000), candle(600000)];
  const oneRows = one.map((c) => ({ timestamp: c.timestamp, features: features() }));
  oneRows[10] = { timestamp: one[10].timestamp, features: features({ RetestQuality: 0.7, RelativeVolume: 1.2 }) };
  const fiveRows = five.map((c) => ({ timestamp: c.timestamp, features: features({ InternalStructure: 1, ExternalStructure: 1, TrendRangeScore: 1 }) }));
  const orderflow = [
    { timestamp: 0, buyVol: 100, sellVol: 100, buySellRatio: 1, openInterest: 1000, openInterestValue: 100000 },
    { timestamp: 300000, buyVol: 160, sellVol: 80, buySellRatio: 2, openInterest: 1010, openInterestValue: 101000 },
    { timestamp: 600000, buyVol: 150, sellVol: 100, buySellRatio: 1.5, openInterest: 1020, openInterestValue: 102000 },
  ];
  const events = detectSonarOrderflowEventsFromRows(one, oneRows, five, fiveRows, orderflow, { cooldownBars: 0 });
  assert.equal(events.length, 1);
  assert.equal(events[0].direction, 1);
  assert.ok(events[0].takerScore > 0);
  assert.ok(events[0].oiDelta > 0);
});

test('falling OI blocks event', () => {
  const one = Array.from({ length: 12 }, (_, i) => candle(i * 60000));
  const five = [candle(0), candle(300000), candle(600000)];
  const oneRows = one.map((c) => ({ timestamp: c.timestamp, features: features() }));
  oneRows[10] = { timestamp: one[10].timestamp, features: features({ RetestQuality: 0.7, RelativeVolume: 1.2 }) };
  const fiveRows = five.map((c) => ({ timestamp: c.timestamp, features: features() }));
  const orderflow = [
    { timestamp: 0, buyVol: 100, sellVol: 100, buySellRatio: 1, openInterest: 1000, openInterestValue: 100000 },
    { timestamp: 300000, buyVol: 160, sellVol: 80, buySellRatio: 2, openInterest: 990, openInterestValue: 99000 },
    { timestamp: 600000, buyVol: 150, sellVol: 100, buySellRatio: 1.5, openInterest: 980, openInterestValue: 98000 },
  ];
  assert.equal(detectSonarOrderflowEventsFromRows(one, oneRows, five, fiveRows, orderflow, { cooldownBars: 0 }).length, 0);
});

test('event study enters next candle and charges round-trip cost', () => {
  const candles = [
    { ...candle(0), open: 100 },
    { ...candle(60000, 102), open: 101, high: 103, low: 100 },
    { ...candle(120000, 104), open: 102, high: 105, low: 101 },
  ];
  const events = [{
    index: 0, timestamp: 0, direction: 1, triggerScore: 1, takerScore: 0.5,
    oiDelta: 0.01, contextScore: 1, orderflowTimestamp: 0, strength: 1,
  }];
  const outcomes = evaluateSonarOrderflowEvents(candles, events, { horizonBars: 2, feeRate: 0.001, slippageRate: 0.001 });
  assert.equal(outcomes[0].entryPrice, 101);
  const gross = (104 - 101) / 101;
  assert.ok(Math.abs(outcomes[0].netReturn - (gross - 0.004)) < 1e-12);
});
