import fs from 'node:fs';
import path from 'node:path';

const DAY = 86_400_000;
const END = Date.parse(process.env.END_DATE ?? '2026-09-24T00:00:00Z');
const START = Date.parse(process.env.START_DATE ?? '2026-06-24T00:00:00Z');
const INTERVAL = '1h';
const ROUND_TRIP_COST = Number(process.env.ROUND_TRIP_COST ?? 0.0014); // 14 bps canonical fee+slippage
const OUT_DIR = process.env.OUT_DIR ?? 'artifacts/kivanc_top5_90d_1h';
const HOSTS = [
  'https://fapi.binance.com',
  'https://fapi1.binance.com',
  'https://fapi2.binance.com',
  'https://fapi3.binance.com',
];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const finite = (v) => Number.isFinite(v);

function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
function std(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}
function safeDiv(a, b) {
  return b === 0 ? (a > 0 ? Infinity : 0) : a / b;
}
function crossover(aPrev, bPrev, aCur, bCur) {
  return finite(aPrev) && finite(bPrev) && finite(aCur) && finite(bCur) && aPrev <= bPrev && aCur > bCur;
}
function crossunder(aPrev, bPrev, aCur, bCur) {
  return finite(aPrev) && finite(bPrev) && finite(aCur) && finite(bCur) && aPrev >= bPrev && aCur < bCur;
}

async function fetchJson(pathname, params = {}, attempt = 0) {
  const host = HOSTS[attempt % HOSTS.length];
  const url = new URL(pathname, host);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  try {
    const res = await fetch(url, { headers: { 'user-agent': 'TradingView-Research-Lab/1.0' } });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 300);
      throw new Error(`${res.status} ${body}`);
    }
    return await res.json();
  } catch (err) {
    if (attempt >= 7) throw err;
    await sleep(500 * (attempt + 1));
    return fetchJson(pathname, params, attempt + 1);
  }
}

async function getUniverse() {
  const info = await fetchJson('/fapi/v1/exchangeInfo');
  return info.symbols
    .filter((s) =>
      s.contractType === 'PERPETUAL' &&
      s.status === 'TRADING' &&
      (s.quoteAsset === 'USDT' || s.quoteAsset === 'USDC')
    )
    .map((s) => ({
      symbol: s.symbol,
      baseAsset: s.baseAsset,
      quoteAsset: s.quoteAsset,
      onboardDate: Number(s.onboardDate ?? 0),
    }))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
}

async function getKlines(symbol) {
  const rows = [];
  let cursor = START;
  while (cursor < END) {
    const page = await fetchJson('/fapi/v1/klines', {
      symbol,
      interval: INTERVAL,
      startTime: cursor,
      endTime: END - 1,
      limit: 1500,
    });
    if (!Array.isArray(page) || page.length === 0) break;
    for (const r of page) {
      const t = Number(r[0]);
      if (t >= START && t < END) {
        rows.push({
          t,
          o: Number(r[1]),
          h: Number(r[2]),
          l: Number(r[3]),
          c: Number(r[4]),
          v: Number(r[5]),
        });
      }
    }
    const next = Number(page.at(-1)?.[0] ?? cursor) + 3_600_000;
    if (next <= cursor) break;
    cursor = next;
    if (page.length < 1500) break;
    await sleep(310);
  }
  const dedup = new Map(rows.map((r) => [r.t, r]));
  return [...dedup.values()].sort((a, b) => a.t - b.t);
}

