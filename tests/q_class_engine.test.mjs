import test from 'node:test';
import assert from 'node:assert/strict';

import {
  QFeatureCache,
  annotateRecovery,
  buildRangeReclaimVariants,
  canonicalStringify,
  createRangeReclaimContext,
  rangeReclaimSignals,
  sha256,
} from '../research/q_class_engine.mjs';
import { evaluateStrategies } from '../research/strategy_engine_v2.mjs';

function syntheticCandles(count = 900) {
  const out = [];
  const step = 15 * 60_000;
  let prevClose = 100;
  for (let i = 0; i < count; i += 1) {
    const wave = Math.sin(i / 17) * 3 + Math.sin(i / 43) * 6;
    const drift = Math.sin(i / 97) * 2;
    const open = prevClose;
    let close = 100 + wave + drift;
    let high = Math.max(open, close) + 0.6;
    let low = Math.min(open, close) - 0.6;

    if (i > 60 && i % 73 === 0) {
      high += 7;
      close = Math.min(close, open - 0.25);
    }
    if (i > 60 && i % 89 === 0) {
      low -= 7;
      close = Math.max(close, open + 0.25);
    }

    out.push({
      t: Date.UTC(2026, 0, 1) + i * step,
      o: open,
      h: Math.max(high, open, close),
      l: Math.min(low, open, close),
      c: close,
      v: 1000 + (i % 31) * 19,
    });
    prevClose = close;
  }
  return out;
}

test('canonical fingerprints are key-order invariant and mutation-sensitive', () => {
  assert.equal(
    canonicalStringify({ b: 2, a: { y: 2, x: 1 } }),
    canonicalStringify({ a: { x: 1, y: 2 }, b: 2 }),
  );
  assert.equal(
    sha256({ b: 2, a: 1 }),
    sha256({ a: 1, b: 2 }),
  );
  assert.notEqual(
    sha256({ a: 1, b: 2 }),
    sha256({ a: 1, b: 3 }),
  );
});

test('optimized prior range excludes current bar and matches exact previous window', () => {
  const candles = [
    { t: 0, o: 10, h: 12, l: 9, c: 11, v: 1 },
    { t: 1, o: 11, h: 13, l: 10, c: 12, v: 1 },
    { t: 2, o: 12, h: 14, l: 8, c: 13, v: 1 },
    { t: 3, o: 13, h: 20, l: 11, c: 19, v: 1 },
    { t: 4, o: 19, h: 21, l: 7, c: 20, v: 1 },
  ];
  const cache = new QFeatureCache(candles);
  const range = cache.priorRange(3);
  assert.equal(range.high[3], 14);
  assert.equal(range.low[3], 8);
  assert.equal(range.high[4], 20);
  assert.equal(range.low[4], 8);
});

test('range48 exact baseline keeps strategy-engine parity', () => {
  const candles = syntheticCandles();
  const start = candles[0].t;
  const end = candles.at(-1).t + 15 * 60_000;

  const legacy = evaluateStrategies(candles, {
    cost: 0.0014,
    stressCost: 0.0015,
    lowCost: 0.0006,
    minTrades: 1,
    start,
    end,
    strategyIds: ['swp_range48_reclaim'],
  })[0];

  const context = createRangeReclaimContext(candles, {
    range: {
      lookbacks: [48],
      thresholdAtr: [0.05],
      bodyConfirm: [false],
      wickRatio: [0],
      minBarRangeAtr: [0],
      directionModes: ['both'],
      baseline: {
        lookback: 48,
        thresholdAtr: 0.05,
        bodyConfirm: false,
        wickRatio: 0,
        minBarRangeAtr: 0,
        directionMode: 'both',
      },
    },
  });
  assert.equal(context.variants.length, 1);
  assert.equal(context.variants[0].baseline, true);

  const qclass = context.evaluate(context.variants[0], {
    timeframe: '15m',
    start,
    end,
    cost: 0.0014,
    stressCost: 0.0015,
    lowCost: 0.0006,
    minTrades: 1,
    monthlyMinTrades: 1,
    minCoverage: 0,
    holdoutMonths: 0,
  });

  assert.equal(qclass.n, legacy.n);
  assert.equal(qclass.longTrades, legacy.longTrades);
  assert.equal(qclass.shortTrades, legacy.shortTrades);
  assert.ok(Math.abs(qclass.net - legacy.net) < 1e-12);
  assert.ok(Math.abs(qclass.net15 - legacy.net15) < 1e-12);
  assert.ok(Math.abs(qclass.net6 - legacy.net6) < 1e-12);
  assert.ok(Math.abs(qclass.pf - legacy.pf) < 1e-12);
  assert.ok(Math.abs(qclass.dd - legacy.dd) < 1e-12);
});

