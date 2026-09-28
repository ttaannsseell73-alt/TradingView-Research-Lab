import crypto from 'node:crypto';

export const QCLASS_SCHEMA_VERSION = 2;
export const QCLASS_ENGINE_VERSION = 'qclass-discovery-v1';
export const QCLASS_MONTHLY_MODE = 'ENTRY_MONTH_STREAM_V2';

const finite = Number.isFinite;

function normalizeForJson(value) {
  if (Array.isArray(value)) return value.map(normalizeForJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, normalizeForJson(value[key])]),
    );
  }
  return value;
}

export function canonicalStringify(value) {
  return JSON.stringify(normalizeForJson(value));
}

export function sha256(value) {
  const data = typeof value === 'string' ? value : canonicalStringify(value);
  return crypto.createHash('sha256').update(data).digest('hex');
}

function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function stdev(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

function trueRange(candles) {
  return candles.map((b, i) => (
    i
      ? Math.max(
          b.h - b.l,
          Math.abs(b.h - candles[i - 1].c),
          Math.abs(b.l - candles[i - 1].c),
        )
      : b.h - b.l
  ));
}

function rma(xs, period) {
  const out = Array(xs.length).fill(Number.NaN);
  if (xs.length < period) return out;
  let s = 0;
  for (let i = 0; i < period; i += 1) s += xs[i];
  let q = s / period;
  out[period - 1] = q;
  for (let i = period; i < xs.length; i += 1) {
    q = (q * (period - 1) + xs[i]) / period;
    out[i] = q;
  }
  return out;
}

function rollingPriorExtrema(candles, period) {
  const high = Array(candles.length).fill(Number.NaN);
  const low = Array(candles.length).fill(Number.NaN);
  const maxQ = [];
  const minQ = [];
  let maxHead = 0;
  let minHead = 0;

  for (let i = 0; i < candles.length; i += 1) {
    const add = i - 1;
    if (add >= 0) {
      while (maxQ.length > maxHead && candles[maxQ[maxQ.length - 1]].h <= candles[add].h) {
        maxQ.pop();
      }
      maxQ.push(add);
      while (minQ.length > minHead && candles[minQ[minQ.length - 1]].l >= candles[add].l) {
        minQ.pop();
      }
      minQ.push(add);
    }

    const minAllowed = i - period;
    while (maxHead < maxQ.length && maxQ[maxHead] < minAllowed) maxHead += 1;
    while (minHead < minQ.length && minQ[minHead] < minAllowed) minHead += 1;

    if (i >= period && maxHead < maxQ.length && minHead < minQ.length) {
      high[i] = candles[maxQ[maxHead]].h;
      low[i] = candles[minQ[minHead]].l;
    }

    if (maxHead > 2048 && maxHead * 2 > maxQ.length) {
      maxQ.splice(0, maxHead);
      maxHead = 0;
    }
    if (minHead > 2048 && minHead * 2 > minQ.length) {
      minQ.splice(0, minHead);
      minHead = 0;
    }
  }

  return { high, low };
}

export class QFeatureCache {
  constructor(candles) {
    this.candles = candles;
    this.cache = new Map();
  }

  atr(period = 14) {
    const key = `atr:${period}`;
    if (!this.cache.has(key)) this.cache.set(key, rma(trueRange(this.candles), period));
    return this.cache.get(key);
  }

  priorRange(period) {
    const key = `range:${period}`;
    if (!this.cache.has(key)) this.cache.set(key, rollingPriorExtrema(this.candles, period));
    return this.cache.get(key);
  }

  get size() {
    return this.cache.size;
  }
}

function uniqueSortedNumbers(values, fallback) {
  const source = Array.isArray(values) && values.length ? values : fallback;
  return [...new Set(source.map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
}

function uniqueBooleans(values, fallback) {
  const source = Array.isArray(values) && values.length ? values : fallback;
  return [...new Set(source.map(Boolean))];
}

function uniqueStrings(values, fallback) {
  const source = Array.isArray(values) && values.length ? values : fallback;
  return [...new Set(source.map(String))].sort();
}

function numericKey(value) {
  return String(value).replace('-', 'm').replace('.', 'p');
}

function normalizeRangeConfig(config = {}) {
  return {
    lookbacks: uniqueSortedNumbers(config.lookbacks, [24, 36, 48, 64, 96]),
    thresholdAtr: uniqueSortedNumbers(config.thresholdAtr, [0.03, 0.05, 0.08, 0.12]),
    bodyConfirm: uniqueBooleans(config.bodyConfirm, [false, true]),
    wickRatio: uniqueSortedNumbers(config.wickRatio, [0, 1.5]),
    minBarRangeAtr: uniqueSortedNumbers(config.minBarRangeAtr, [0]),
    directionModes: uniqueStrings(config.directionModes, ['both']),
    atrPeriod: Number.isFinite(Number(config.atrPeriod)) ? Number(config.atrPeriod) : 14,
    baseline: {
      lookback: Number(config?.baseline?.lookback ?? 48),
      thresholdAtr: Number(config?.baseline?.thresholdAtr ?? 0.05),
      bodyConfirm: Boolean(config?.baseline?.bodyConfirm ?? false),
      wickRatio: Number(config?.baseline?.wickRatio ?? 0),
      minBarRangeAtr: Number(config?.baseline?.minBarRangeAtr ?? 0),
      directionMode: String(config?.baseline?.directionMode ?? 'both'),
    },
  };
}

function variantId(params) {
  return [
    'range_reclaim',
    `p${numericKey(params.lookback)}`,
    `t${numericKey(params.thresholdAtr)}`,
    `b${params.bodyConfirm ? 1 : 0}`,
    `w${numericKey(params.wickRatio)}`,
    `r${numericKey(params.minBarRangeAtr)}`,
    `d${params.directionMode}`,
  ].join('__');
}

export function buildRangeReclaimVariants(config = {}) {
  const cfg = normalizeRangeConfig(config);
  const variants = [];
  const seen = new Set();

  const push = (params, baseline = false) => {
    const fingerprint = sha256({ family: 'range_reclaim', params });
    if (seen.has(fingerprint)) {
      if (baseline) {
        const existing = variants.find((x) => x.variantFingerprint === fingerprint);
        if (existing) existing.baseline = true;
      }
      return;
    }
    seen.add(fingerprint);
    variants.push({
      family: 'range_reclaim',
      variantId: variantId(params),
      variantFingerprint: fingerprint,
      baseline,
      params,
    });
  };

  for (const lookback of cfg.lookbacks) {
    for (const thresholdAtr of cfg.thresholdAtr) {
      for (const bodyConfirm of cfg.bodyConfirm) {
        for (const wickRatio of cfg.wickRatio) {
          for (const minBarRangeAtr of cfg.minBarRangeAtr) {
            for (const directionMode of cfg.directionModes) {
              push({
                lookback,
                thresholdAtr,
                bodyConfirm,
                wickRatio,
                minBarRangeAtr,
                directionMode,
                atrPeriod: cfg.atrPeriod,
              });
            }
          }
        }
      }
    }
  }

  push({
    ...cfg.baseline,
    atrPeriod: cfg.atrPeriod,
  }, true);

  variants.sort((a, b) => a.variantId.localeCompare(b.variantId));
  return variants;
}

export function rangeReclaimSignals(candles, featureCache, params) {
  const { high, low } = featureCache.priorRange(params.lookback);
  const atr = featureCache.atr(params.atrPeriod ?? 14);
  const signals = Array(candles.length).fill(0);

  for (let i = Math.max(1, params.lookback); i < candles.length; i += 1) {
    const a = atr[i];
    if (!finite(a) || a <= 0) continue;
    const h = high[i];
    const l = low[i];
    if (!finite(h) || !finite(l)) continue;

    const bar = candles[i];
    let longSignal = bar.l < l - params.thresholdAtr * a && bar.c > l;
    let shortSignal = bar.h > h + params.thresholdAtr * a && bar.c < h;

    if (params.bodyConfirm) {
      longSignal = longSignal && bar.c > bar.o;
      shortSignal = shortSignal && bar.c < bar.o;
    }

    if (params.minBarRangeAtr > 0) {
      const wideEnough = (bar.h - bar.l) >= params.minBarRangeAtr * a;
      longSignal = longSignal && wideEnough;
      shortSignal = shortSignal && wideEnough;
    }

    if (params.wickRatio > 0) {
      const bodySize = Math.max(Math.abs(bar.c - bar.o), 0.02 * a);
      const lowerWick = Math.min(bar.o, bar.c) - bar.l;
      const upperWick = bar.h - Math.max(bar.o, bar.c);
      longSignal = longSignal && lowerWick > params.wickRatio * bodySize;
      shortSignal = shortSignal && upperWick > params.wickRatio * bodySize;
    }

    if (params.directionMode === 'long') shortSignal = false;
    else if (params.directionMode === 'short') longSignal = false;

    if (longSignal) signals[i] = 1;
    else if (shortSignal) signals[i] = -1;
  }

  return signals;
}

export function backtestReversal(candles, signals, tradeStart = -Infinity) {
  const trades = [];
  let pos = 0;
  let entryPrice = 0;
  let entryTime = 0;

  const closeTrade = (px, exitTime) => {
    if (!pos) return;
    const gross = pos === 1 ? px / entryPrice - 1 : entryPrice / px - 1;
    trades.push({ side: pos, entryTime, exitTime, gross });
  };

  for (let i = 0; i < signals.length - 1; i += 1) {
    const signal = signals[i];
    if (!signal || signal === pos) continue;
    const px = candles[i + 1].o;
    const tm = candles[i + 1].t;
    if (tm < tradeStart) continue;
    if (pos) closeTrade(px, tm);
    pos = signal;
    entryPrice = px;
    entryTime = tm;
  }

  if (pos && candles.length) {
    const bar = candles[candles.length - 1];
    closeTrade(bar.c, bar.t);
  }

  return trades;
}

export function tradeStats(trades, cost, start, end) {
  const returns = trades.map((trade) => trade.gross - cost);
  let equity = 1;
  let peak = 1;
  let dd = 0;
  let wins = 0;
  let grossWins = 0;
  let grossLoss = 0;

  for (const r of returns) {
    if (r > 0) {
      wins += 1;
      grossWins += r;
    } else if (r < 0) {
      grossLoss += r;
    }
    equity *= Math.max(1e-9, 1 + r);
    peak = Math.max(peak, equity);
    dd = Math.max(dd, 1 - equity / peak);
  }

  const width = (end - start) / 3;
  const seg = [0, 1, 2].map((j) => trades
    .filter((trade) => {
      if (!(width > 0)) return j === 0;
      const index = Math.min(2, Math.max(0, Math.floor((trade.entryTime - start) / width)));
      return index === j;
    })
    .reduce((eq, trade) => eq * (1 + trade.gross - cost), 1) - 1);

  const avg = mean(returns);
  const sd = stdev(returns);

  return {
    n: returns.length,
    wr: returns.length ? wins / returns.length : 0,
    net: equity - 1,
    pf: grossLoss < 0 ? grossWins / Math.abs(grossLoss) : (grossWins > 0 ? 999 : 0),
    dd,
    exp: avg,
    sh: sd ? avg / sd * Math.sqrt(returns.length) : 0,
    posseg: seg.filter((x) => x > 0).length,
    seg,
  };
}

function passStats(stats, minTrades) {
  return (
    stats.n >= minTrades
    && stats.net > 0
    && stats.exp > 0
    && stats.pf > 1.05
    && stats.posseg >= 2
  );
}

function intervalMs(timeframe) {
  const map = {
    '1m': 60_000,
    '5m': 300_000,
    '15m': 900_000,
    '1h': 3_600_000,
    '4h': 14_400_000,
  };
  const value = map[timeframe];
  if (!value) throw new Error(`Unsupported Q-Class timeframe: ${timeframe}`);
  return value;
}

function monthWindows(start, end) {
  const windows = [];
  let cursor = start;
  while (cursor < end) {
    const d = new Date(cursor);
    const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    const stop = Math.min(end, next > cursor ? next : end);
    windows.push({
      month: new Date(cursor).toISOString().slice(0, 7),
      start: cursor,
      end: stop,
    });
    cursor = stop;
  }
  return windows;
}

function monthCoverage(candles, window, tfMs) {
  const expected = Math.max(1, Math.floor((window.end - window.start) / tfMs));
  let count = 0;
  for (const bar of candles) {
    if (bar.t >= window.start && bar.t < window.end) count += 1;
  }
  return Math.min(1, count / expected);
}

function monthlyRows({
  candles,
  trades,
  cost,
  stressCost,
  start,
  end,
  timeframe,
  monthlyMinTrades,
  minCoverage,
}) {
  const tfMs = intervalMs(timeframe);
  return monthWindows(start, end)
    .map((window) => {
      const coverage = monthCoverage(candles, window, tfMs);
      if (coverage < minCoverage) {
        return {
          month: window.month,
          eligible: false,
          coverage,
          pass: false,
          reason: 'PARTIAL_COVERAGE',
        };
      }

      const monthTrades = trades.filter(
        (trade) => trade.entryTime >= window.start && trade.entryTime < window.end,
      );
      const base = tradeStats(monthTrades, cost, window.start, window.end);
      const stress = tradeStats(monthTrades, stressCost, window.start, window.end);
      const pass = passStats(base, monthlyMinTrades) && stress.net > 0;
      return {
        month: window.month,
        eligible: true,
        coverage,
        pass,
        n: base.n,
        net: base.net,
        net15: stress.net,
        pf: base.pf,
        dd: base.dd,
        exp: base.exp,
        posseg: base.posseg,
      };
    });
}

export function evaluateRangeVariant({
  candles,
  featureCache,
  variant,
  timeframe,
  start,
  end,
  cost = 0.0014,
  stressCost = 0.0015,
  lowCost = 0.0006,
  minTrades = 25,
  monthlyMinTrades = 10,
  minCoverage = 0.98,
  holdoutMonths = 0,
}) {
  const signals = rangeReclaimSignals(candles, featureCache, variant.params);
  const trades = backtestReversal(candles, signals, start);
  const base = tradeStats(trades, cost, start, end);
  const stress = tradeStats(trades, stressCost, start, end);
  const low = tradeStats(trades, lowCost, start, end);
  const longBase = tradeStats(trades.filter((t) => t.side === 1), cost, start, end);
  const shortBase = tradeStats(trades.filter((t) => t.side === -1), cost, start, end);
  const monthly = monthlyRows({
    candles,
    trades,
    cost,
    stressCost,
    start,
    end,
    timeframe,
    monthlyMinTrades,
    minCoverage,
  });

  const eligible = monthly.filter((row) => row.eligible);
  const passMonths = eligible.filter((row) => row.pass).length;
  const positiveMonths = eligible.filter((row) => Number(row.net) > 0).length;
  const stressPositiveMonths = eligible.filter((row) => Number(row.net15) > 0).length;
  const holdout = holdoutMonths > 0 ? eligible.slice(-holdoutMonths) : [];
  const discovery = holdoutMonths > 0 ? eligible.slice(0, -holdoutMonths) : eligible;

  return {
    schemaVersion: QCLASS_SCHEMA_VERSION,
    engineVersion: QCLASS_ENGINE_VERSION,
    monthlyMode: QCLASS_MONTHLY_MODE,
    family: variant.family,
    variantId: variant.variantId,
    variantFingerprint: variant.variantFingerprint,
    baseline: variant.baseline,
    params: variant.params,
    minTradesRequired: minTrades,
    ...base,
    net15: stress.net,
    net6: low.net,
    longTrades: longBase.n,
    longWinRate: longBase.wr,
    longNet: longBase.net,
    longPF: longBase.pf,
    longDD: longBase.dd,
    longExpectancy: longBase.exp,
    shortTrades: shortBase.n,
    shortWinRate: shortBase.wr,
    shortNet: shortBase.net,
    shortPF: shortBase.pf,
    shortDD: shortBase.dd,
    shortExpectancy: shortBase.exp,
    pass: passStats(base, minTrades) && stress.net > 0,
    eligibleMonths: eligible.length,
    passMonths,
    positiveMonths,
    stressPositiveMonths,
    discoveryEligibleMonths: discovery.length,
    discoveryPassMonths: discovery.filter((row) => row.pass).length,
    holdoutEligibleMonths: holdout.length,
    holdoutPassMonths: holdout.filter((row) => row.pass).length,
    monthly,
  };
}

export function annotateRecovery(results) {
  if (!Array.isArray(results) || !results.length) return results;
  const baseline = results.find((row) => row.baseline) ?? null;
  if (!baseline) return results.map((row) => ({ ...row, recoveryStatus: 'NO_BASELINE' }));

  const baseByMonth = new Map(baseline.monthly.map((row) => [row.month, row]));
  const baselineNearPass = baseline.eligibleMonths >= 2
    && baseline.passMonths === baseline.eligibleMonths - 1;

  return results.map((row) => {
    const rowByMonth = new Map(row.monthly.map((month) => [month.month, month]));
    const preservesPassingMonths = baseline.monthly
      .filter((month) => month.eligible && month.pass)
      .every((month) => rowByMonth.get(month.month)?.pass === true);
    const fullPass = row.eligibleMonths > 0 && row.passMonths === row.eligibleMonths;
    const holdoutPass = row.holdoutEligibleMonths === 0
      || row.holdoutPassMonths === row.holdoutEligibleMonths;
    const recoveryCandidate = !row.baseline
      && baselineNearPass
      && fullPass
      && preservesPassingMonths;
    const validatedRecovery = recoveryCandidate && holdoutPass;

    let recoveryStatus = 'OTHER';
    if (row.baseline) recoveryStatus = baselineNearPass ? 'BASELINE_NEAR_PASS' : 'BASELINE';
    else if (validatedRecovery) recoveryStatus = 'VALIDATED_RECOVERY';
    else if (recoveryCandidate) recoveryStatus = 'RECOVERY_CANDIDATE';
    else if (fullPass) recoveryStatus = 'FULL_PASS';

    return {
      ...row,
      baselinePassMonths: baseline.passMonths,
      baselineEligibleMonths: baseline.eligibleMonths,
      deltaPassMonths: row.passMonths - baseline.passMonths,
      preservesPassingMonths,
      fullPass,
      recoveryCandidate,
      validatedRecovery,
      recoveryStatus,
    };
  });
}

export function createRangeReclaimContext(candles, config = {}) {
  const featureCache = new QFeatureCache(candles);
  const variants = buildRangeReclaimVariants(config.range ?? config);
  return {
    featureCache,
    variants,
    evaluate(variant, runtime) {
      return evaluateRangeVariant({
        candles,
        featureCache,
        variant,
        ...runtime,
      });
    },
  };
}

export function compactResult(row) {
  const {
    monthly,
    seg,
    ...rest
  } = row;
  return rest;
}
