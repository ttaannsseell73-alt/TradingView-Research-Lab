const finite = Number.isFinite;

function avg(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function maxOf(bars, key) {
  return bars.reduce((m, b) => Math.max(m, Number(b[key])), -Infinity);
}

function minOf(bars, key) {
  return bars.reduce((m, b) => Math.min(m, Number(b[key])), Infinity);
}

function trueRangeAt(c, i) {
  const b = c[i];
  if (!b) return NaN;
  if (i === 0) return Number(b.h) - Number(b.l);
  const pc = Number(c[i - 1].c);
  return Math.max(
    Number(b.h) - Number(b.l),
    Math.abs(Number(b.h) - pc),
    Math.abs(Number(b.l) - pc),
  );
}

function atrAt(c, i, period = 14) {
  if (i < period - 1) return NaN;
  const xs = [];
  for (let k = i - period + 1; k <= i; k++) xs.push(trueRangeAt(c, k));
  return avg(xs);
}

function avgVolume(c, from, toExclusive) {
  const xs = [];
  for (let i = Math.max(0, from); i < Math.min(c.length, toExclusive); i++) {
    const v = Number(c[i].v ?? 0);
    if (finite(v)) xs.push(v);
  }
  return avg(xs);
}

export function structuralBias5m(contextBars, lookback = 12) {
  if (!Array.isArray(contextBars) || contextBars.length < lookback) return "NEUTRAL";
  const w = contextBars.slice(-lookback);
  const half = Math.floor(w.length / 2);
  const older = w.slice(0, half);
  const recent = w.slice(half);
  const olderHigh = maxOf(older, "h");
  const olderLow = minOf(older, "l");
  const recentHigh = maxOf(recent, "h");
  const recentLow = minOf(recent, "l");
  const lastClose = Number(w.at(-1).c);
  const olderMid = (olderHigh + olderLow) / 2;

  if (recentHigh > olderHigh && recentLow > olderLow && lastClose >= olderMid) return "LONG";
  if (recentHigh < olderHigh && recentLow < olderLow && lastClose <= olderMid) return "SHORT";
  return "NEUTRAL";
}

export function detectLiquiditySweepReclaim(c, i, {
  lookback = 20,
  volumeMultiplier = 1.05,
  sweepAtrFraction = 0.05,
  minWickFraction = 0.30,
} = {}) {
  if (i < Math.max(lookback, 14)) return null;
  const b = c[i];
  const prior = c.slice(i - lookback, i);
  const levelLow = minOf(prior, "l");
  const levelHigh = maxOf(prior, "h");
  const atr = atrAt(c, i, 14);
  if (!finite(atr) || atr <= 0) return null;

  const range = Math.max(1e-12, Number(b.h) - Number(b.l));
  const lowerWick = Math.min(Number(b.o), Number(b.c)) - Number(b.l);
  const upperWick = Number(b.h) - Math.max(Number(b.o), Number(b.c));
  const volumeBase = avgVolume(c, i - lookback, i);
  const volumeOk = volumeBase <= 0 || Number(b.v ?? 0) >= volumeBase * volumeMultiplier;
  const buffer = atr * sweepAtrFraction;

  const long =
    Number(b.l) < levelLow - buffer &&
    Number(b.c) > levelLow &&
    lowerWick / range >= minWickFraction &&
    volumeOk;

  const short =
    Number(b.h) > levelHigh + buffer &&
    Number(b.c) < levelHigh &&
    upperWick / range >= minWickFraction &&
    volumeOk;

  if (long === short) return null;
  return {
    setup: "liquidity_sweep_reclaim",
    direction: long ? "LONG" : "SHORT",
    level: long ? levelLow : levelHigh,
    atr,
    volumeRatio: volumeBase > 0 ? Number(b.v ?? 0) / volumeBase : null,
  };
}

export function detectBreakoutRetest(c, i, {
  lookback = 20,
  breakoutAtrFraction = 0.08,
  retestAtrFraction = 0.20,
} = {}) {
  if (i < Math.max(lookback + 1, 15)) return null;
  const prev = c[i - 1];
  const cur = c[i];
  const base = c.slice(i - 1 - lookback, i - 1);
  const high = maxOf(base, "h");
  const low = minOf(base, "l");
  const atr = atrAt(c, i - 1, 14);
  if (!finite(atr) || atr <= 0) return null;

  const longBreak = Number(prev.c) > high + atr * breakoutAtrFraction;
  const longRetest =
    Number(cur.l) <= high + atr * retestAtrFraction &&
    Number(cur.c) > high &&
    Number(cur.c) > Number(cur.o);

  const shortBreak = Number(prev.c) < low - atr * breakoutAtrFraction;
  const shortRetest =
    Number(cur.h) >= low - atr * retestAtrFraction &&
    Number(cur.c) < low &&
    Number(cur.c) < Number(cur.o);

  if (longBreak && longRetest) {
    return { setup: "breakout_retest", direction: "LONG", level: high, atr };
  }
  if (shortBreak && shortRetest) {
    return { setup: "breakout_retest", direction: "SHORT", level: low, atr };
  }
  return null;
}

export function detectCompressionExpansion(c, i, {
  compressionBars = 8,
  baselineBars = 24,
  compressionRatio = 0.65,
  expansionRatio = 1.8,
} = {}) {
  if (i < compressionBars + baselineBars) return null;
  const compressed = c.slice(i - compressionBars, i);
  const baseline = c.slice(i - compressionBars - baselineBars, i - compressionBars);
  const compressedRanges = compressed.map(b => Number(b.h) - Number(b.l));
  const baselineRanges = baseline.map(b => Number(b.h) - Number(b.l));
  const compressedAvg = avg(compressedRanges);
  const baselineAvg = avg(baselineRanges);
  if (!(compressedAvg > 0) || !(baselineAvg > 0)) return null;
  if (compressedAvg / baselineAvg > compressionRatio) return null;

  const cur = c[i];
  const curRange = Number(cur.h) - Number(cur.l);
  if (curRange < compressedAvg * expansionRatio) return null;

  const boxHigh = maxOf(compressed, "h");
  const boxLow = minOf(compressed, "l");
  if (Number(cur.c) > boxHigh) {
    return {
      setup: "compression_expansion",
      direction: "LONG",
      level: boxHigh,
      compressionRatio: compressedAvg / baselineAvg,
      expansionRatio: curRange / compressedAvg,
    };
  }
  if (Number(cur.c) < boxLow) {
    return {
      setup: "compression_expansion",
      direction: "SHORT",
      level: boxLow,
      compressionRatio: compressedAvg / baselineAvg,
      expansionRatio: curRange / compressedAvg,
    };
  }
  return null;
}

function confirmedSwingHigh(c, i, left = 2, right = 2) {
  if (i < left || i + right >= c.length) return false;
  const x = Number(c[i].h);
  for (let k = 1; k <= left; k++) if (!(x > Number(c[i - k].h))) return false;
  for (let k = 1; k <= right; k++) if (!(x >= Number(c[i + k].h))) return false;
  return true;
}

function confirmedSwingLow(c, i, left = 2, right = 2) {
  if (i < left || i + right >= c.length) return false;
  const x = Number(c[i].l);
  for (let k = 1; k <= left; k++) if (!(x < Number(c[i - k].l))) return false;
  for (let k = 1; k <= right; k++) if (!(x <= Number(c[i + k].l))) return false;
  return true;
}

function lastConfirmedSwing(c, i, side, searchBack = 40) {
  for (let k = i - 2; k >= Math.max(2, i - searchBack); k--) {
    if (side === "HIGH" && confirmedSwingHigh(c, k)) return { index: k, price: Number(c[k].h) };
    if (side === "LOW" && confirmedSwingLow(c, k)) return { index: k, price: Number(c[k].l) };
  }
  return null;
}

export function detectBosChoch(c, i, contextBias = "NEUTRAL") {
  if (i < 12) return null;
  const hi = lastConfirmedSwing(c, i, "HIGH");
  const lo = lastConfirmedSwing(c, i, "LOW");
  if (!hi || !lo) return null;

  const close = Number(c[i].c);
  const prevClose = Number(c[i - 1].c);

  if (prevClose <= hi.price && close > hi.price) {
    return {
      setup: "bos_choch",
      direction: "LONG",
      eventType: contextBias === "SHORT" ? "CHOCH" : "BOS",
      level: hi.price,
    };
  }
  if (prevClose >= lo.price && close < lo.price) {
    return {
      setup: "bos_choch",
      direction: "SHORT",
      eventType: contextBias === "LONG" ? "CHOCH" : "BOS",
      level: lo.price,
    };
  }
  return null;
}

export const SCALP_SETUPS = [
  "liquidity_sweep_reclaim",
  "breakout_retest",
  "compression_expansion",
  "bos_choch",
];

export function detectScalpSetups(candles1m, i, context5mBars, {
  requireContextAlignment = true,
} = {}) {
  if (!Array.isArray(candles1m) || i < 0 || i >= candles1m.length) return [];
  const bias = structuralBias5m(context5mBars);
  const raw = [
    detectLiquiditySweepReclaim(candles1m, i),
    detectBreakoutRetest(candles1m, i),
    detectCompressionExpansion(candles1m, i),
    detectBosChoch(candles1m, i, bias),
  ].filter(Boolean);

  return raw.map(signal => {
    const aligned = bias === "NEUTRAL" || bias === signal.direction;
    const reversal = signal.eventType === "CHOCH";
    const eligible = requireContextAlignment ? aligned || reversal : true;
    return {
      ...signal,
      contextBias: bias,
      contextAligned: aligned,
      reversal,
      eligible,
      signalIndex: i,
      signalTime: Number(candles1m[i].t),
    };
  });
}
