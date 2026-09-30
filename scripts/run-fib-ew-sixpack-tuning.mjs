import fs from 'node:fs';
import path from 'node:path';
import { buildFibElliottSuite } from '../research/fib_elliott_strategies.mjs';

const START = Date.parse('2025-09-20T00:00:00Z');
const END = Date.parse('2026-09-20T00:00:00Z');
const COST = 0.0014;
const STRESS_COST = 0.0015;
const LOW_COST = 0.0006;
const MONTHLY_MIN_TRADES = 5;

const CANDIDATES = [
  { symbol: 'TAOUSDT', timeframe: '1h', baseId: 'fib_retrace_500' },
  { symbol: 'GRIFFAINUSDT', timeframe: '1h', baseId: 'fib_retrace_500' },
  { symbol: 'UBUSDT', timeframe: '15m', baseId: 'fib_retrace_500' },
  { symbol: 'BEATUSDT', timeframe: '1h', baseId: 'fib_golden_pocket' },
  { symbol: 'LAYERUSDT', timeframe: '1h', baseId: 'elliott_w2_w3' },
  { symbol: 'TAGUSDT', timeframe: '1h', baseId: 'elliott_w2_w3' },
];

const PIVOTS = [
  { left: 2, right: 2, tag: 'p22' },
  { left: 3, right: 2, tag: 'p32' },
  { left: 3, right: 3, tag: 'p33' },
  { left: 3, right: 4, tag: 'p34' },
  { left: 4, right: 4, tag: 'p44' },
];
const HOLDS = [8, 12, 16, 20, 24];
const DIRECTIONS = ['both', 'long', 'short'];

const finite = Number.isFinite;
const mean = (xs) => xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : 0;
const stdev = (xs) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s,x)=>s+(x-m)**2,0)/(xs.length-1));
};

function parseCsv(file) {
  const raw = fs.readFileSync(file, 'utf8').trim();
  if (!raw) return [];
  const lines = raw.split(/\r?\n/u);
  return lines.slice(1).map((line) => {
    const [t,o,h,l,c,v] = line.split(',').map(Number);
    return { t,o,h,l,c,v };
  }).filter((b) => [b.t,b.o,b.h,b.l,b.c,b.v].every(finite));
}

function backtestTargetPosition(c, target) {
  const trades = [];
  let pos = 0;
  let entryPrice = 0;
  let entryTime = 0;
  const closeTrade = (px, exitTime) => {
    if (!pos) return;
    const gross = pos === 1 ? px / entryPrice - 1 : entryPrice / px - 1;
    trades.push({ side: pos, entryTime, exitTime, gross });
  };
  for (let i=0; i<target.length-1; i++) {
    const want = target[i];
    if (![-1,0,1].includes(want) || want === pos) continue;
    const px = c[i+1].o;
    const tm = c[i+1].t;
    if (pos) closeTrade(px, tm);
    pos = want;
    if (pos) {
      entryPrice = px;
      entryTime = tm;
    }
  }
  if (pos && c.length) {
    const b = c[c.length-1];
    closeTrade(b.c, b.t);
  }
  return trades;
}

function stats(trades, cost, start, end) {
  const rs = trades.map((t) => t.gross - cost);
  let eq = 1;
  let peak = 1;
  let dd = 0;
  let wins = 0;
  let grossWins = 0;
  let grossLoss = 0;
  for (const r of rs) {
    if (r > 0) { wins += 1; grossWins += r; }
    else if (r < 0) grossLoss += r;
    eq *= Math.max(1e-9, 1+r);
    peak = Math.max(peak, eq);
    dd = Math.max(dd, 1-eq/peak);
  }
  const width = (end-start)/3;
  const seg = [0,1,2].map((j) => trades
    .filter((t) => Math.min(2, Math.floor((t.entryTime-start)/width)) === j)
    .reduce((e,t) => e*(1+t.gross-cost),1)-1);
  const avg = mean(rs);
  const sd = stdev(rs);
  return {
    n: rs.length,
    wr: rs.length ? wins/rs.length : 0,
    net: eq-1,
    pf: grossLoss < 0 ? grossWins/Math.abs(grossLoss) : (grossWins > 0 ? 999 : 0),
    dd,
    exp: avg,
    sh: sd ? avg/sd*Math.sqrt(rs.length) : 0,
    posseg: seg.filter((x)=>x>0).length,
  };
}

