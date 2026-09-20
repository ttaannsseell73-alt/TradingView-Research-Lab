import assert from 'node:assert/strict';
import test from 'node:test';
import {
  inspectCandleQuality,
  runRobustnessMatrix,
  tuneSetupConfig,
  replay,
} from '../dist/index.js';

const candle = (timestamp, close = 100, overrides = {}) => ({
  timestamp,
  open: close,
  high: close + 1,
  low: close - 1,
  close,
  volume: 100,
  closed: true,
  ...overrides,
});

test('data-quality report passes regular candles', () => {
  const candles = [candle(0), candle(60_000), candle(120_000), candle(180_000)];
  const report = inspectCandleQuality(candles);
  assert.equal(report.pass, true);
  assert.equal(report.inferredIntervalMs, 60_000);
  assert.equal(report.gapCount, 0);
});

test('data-quality report detects gaps and duplicates', () => {
  const candles = [candle(0), candle(60_000), candle(60_000), candle(240_000)];
  const report = inspectCandleQuality(candles);
  assert.equal(report.pass, false);
  assert.equal(report.duplicateTimestamps, 1);
  assert.ok(report.gapCount >= 1);
});

test('data-quality report rejects malformed OHLC and negative volume', () => {
  const candles = [
    candle(0),
    candle(60_000, 100, { high: 99, low: 101, volume: -1 }),
    candle(120_000),
  ];
  const report = inspectCandleQuality(candles);
  assert.equal(report.pass, false);
  assert.equal(report.invalidOhlc, 1);
  assert.equal(report.negativeVolume, 1);
});

test('robustness matrix spans every horizon and cost scenario deterministically', () => {
  const candles = [];
  for (let index = 0; index < 180; index += 1) {
    const phase = Math.floor(index / 15) % 2 === 0 ? 1 : -1;
    const close = 100 + phase * (index % 15) * 0.4 + Math.floor(index / 30) * 0.2;
    candles.push(candle(index * 60_000, close, {
      open: close - phase * 0.15,
      high: close + 0.8,
      low: close - 0.8,
      volume: 100 + (index % 10) * 5,
    }));
  }
  const config = {
    horizons: [3, 6],
    costScenarios: [
      { name: 'base', feeRate: 0.0004, slippageRate: 0.0001 },
      { name: 'stress', feeRate: 0.0005, slippageRate: 0.0003 },
    ],
    gateConfig: { minimumSamplesPerWindow: 2, minimumNetExpectancy: -1 },
  };
  const a = runRobustnessMatrix(candles, config);
  const b = runRobustnessMatrix(candles, config);
  assert.equal(a.runs.length, 4);
  assert.equal(a.decisions.length, 3);
  assert.deepEqual(a, b);
});

test('robustness decision cannot PASS if any run is insufficient', () => {
  const candles = Array.from({ length: 60 }, (_, index) => candle(index * 60_000, 100));
  const report = runRobustnessMatrix(candles, {
    horizons: [3, 12],
    gateConfig: { minimumSamplesPerWindow: 30, minimumNetExpectancy: 0 },
  });
  assert.ok(report.decisions.every((decision) => decision.status !== 'PASS'));
});


test('setup tuning is deterministic and uses training-window evidence only', () => {
  const candles = [];
  for (let index = 0; index < 240; index += 1) {
    const wave = Math.sin(index / 8) * 2;
    const drift = index * 0.01;
    const close = 100 + wave + drift;
    candles.push(candle(index * 60_000, close, {
      open: close - Math.sin(index / 5) * 0.2,
      high: close + 0.9,
      low: close - 0.9,
      volume: 100 + (index % 12) * 7,
    }));
  }
  const rows = replay(candles).rows;
  const train = { startIndex: 0, endIndexExclusive: 144 };
  const a = tuneSetupConfig(candles, rows, train, { horizonBars: 6, feeRate: 0.0004, slippageRate: 0.0001 }, 2);
  const b = tuneSetupConfig(candles, rows, train, { horizonBars: 6, feeRate: 0.0004, slippageRate: 0.0001 }, 2);
  assert.deepEqual(a, b);
  assert.equal(a.choices.length, 3);
});

test('robustness report records train-only tuning evidence by default', () => {
  const candles = Array.from({ length: 180 }, (_, index) => candle(index * 60_000, 100 + Math.sin(index / 6), {
    volume: 100 + (index % 8) * 10,
  }));
  const report = runRobustnessMatrix(candles, {
    horizons: [3],
    costScenarios: [{ name: 'base', feeRate: 0.0004, slippageRate: 0.0001 }],
    gateConfig: { minimumSamplesPerWindow: 2, minimumNetExpectancy: -1 },
  });
  assert.ok(report.tuning);
  assert.equal(report.tuning.choices.length, 3);
});