function sma(xs, period) {
  const out = Array(xs.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < xs.length; i++) {
    sum += xs[i];
    if (i >= period) sum -= xs[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

function ema(xs, period) {
  const out = Array(xs.length).fill(NaN);
  const a = 2 / (period + 1);
  let prev = NaN;
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i];
    if (!finite(prev)) prev = x;
    else prev = a * x + (1 - a) * prev;
    out[i] = prev;
  }
  return out;
}

function wma(xs, period) {
  const out = Array(xs.length).fill(NaN);
  const denom = period * (period + 1) / 2;
  for (let i = period - 1; i < xs.length; i++) {
    let s = 0;
    let ok = true;
    for (let k = 0; k < period; k++) {
      const x = xs[i - period + 1 + k];
      if (!finite(x)) { ok = false; break; }
      s += x * (k + 1);
    }
    if (ok) out[i] = s / denom;
  }
  return out;
}

function trueRange(candles) {
  return candles.map((b, i) => {
    if (i === 0) return b.h - b.l;
    const pc = candles[i - 1].c;
    return Math.max(b.h - b.l, Math.abs(b.h - pc), Math.abs(b.l - pc));
  });
}

function rma(xs, period) {
  const out = Array(xs.length).fill(NaN);
  if (xs.length < period) return out;
  let seed = 0;
  for (let i = 0; i < period; i++) seed += xs[i];
  let prev = seed / period;
  out[period - 1] = prev;
  for (let i = period; i < xs.length; i++) {
    prev = (prev * (period - 1) + xs[i]) / period;
    out[i] = prev;
  }
  return out;
}

function mfi(candles, period) {
  const out = Array(candles.length).fill(NaN);
  const tp = candles.map((b) => (b.h + b.l + b.c) / 3);
  const pos = Array(candles.length).fill(0);
  const neg = Array(candles.length).fill(0);
  for (let i = 1; i < candles.length; i++) {
    const flow = tp[i] * candles[i].v;
    if (tp[i] > tp[i - 1]) pos[i] = flow;
    else if (tp[i] < tp[i - 1]) neg[i] = flow;
  }
  let ps = 0, ns = 0;
  for (let i = 0; i < candles.length; i++) {
    ps += pos[i]; ns += neg[i];
    if (i >= period) { ps -= pos[i - period]; ns -= neg[i - period]; }
    if (i >= period - 1) out[i] = ns === 0 ? 100 : 100 - 100 / (1 + ps / ns);
  }
  return out;
}

function vidyaVar(src, period) {
  const out = Array(src.length).fill(NaN);
  const alpha = 2 / (period + 1);
  let prev = src[0];
  out[0] = prev;
  const ups = Array(src.length).fill(0);
  const dns = Array(src.length).fill(0);
  for (let i = 1; i < src.length; i++) {
    const d = src[i] - src[i - 1];
    ups[i] = Math.max(d, 0);
    dns[i] = Math.max(-d, 0);
  }
  let su = 0, sd = 0;
  for (let i = 0; i < src.length; i++) {
    su += ups[i]; sd += dns[i];
    if (i >= 9) { su -= ups[i - 9]; sd -= dns[i - 9]; }
    const cmo = su + sd === 0 ? 0 : (su - sd) / (su + sd);
    prev = alpha * Math.abs(cmo) * src[i] + (1 - alpha * Math.abs(cmo)) * prev;
    out[i] = prev;
  }
  return out;
}

function ottCore(src, period, percent) {
  const ma = vidyaVar(src, period);
  const longStop = Array(src.length).fill(NaN);
  const shortStop = Array(src.length).fill(NaN);
  const dir = Array(src.length).fill(1);
  const ott = Array(src.length).fill(NaN);
  for (let i = 0; i < src.length; i++) {
    const fark = ma[i] * percent * 0.01;
    let ls = ma[i] - fark;
    let ss = ma[i] + fark;
    if (i > 0) {
      if (ma[i] > longStop[i - 1]) ls = Math.max(ls, longStop[i - 1]);
      if (ma[i] < shortStop[i - 1]) ss = Math.min(ss, shortStop[i - 1]);
      dir[i] = dir[i - 1];
      if (dir[i - 1] === -1 && ma[i] > shortStop[i - 1]) dir[i] = 1;
      else if (dir[i - 1] === 1 && ma[i] < longStop[i - 1]) dir[i] = -1;
    }
    longStop[i] = ls;
    shortStop[i] = ss;
    const mt = dir[i] === 1 ? ls : ss;
    ott[i] = ma[i] > mt ? mt * (200 + percent) / 200 : mt * (200 - percent) / 200;
  }
  return { ma, ott };
}

function signalsPMax(candles) {
  const close = candles.map((b) => b.c);
  const ma = ema(close, 10);
  const atr = rma(trueRange(candles), 10);
  const pmax = Array(close.length).fill(NaN);
  const dir = Array(close.length).fill(1);
  let longStop = NaN, shortStop = NaN;
  for (let i = 0; i < close.length; i++) {
    if (!finite(ma[i]) || !finite(atr[i])) continue;
    const up = ma[i] - 3 * atr[i];
    const dn = ma[i] + 3 * atr[i];
    if (!finite(longStop)) {
      longStop = up; shortStop = dn; dir[i] = 1; pmax[i] = up; continue;
    }
    const prevMa = ma[i - 1];
    const prevLong = longStop;
    const prevShort = shortStop;
    longStop = finite(prevMa) && prevMa > prevLong ? Math.max(up, prevLong) : up;
    shortStop = finite(prevMa) && prevMa < prevShort ? Math.min(dn, prevShort) : dn;
    const prevDir = dir[i - 1] || 1;
    let d = prevDir;
    if (prevDir === -1 && ma[i] > prevShort) d = 1;
    else if (prevDir === 1 && ma[i] < prevLong) d = -1;
    dir[i] = d;
    pmax[i] = d === 1 ? longStop : shortStop;
  }
  const sig = Array(close.length).fill(0);
  for (let i = 1; i < close.length; i++) {
    if (crossover(ma[i - 1], pmax[i - 1], ma[i], pmax[i])) sig[i] = 1;
    else if (crossunder(ma[i - 1], pmax[i - 1], ma[i], pmax[i])) sig[i] = -1;
  }
  return sig;
}

function signalsAlphaTrend(candles) {
  const tr = trueRange(candles);
  const atr = sma(tr, 14);
  const mf = mfi(candles, 14);
  const at = Array(candles.length).fill(NaN);
  for (let i = 0; i < candles.length; i++) {
    if (!finite(atr[i]) || !finite(mf[i])) continue;
    const upT = candles[i].l - atr[i];
    const downT = candles[i].h + atr[i];
    const prev = i > 0 && finite(at[i - 1]) ? at[i - 1] : 0;
    at[i] = mf[i] >= 50 ? Math.max(upT, prev) : Math.min(downT, prev);
  }
  const sig = Array(candles.length).fill(0);
  for (let i = 3; i < candles.length; i++) {
    if (crossover(at[i - 1], at[i - 3], at[i], at[i - 2])) sig[i] = 1;
    else if (crossunder(at[i - 1], at[i - 3], at[i], at[i - 2])) sig[i] = -1;
  }
  return sig;
}

function signalsOTT(candles) {
  const close = candles.map((b) => b.c);
  const { ma, ott } = ottCore(close, 2, 1.4);
  const sig = Array(close.length).fill(0);
  for (let i = 4; i < close.length; i++) {
    if (crossover(ma[i - 1], ott[i - 3], ma[i], ott[i - 2])) sig[i] = 1;
    else if (crossunder(ma[i - 1], ott[i - 3], ma[i], ott[i - 2])) sig[i] = -1;
  }
  return sig;
}

function signalsTOTT(candles) {
  const close = candles.map((b) => b.c);
  const { ma, ott } = ottCore(close, 40, 1.0);
  const coeff = 0.006;
  const up = ott.map((v) => v * (1 + coeff));
  const dn = ott.map((v) => v * (1 - coeff));
  const sig = Array(close.length).fill(0);
  for (let i = 4; i < close.length; i++) {
    if (crossover(ma[i - 1], up[i - 3], ma[i], up[i - 2])) sig[i] = 1;
    else if (crossunder(ma[i - 1], dn[i - 3], ma[i], dn[i - 2])) sig[i] = -1;
  }
  return sig;
}

function signalsMavilimW(candles) {
  const close = candles.map((b) => b.c);
  let x = wma(close, 3);
  x = wma(x, 5);
  x = wma(x, 8);
  x = wma(x, 13);
  x = wma(x, 21);
  x = wma(x, 34);
  const sig = Array(close.length).fill(0);
  for (let i = 2; i < close.length; i++) {
    if (![x[i], x[i - 1], x[i - 2]].every(finite)) continue;
    const prevSlope = x[i - 1] - x[i - 2];
    const slope = x[i] - x[i - 1];
    if (prevSlope <= 0 && slope > 0) sig[i] = 1;
    else if (prevSlope >= 0 && slope < 0) sig[i] = -1;
  }
  return sig;
}

const STRATEGIES = [
  { id: 'pmax', name: 'PMax Explorer', params: 'ATR 10, multiplier 3, EMA 10', fn: signalsPMax },
  { id: 'alphatrend', name: 'AlphaTrend', params: 'period 14, multiplier 1, MFI', fn: signalsAlphaTrend },
  { id: 'ott', name: 'Optimized Trend Tracker', params: 'VAR 2, OTT 1.4%', fn: signalsOTT },
  { id: 'tott', name: 'Twin Optimized Trend Tracker', params: 'VAR 40, OTT 1%, twin coefficient 0.006', fn: signalsTOTT },
  { id: 'mavilimw', name: 'MavilimW', params: '3/5 Fibonacci WMA chain; color-change reversal', fn: signalsMavilimW },
];

function tradeStats(trades) {
  const rs = trades.map((t) => t.net);
  const wins = rs.filter((r) => r > 0);
  const losses = rs.filter((r) => r < 0);
  let equity = 1;
  let peak = 1;
  let maxDD = 0;
  for (const r of rs) {
    equity *= Math.max(0.000001, 1 + r);
    peak = Math.max(peak, equity);
    maxDD = Math.max(maxDD, 1 - equity / peak);
  }
  const bySide = (side) => {
    const xs = trades.filter((t) => t.side === side);
    const vals = xs.map((t) => t.net);
    return {
      trades: xs.length,
      netReturn: xs.reduce((e, r) => e * (1 + r), 1) - 1,
      winRate: xs.length ? vals.filter((r) => r > 0).length / xs.length : 0,
    };
  };
  const segWidth = (END - START) / 3;
  const segmentReturns = [0, 1, 2].map((seg) => {
    const xs = trades.filter((t) => {
      const s = Math.min(2, Math.floor((t.entryTime - START) / segWidth));
      return s === seg;
    });
    return xs.reduce((e, t) => e * (1 + t.net), 1) - 1;
  });
  const avg = mean(rs);
  const sd = std(rs);
  return {
    trades: trades.length,
    wins: wins.length,
    winRate: trades.length ? wins.length / trades.length : 0,
    netReturn: equity - 1,
    profitFactor: losses.length ? wins.reduce((a, b) => a + b, 0) / Math.abs(losses.reduce((a, b) => a + b, 0)) : (wins.length ? Infinity : 0),
    maxDrawdown: maxDD,
    expectancy: avg,
    tradeSharpe: sd > 0 ? avg / sd * Math.sqrt(trades.length) : 0,
    long: bySide(1),
    short: bySide(-1),
    segmentReturns,
    positiveSegments: segmentReturns.filter((r) => r > 0).length,
  };
}

function runBacktest(candles, signals) {
  const trades = [];
  let pos = 0;
  let entryPrice = NaN;
  let entryTime = NaN;

  const closeTrade = (exitPrice, exitTime) => {
    if (!pos || !finite(entryPrice) || !finite(exitPrice)) return;
    const gross = pos === 1 ? exitPrice / entryPrice - 1 : entryPrice / exitPrice - 1;
    trades.push({
      side: pos,
      entryTime,
      exitTime,
      entryPrice,
      exitPrice,
      gross,
      net: gross - ROUND_TRIP_COST,
    });
  };

  for (let i = 0; i < signals.length - 1; i++) {
    const s = signals[i];
    if (!s || s === pos) continue;
    const px = candles[i + 1].o;
    const tm = candles[i + 1].t;
    if (pos) closeTrade(px, tm);
    pos = s;
    entryPrice = px;
    entryTime = tm;
  }
  if (pos && candles.length) {
    const b = candles.at(-1);
    closeTrade(b.c, b.t);
  }
  return { trades, stats: tradeStats(trades) };
}

function pct(x) {
  return finite(x) ? (100 * x).toFixed(2) + '%' : '';
}
function num(x, d = 3) {
  return finite(x) ? x.toFixed(d) : 'inf';
}
function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s;
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const universe = await getUniverse();
console.log(`Universe: ${universe.length} active USDⓈ-M perpetual symbols`);

const results = [];
const failures = [];
let done = 0;

for (const meta of universe) {
  try {
    const candles = await getKlines(meta.symbol);
    if (candles.length < 240) {
      failures.push({ symbol: meta.symbol, reason: 'INSUFFICIENT_DATA', candles: candles.length });
      continue;
    }
    const coverage = {
      candles: candles.length,
      first: new Date(candles[0].t).toISOString(),
      last: new Date(candles.at(-1).t).toISOString(),
      expected: Math.round((END - START) / 3_600_000),
      ratio: candles.length / Math.round((END - START) / 3_600_000),
    };
    for (const strategy of STRATEGIES) {
      const signals = strategy.fn(candles);
      const { stats } = runBacktest(candles, signals);
      const pass = stats.trades >= 20 &&
        stats.netReturn > 0 &&
        stats.expectancy > 0 &&
        stats.profitFactor > 1.05 &&
        stats.positiveSegments >= 2;
      results.push({
        symbol: meta.symbol,
        baseAsset: meta.baseAsset,
        quoteAsset: meta.quoteAsset,
        strategy: strategy.id,
        strategyName: strategy.name,
        params: strategy.params,
        timeframe: INTERVAL,
        coverage,
        ...stats,
        status: pass ? 'PASS_BASELINE' : 'REJECT_BASELINE',
      });
    }
  } catch (err) {
    failures.push({ symbol: meta.symbol, reason: String(err?.message ?? err).slice(0, 500) });
  }
  done++;
  if (done % 20 === 0) console.log(`Processed ${done}/${universe.length}`);
}

results.sort((a, b) =>
  (b.status === 'PASS_BASELINE') - (a.status === 'PASS_BASELINE') ||
  b.netReturn - a.netReturn
);

const strategySummary = STRATEGIES.map((s) => {
  const xs = results.filter((r) => r.strategy === s.id);
  const passes = xs.filter((r) => r.status === 'PASS_BASELINE');
  return {
    strategy: s.id,
    strategyName: s.name,
    symbolsTested: xs.length,
    passes: passes.length,
    passRate: xs.length ? passes.length / xs.length : 0,
    medianNetReturn: xs.length ? [...xs].sort((a, b) => a.netReturn - b.netReturn)[Math.floor(xs.length / 2)].netReturn : 0,
    medianPF: xs.length ? [...xs].sort((a, b) => a.profitFactor - b.profitFactor)[Math.floor(xs.length / 2)].profitFactor : 0,
    top10: [...xs].sort((a, b) => b.netReturn - a.netReturn).slice(0, 10).map((r) => ({
      symbol: r.symbol,
      netReturn: r.netReturn,
      profitFactor: r.profitFactor,
      maxDrawdown: r.maxDrawdown,
      trades: r.trades,
      positiveSegments: r.positiveSegments,
      status: r.status,
    })),
  };
});

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  window: { start: new Date(START).toISOString(), end: new Date(END).toISOString(), days: (END - START) / DAY },
  market: 'Binance USDⓈ-M active perpetuals',
  timeframe: INTERVAL,
  execution: {
    signal: 'confirmed closed candle',
    entry: 'next bar open',
    exit: 'next opposite signal, next bar open; final trade at last close',
    roundTripCost: ROUND_TRIP_COST,
    costNote: 'canonical aggregate fee + slippage cost; funding excluded',
  },
  strategies: STRATEGIES.map(({ id, name, params }) => ({ id, name, params })),
  universeCount: universe.length,
  testedSymbols: new Set(results.map((r) => r.symbol)).size,
  failureCount: failures.length,
  strategySummary,
  results,
  failures,
};
fs.writeFileSync(path.join(OUT_DIR, 'results.json'), JSON.stringify(report, null, 2) + '\n');