function directionTarget(target, direction) {
  if (direction === 'both') return target;
  if (direction === 'long') return target.map((x)=>x === 1 ? 1 : 0);
  return target.map((x)=>x === -1 ? -1 : 0);
}

function evaluate(candles, rawTarget, start, end, minTrades) {
  const target = rawTarget;
  const trades = backtestTargetPosition(candles, target);
  const base = stats(trades, COST, start, end);
  const stress = stats(trades, STRESS_COST, start, end);
  const low = stats(trades, LOW_COST, start, end);
  const longBase = stats(trades.filter((t)=>t.side===1), COST, start, end);
  const shortBase = stats(trades.filter((t)=>t.side===-1), COST, start, end);
  const pass = base.n >= minTrades && base.net > 0 && base.exp > 0 && base.pf > 1.05 && base.posseg >= 2 && stress.net > 0;
  return {
    ...base,
    net15: stress.net,
    net6: low.net,
    longTrades: longBase.n,
    longNet: longBase.net,
    longPF: longBase.pf,
    shortTrades: shortBase.n,
    shortNet: shortBase.net,
    shortPF: shortBase.pf,
    pass,
  };
}

function monthWindows(start, end) {
  const out = [];
  let cursor = start;
  while (cursor < end) {
    const d = new Date(cursor);
    const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth()+1, 1);
    const stop = Math.min(end, next > cursor ? next : end);
    out.push({ key: new Date(cursor).toISOString().slice(0,7), start: cursor, end: stop });
    cursor = stop;
  }
  return out;
}

function candlesIn(candles, start, end) {
  return candles.filter((b)=>b.t >= start && b.t < end);
}

function compound(rows, key) {
  return rows.reduce((eq,row)=>eq*Math.max(1e-9,1+Number(row[key] ?? 0)),1)-1;
}

function windowSummary(monthly, n) {
  const rows = monthly.slice(-n);
  return {
    eligible: rows.length,
    pass: rows.filter((x)=>x.pass).length,
    positive: rows.filter((x)=>x.net > 0).length,
    stressPositive: rows.filter((x)=>x.net15 > 0).length,
    net: compound(rows,'net'),
    net15: compound(rows,'net15'),
    worstDd: rows.reduce((m,x)=>Math.max(m,x.dd ?? 0),0),
    trades: rows.reduce((s,x)=>s+(x.n ?? 0),0),
  };
}

function rankRows(a,b) {
  return b.last9.pass - a.last9.pass
    || b.last6.pass - a.last6.pass
    || b.year.pass - a.year.pass
    || b.last3.pass - a.last3.pass
    || b.last9.net15 - a.last9.net15
    || b.full.net15 - a.full.net15
    || a.full.dd - b.full.dd;
}

function median(xs) {
  if (!xs.length) return 0;
  const ys = [...xs].sort((a,b)=>a-b);
  const m = Math.floor(ys.length/2);
  return ys.length % 2 ? ys[m] : (ys[m-1]+ys[m])/2;
}

function csvEscape(v) {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/u.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s;
}

const csvDir = path.resolve(process.env.RESEARCH_CSV_DIR ?? 'D:/Futures-Research-Data/research-cache/2025-09-20__2026-09-20__1m-5m-15m-1h-4h');
const outDir = path.resolve(process.env.TUNING_OUT_DIR ?? 'artifacts/fib-ew-sixpack-tuning');
fs.mkdirSync(outDir,{recursive:true});

const months = monthWindows(START, END);
const all = [];