test('range variant grid is deterministic and includes immutable baseline', () => {
  const config = {
    lookbacks: [64, 48],
    thresholdAtr: [0.08, 0.05],
    bodyConfirm: [true, false],
    wickRatio: [0],
    minBarRangeAtr: [0],
    directionModes: ['both'],
  };
  const a = buildRangeReclaimVariants(config);
  const b = buildRangeReclaimVariants(config);
  assert.deepEqual(
    a.map((x) => [x.variantId, x.variantFingerprint, x.baseline]),
    b.map((x) => [x.variantId, x.variantFingerprint, x.baseline]),
  );
  assert.equal(a.filter((x) => x.baseline).length, 1);
  assert.ok(a.some((x) => x.params.lookback === 48 && x.params.thresholdAtr === 0.05 && !x.params.bodyConfirm));
});

test('recovery annotation only upgrades near-pass without breaking passing months', () => {
  const monthlyBaseline = [
    { month: '2026-01', eligible: true, pass: true },
    { month: '2026-02', eligible: true, pass: true },
    { month: '2026-03', eligible: true, pass: false },
  ];
  const monthlyGood = monthlyBaseline.map((x) => ({ ...x, pass: true }));
  const monthlyBad = [
    { month: '2026-01', eligible: true, pass: false },
    { month: '2026-02', eligible: true, pass: true },
    { month: '2026-03', eligible: true, pass: true },
  ];
  const base = {
    variantId: 'base',
    baseline: true,
    eligibleMonths: 3,
    passMonths: 2,
    holdoutEligibleMonths: 1,
    holdoutPassMonths: 0,
    monthly: monthlyBaseline,
  };
  const good = {
    variantId: 'good',
    baseline: false,
    eligibleMonths: 3,
    passMonths: 3,
    holdoutEligibleMonths: 1,
    holdoutPassMonths: 1,
    monthly: monthlyGood,
  };
  const bad = {
    variantId: 'bad',
    baseline: false,
    eligibleMonths: 3,
    passMonths: 2,
    holdoutEligibleMonths: 1,
    holdoutPassMonths: 1,
    monthly: monthlyBad,
  };

  const rows = annotateRecovery([base, good, bad]);
  const g = rows.find((x) => x.variantId === 'good');
  const b = rows.find((x) => x.variantId === 'bad');
  assert.equal(g.recoveryCandidate, true);
  assert.equal(g.validatedRecovery, true);
  assert.equal(g.preservesPassingMonths, true);
  assert.equal(b.recoveryCandidate, false);
  assert.equal(b.preservesPassingMonths, false);
});

test('feature cache reuses ATR/range arrays across many variants', () => {
  const candles = syntheticCandles(200);
  const cache = new QFeatureCache(candles);
  const a1 = cache.atr(14);
  const a2 = cache.atr(14);
  const r1 = cache.priorRange(48);
  const r2 = cache.priorRange(48);
  assert.equal(a1, a2);
  assert.equal(r1, r2);

  const variants = buildRangeReclaimVariants({
    lookbacks: [48],
    thresholdAtr: [0.03, 0.05, 0.08],
    bodyConfirm: [false, true],
    wickRatio: [0, 1.5],
    minBarRangeAtr: [0],
    directionModes: ['both'],
  });
  for (const variant of variants) rangeReclaimSignals(candles, cache, variant.params);
  assert.equal(cache.size, 2);
});