const headers = [
  'symbol','quoteAsset','strategy','strategyName','timeframe','candles','coverageRatio',
  'trades','winRate','netReturn','profitFactor','maxDrawdown','expectancy','tradeSharpe',
  'longTrades','longNetReturn','shortTrades','shortNetReturn','positiveSegments','seg1','seg2','seg3','status'
];
const csv = [headers.join(',')];
for (const r of results) {
  const row = [
    r.symbol,r.quoteAsset,r.strategy,r.strategyName,r.timeframe,r.coverage.candles,r.coverage.ratio,
    r.trades,r.winRate,r.netReturn,r.profitFactor,r.maxDrawdown,r.expectancy,r.tradeSharpe,
    r.long.trades,r.long.netReturn,r.short.trades,r.short.netReturn,r.positiveSegments,
    ...r.segmentReturns,r.status
  ];
  csv.push(row.map(csvEscape).join(','));
}
fs.writeFileSync(path.join(OUT_DIR, 'leaderboard.csv'), csv.join('\n') + '\n');

const md = [];
md.push('# Kıvanç Top-5 — Binance Futures 90d / 1h');
md.push('');
md.push(`Window: **${new Date(START).toISOString().slice(0,10)} → ${new Date(END).toISOString().slice(0,10)} UTC**  `);
md.push(`Universe: **${universe.length}** active USDⓈ-M perpetual symbols  `);
md.push(`Canonical round-trip fee+slippage: **${pct(ROUND_TRIP_COST)}**  `);
md.push('Funding: excluded.');
md.push('');
md.push('## Strategy summary');
md.push('');
md.push('| Strategy | Symbols | PASS | Pass rate | Median net | Median PF |');
md.push('|---|---:|---:|---:|---:|---:|');
for (const s of strategySummary) {
  md.push(`| ${s.strategyName} | ${s.symbolsTested} | ${s.passes} | ${pct(s.passRate)} | ${pct(s.medianNetReturn)} | ${num(s.medianPF,2)} |`);
}
md.push('');
md.push('## Top 30 combinations');
md.push('');
md.push('| # | Symbol | Strategy | Trades | Win | Net | PF | Max DD | 3-period stability | Status |');
md.push('|---:|---|---|---:|---:|---:|---:|---:|---:|---|');
results.slice(0,30).forEach((r,i) => {
  md.push(`| ${i+1} | ${r.symbol} | ${r.strategyName} | ${r.trades} | ${pct(r.winRate)} | ${pct(r.netReturn)} | ${num(r.profitFactor,2)} | ${pct(r.maxDrawdown)} | ${r.positiveSegments}/3 | ${r.status} |`);
});
md.push('');
md.push('PASS_BASELINE requires: >=20 trades, positive net return and expectancy after costs, PF>1.05, and at least 2/3 chronological segments positive.');
fs.writeFileSync(path.join(OUT_DIR, 'SUMMARY.md'), md.join('\n') + '\n');
fs.writeFileSync(path.join(OUT_DIR, 'failures.json'), JSON.stringify(failures, null, 2) + '\n');

console.log(JSON.stringify({
  universe: universe.length,
  testedSymbols: report.testedSymbols,
  failures: failures.length,
  summary: strategySummary.map((s) => ({ strategy: s.strategy, passes: s.passes, passRate: s.passRate })),
  top: results.slice(0, 10).map((r) => ({ symbol: r.symbol, strategy: r.strategy, netReturn: r.netReturn, pf: r.profitFactor, status: r.status })),
}, null, 2));