for (const candidate of CANDIDATES) {
  const file = path.join(csvDir, candidate.symbol + '-' + candidate.timeframe + '.csv');
  if (!fs.existsSync(file)) throw new Error('Missing CSV: ' + file);
  const candles = parseCsv(file).filter((b)=>b.t >= START && b.t < END);
  if (!candles.length) throw new Error('No candles for ' + candidate.symbol + ' ' + candidate.timeframe);

  for (const pivot of PIVOTS) {
    for (const holdBars of HOLDS) {
      const fullSuite = buildFibElliottSuite(candles,{left:pivot.left,right:pivot.right,holdBars});
      const baseTarget = fullSuite.targets[candidate.baseId];
      for (const direction of DIRECTIONS) {
        const target = directionTarget(baseTarget,direction);
        const full = evaluate(candles,target,START,END,candidate.timeframe === '15m' ? 25 : 20);

        const monthly = [];
        for (const month of months) {
          const monthCandles = candlesIn(candles,month.start,month.end);
          if (monthCandles.length < 10) continue;
          const monthSuite = buildFibElliottSuite(monthCandles,{left:pivot.left,right:pivot.right,holdBars});
          const monthTarget = directionTarget(monthSuite.targets[candidate.baseId],direction);
          monthly.push({
            month: month.key,
            ...evaluate(monthCandles,monthTarget,month.start,month.end,MONTHLY_MIN_TRADES),
          });
        }

        const row = {
          ...candidate,
          config: pivot.tag + '_h' + holdBars + '_' + direction,
          left: pivot.left,
          right: pivot.right,
          holdBars,
          direction,
          baseline: pivot.left===3 && pivot.right===3 && holdBars===12 && direction==='both',
          full,
          year: windowSummary(monthly,monthly.length),
          last12: windowSummary(monthly,12),
          last9: windowSummary(monthly,9),
          last6: windowSummary(monthly,6),
          last3: windowSummary(monthly,3),
          monthly,
        };
        all.push(row);
      }
    }
  }
}

const baselines = Object.fromEntries(all.filter((x)=>x.baseline).map((x)=>[x.symbol+'|'+x.timeframe+'|'+x.baseId,x]));
for (const row of all) {
  const b = baselines[row.symbol+'|'+row.timeframe+'|'+row.baseId];
  row.delta = {
    yearPass: row.year.pass - b.year.pass,
    last9Pass: row.last9.pass - b.last9.pass,
    last6Pass: row.last6.pass - b.last6.pass,
    last3Pass: row.last3.pass - b.last3.pass,
    fullNet15: row.full.net15 - b.full.net15,
    last9Net15: row.last9.net15 - b.last9.net15,
    last6Net15: row.last6.net15 - b.last6.net15,
    fullDd: row.full.dd - b.full.dd,
  };
}

const topPerCandidate = [];
for (const candidate of CANDIDATES) {
  const rows = all.filter((x)=>x.symbol===candidate.symbol && x.timeframe===candidate.timeframe && x.baseId===candidate.baseId).sort(rankRows);
  topPerCandidate.push(...rows.slice(0,10).map((x,i)=>({...x,rank:i+1})));
}

const commonBoth = [];
for (const pivot of PIVOTS) {
  for (const holdBars of HOLDS) {
    const rows = all.filter((x)=>x.left===pivot.left && x.right===pivot.right && x.holdBars===holdBars && x.direction==='both');
    commonBoth.push({
      config: pivot.tag+'_h'+holdBars+'_both',
      left:pivot.left,
      right:pivot.right,
      holdBars,
      candidates: rows.length,
      sumYearPass: rows.reduce((s,x)=>s+x.year.pass,0),
      sumLast9Pass: rows.reduce((s,x)=>s+x.last9.pass,0),
      sumLast6Pass: rows.reduce((s,x)=>s+x.last6.pass,0),
      sumLast3Pass: rows.reduce((s,x)=>s+x.last3.pass,0),
      medianFullNet15: median(rows.map((x)=>x.full.net15)),
      medianLast9Net15: median(rows.map((x)=>x.last9.net15)),
      medianFullDd: median(rows.map((x)=>x.full.dd)),
      improved9Count: rows.filter((x)=>x.delta.last9Pass>0).length,
      improvedYearCount: rows.filter((x)=>x.delta.yearPass>0).length,
    });
  }
}
commonBoth.sort((a,b)=>b.sumLast9Pass-a.sumLast9Pass
  || b.sumLast6Pass-a.sumLast6Pass
  || b.sumYearPass-a.sumYearPass
  || b.medianLast9Net15-a.medianLast9Net15
  || a.medianFullDd-b.medianFullDd);

