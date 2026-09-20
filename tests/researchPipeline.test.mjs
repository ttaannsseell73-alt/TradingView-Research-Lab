import assert from 'node:assert/strict';
import test from 'node:test';
import {
  KIVANC_CANDIDATES,
  decidePromotion,
  detectSetups,
  evaluateEvents,
  makeWalkForwardWindows,
  parseCandleCsv,
  replay,
  summarizeOutcomes,
} from '../dist/index.js';

const candle = (timestamp, close, overrides = {}) => ({
  timestamp,
  open: close,
  high: close + 1,
  low: close - 1,
  close,
  volume: 100,
  closed: true,
  ...overrides,
});

test('CSV parser accepts canonical candle file', () => {
  const csv = 'timestamp,open,high,low,close,volume\n1,100,101,99,100,10\n2,100,102,99,101,20\n';
  const rows = parseCandleCsv(csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].close, 101);
  assert.equal(rows[0].closed, true);
});

test('CSV parser fails closed on missing required column', () => {
  const csv = 'timestamp,open,high,low,close\n1,100,101,99,100\n';
  assert.throws(() => parseCandleCsv(csv), /volume/);
});

test('setup detector emits breakout event from canonical feature', () => {
  const candles = [candle(1, 100), candle(2, 101), candle(3, 110, { high: 111, low: 100, open: 101 })];
  const result = replay(candles, { internalLookback: 2, externalLookback: 4, levelLookback: 2, volumeLookback: 2, compressionLookback: 2 });
  const events = detectSetups(candles, result.rows, { breakoutStrength: 0.1 });
  assert.ok(events.some((event) => event.kind === 'breakout' && event.direction === 1));
});

test('event study subtracts round-trip fee and slippage', () => {
  const candles = [candle(1, 100), candle(2, 102), candle(3, 104)];
  const events = [{ index: 0, timestamp: 1, kind: 'breakout', direction: 1, strength: 1 }];
  const outcomes = evaluateEvents(candles, events, { horizonBars: 2, feeRate: 0.001, slippageRate: 0.001 });
  assert.equal(outcomes.length, 1);
  assert.ok(Math.abs(outcomes[0].grossReturn - 0.04) < 1e-12);
  assert.ok(Math.abs(outcomes[0].netReturn - 0.036) < 1e-12);
});

test('short event signed return is positive when price falls', () => {
  const candles = [candle(1, 100), candle(2, 98), candle(3, 95)];
  const events = [{ index: 0, timestamp: 1, kind: 'breakout', direction: -1, strength: 1 }];
  const outcomes = evaluateEvents(candles, events, { horizonBars: 2, feeRate: 0, slippageRate: 0 });
  assert.ok(outcomes[0].netReturn > 0);
});

test('summary computes hit rate and expectancy', () => {
  const outcomes = [
    { index: 0, timestamp: 1, kind: 'breakout', direction: 1, strength: 1, entryPrice: 100, exitPrice: 110, grossReturn: 0.1, netReturn: 0.08, mae: -0.01, mfe: 0.11 },
    { index: 1, timestamp: 2, kind: 'breakout', direction: 1, strength: 1, entryPrice: 100, exitPrice: 95, grossReturn: -0.05, netReturn: -0.07, mae: -0.08, mfe: 0.02 },
  ];
  const stats = summarizeOutcomes(outcomes, 'breakout');
  assert.equal(stats.sampleCount, 2);
  assert.equal(stats.hitRate, 0.5);
  assert.ok(Math.abs(stats.expectancy - 0.005) < 1e-12);
});

test('walk-forward windows are chronological and non-overlapping', () => {
  const windows = makeWalkForwardWindows(100);
  assert.deepEqual(windows, {
    train: { startIndex: 0, endIndexExclusive: 60 },
    validation: { startIndex: 60, endIndexExclusive: 80 },
    holdout: { startIndex: 80, endIndexExclusive: 100 },
  });
});

test('promotion gate requires validation and holdout evidence', () => {
  const makeStats = (setup, sampleCount, expectancy) => ({ setup, sampleCount, hitRate: 0.55, expectancy, averageWin: 0.01, averageLoss: -0.008, averageMae: -0.01, averageMfe: 0.02 });
  const validation = [
    makeStats('breakout', 40, 0.001),
    makeStats('liquidity_sweep_reclaim', 40, -0.001),
    makeStats('compression_release', 10, 0.002),
  ];
  const holdout = [
    makeStats('breakout', 40, 0.0005),
    makeStats('liquidity_sweep_reclaim', 40, 0.001),
    makeStats('compression_release', 10, 0.002),
  ];
  const decisions = decidePromotion(validation, holdout, { minimumSamplesPerWindow: 30, minimumNetExpectancy: 0 });
  assert.equal(decisions.find((x) => x.setup === 'breakout').status, 'PASS');
  assert.equal(decisions.find((x) => x.setup === 'liquidity_sweep_reclaim').status, 'REJECT');
  assert.equal(decisions.find((x) => x.setup === 'compression_release').status, 'INSUFFICIENT_DATA');
});

test('Kivanc catalog excludes classical oscillator stack from canonical core', () => {
  const tke = KIVANC_CANDIDATES.find((candidate) => candidate.name === 'TKE Indicator');
  const macd = KIVANC_CANDIDATES.find((candidate) => candidate.name === 'MACD ReLoaded');
  const squeeze = KIVANC_CANDIDATES.find((candidate) => candidate.name.startsWith('Squeeze Momentum'));
  assert.equal(tke?.disposition, 'EXCLUDED');
  assert.equal(macd?.disposition, 'EXCLUDED');
  assert.equal(squeeze?.disposition, 'MAPPED');
});