const bright = all.filter((x)=>!x.baseline
  && x.full.net15 > 0
  && x.last9.net15 > 0
  && x.last6.net15 > 0
  && x.last6.pass >= 5
  && x.last9.pass >= 7
  && x.year.pass >= 8
  && (x.delta.last9Pass > 0 || x.delta.yearPass > 0 || x.delta.fullDd < -0.05)
).sort(rankRows);

const summary = {
  schemaVersion:1,
  window:{start:new Date(START).toISOString(),end:new Date(END).toISOString()},
  candidates:CANDIDATES,
  structuralConfigs:PIVOTS.length*HOLDS.length,
  directionModes:DIRECTIONS,
  totalVariants:all.length,
  brightCount:bright.length,
  baseline:Object.values(baselines).map((x)=>({
    symbol:x.symbol,timeframe:x.timeframe,baseId:x.baseId,config:x.config,
    full:x.full,year:x.year,last9:x.last9,last6:x.last6,last3:x.last3,
  })),
  commonBothTop:commonBoth.slice(0,10),
  brightTop:bright.slice(0,30).map((x)=>({
    symbol:x.symbol,timeframe:x.timeframe,baseId:x.baseId,config:x.config,
    left:x.left,right:x.right,holdBars:x.holdBars,direction:x.direction,
    full:x.full,year:x.year,last9:x.last9,last6:x.last6,last3:x.last3,delta:x.delta,
  })),
};

fs.writeFileSync(path.join(outDir,'sixpack-summary.json'),JSON.stringify(summary,null,2)+'\n','utf8');
fs.writeFileSync(path.join(outDir,'sixpack-all.json'),JSON.stringify(all)+'\n','utf8');

const topCols = ['rank','symbol','timeframe','baseId','config','left','right','holdBars','direction',
  'yearPass','last9Pass','last6Pass','last3Pass','fullNet15','last9Net15','last6Net15','fullPF','fullDD',
  'deltaYearPass','delta9Pass','delta6Pass','deltaFullNet15','deltaFullDD'];
const topLines = [topCols.join(',')];
for (const x of topPerCandidate) {
  const vals = [
    x.rank,x.symbol,x.timeframe,x.baseId,x.config,x.left,x.right,x.holdBars,x.direction,
    x.year.pass,x.last9.pass,x.last6.pass,x.last3.pass,x.full.net15,x.last9.net15,x.last6.net15,x.full.pf,x.full.dd,
    x.delta.yearPass,x.delta.last9Pass,x.delta.last6Pass,x.delta.fullNet15,x.delta.fullDd,
  ];
  topLines.push(vals.map(csvEscape).join(','));
}
fs.writeFileSync(path.join(outDir,'top-per-candidate.csv'),topLines.join('\n')+'\n','utf8');

const commonCols = Object.keys(commonBoth[0] ?? {});
const commonLines = [commonCols.join(',')];
for (const x of commonBoth) commonLines.push(commonCols.map((k)=>csvEscape(x[k])).join(','));
fs.writeFileSync(path.join(outDir,'common-both.csv'),commonLines.join('\n')+'\n','utf8');

console.log(JSON.stringify({
  status:'COMPLETE',
  candidates:CANDIDATES.length,
  totalVariants:all.length,
  brightCount:bright.length,
  commonBest:commonBoth[0] ?? null,
  brightTop:summary.brightTop.slice(0,10),
},null,2));
