import fs from 'node:fs';
import path from 'node:path';

const input = process.argv[2];
const outDir = process.argv[3] ?? 'artifacts/opportunity-board';
if (!input) {
  console.error('Usage: node scripts/build-opportunity-board.mjs RESULT.json [OUT_DIR]');
  process.exit(2);
}

const doc = JSON.parse(fs.readFileSync(input, 'utf8'));
const rows = Array.isArray(doc.rows) ? doc.rows : Array.isArray(doc.results) ? doc.results : [];
if (!rows.length) throw new Error('No result rows found');

const n = r => Number(r.n ?? r.trades ?? 0);
const net = r => Number(r.net ?? r.netReturn ?? NaN);
const pf = r => Number(r.pf ?? r.profitFactor ?? NaN);
const dd = r => Number(r.dd ?? r.maxDrawdown ?? NaN);
const wr = r => Number(r.wr ?? r.winRate ?? NaN);
const exp = r => Number(r.exp ?? r.expectancy ?? NaN);
const sh = r => Number(r.sh ?? r.tradeSharpe ?? NaN);
const posseg = r => Number(r.posseg ?? r.positiveSegments ?? 0);
const stress = r => Number(r.net15 ?? r.stressNetReturn ?? net(r));
const id = r => String(r.id ?? r.strategy ?? 'unknown');
const tf = r => String(r.timeframe ?? doc.timeframe ?? 'unknown');

function flags(r) {
  const f = [];
  if (n(r) < 20) f.push('LOW_TRADES');
  if (dd(r) > 0.45) f.push('HIGH_DD');
  if (net(r) > 5) f.push('EXTREME_COMPOUNDING');
  if (pf(r) > 8) f.push('EXTREME_PF');
  if (posseg(r) < 2) f.push('UNSTABLE_SEGMENTS');
  if (Number(r.coverage ?? 1) < 0.95) f.push('PARTIAL_COVERAGE');
  return f;
}

function eligible(r) {
  return n(r) >= 20 &&
    Number.isFinite(net(r)) && net(r) > 0 &&
    Number.isFinite(exp(r)) && exp(r) > 0 &&
    Number.isFinite(pf(r)) && pf(r) > 1.05 &&
    posseg(r) >= 2 &&
    Number.isFinite(stress(r)) && stress(r) > 0;
}

const normalized = rows.map(r => ({
  symbol: r.symbol,
  strategy: id(r),
  timeframe: tf(r),
  trades: n(r),
  winRate: wr(r),
  netReturn: net(r),
  profitFactor: pf(r),
  maxDrawdown: dd(r),
  expectancy: exp(r),
  tradeSharpe: sh(r),
  positiveSegments: posseg(r),
  stressNetReturn: stress(r),
  eligible: eligible(r),
  reviewFlags: flags(r)
}));

const elig = normalized.filter(r => r.eligible);

const groups = new Map();
for (const r of elig) {
  const k = `${r.strategy}::${r.timeframe}`;
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(r);
}
const top5ByStrategyTimeframe = [...groups.entries()].map(([key, xs]) => {
  const [strategy, timeframe] = key.split('::');
  return {
    strategy,
    timeframe,
    top5: xs.sort((a,b) => b.netReturn - a.netReturn).slice(0,5)
  };
}).sort((a,b) => a.strategy.localeCompare(b.strategy) || a.timeframe.localeCompare(b.timeframe));

const byCoin = new Map();
for (const r of elig) {
  if (!byCoin.has(r.symbol)) byCoin.set(r.symbol, []);
  byCoin.get(r.symbol).push(r);
}
const coinCards = [...byCoin.entries()].map(([symbol, xs]) => ({
  symbol,
  candidates: xs.sort((a,b) => b.netReturn - a.netReturn).slice(0,5)
})).sort((a,b) => b.candidates[0].netReturn - a.candidates[0].netReturn);

const consensus = [...byCoin.entries()].map(([symbol, xs]) => ({
  symbol,
  strategyFamiliesObserved: new Set(xs.map(x => x.strategy)).size,
  combinations: xs.length,
  bestNetReturn: Math.max(...xs.map(x => x.netReturn)),
  strategies: [...new Set(xs.map(x => x.strategy))]
})).filter(x => x.strategyFamiliesObserved >= 2)
  .sort((a,b) => b.strategyFamiliesObserved - a.strategyFamiliesObserved || b.bestNetReturn - a.bestNetReturn);

const globalTop = [...elig].sort((a,b) => b.netReturn - a.netReturn).slice(0,100);

const board = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  source: path.basename(input),
  philosophy: {
    primaryRanking: 'netReturnAfterCosts',
    topN: 5,
    note: 'Risk metrics are displayed and suspicious evidence is flagged; profitability remains the primary rank.'
  },
  counts: {
    combinations: normalized.length,
    eligible: elig.length,
    symbols: new Set(normalized.map(x=>x.symbol)).size,
    strategies: new Set(normalized.map(x=>x.strategy)).size
  },
  top5ByStrategyTimeframe,
  globalTop,
  coinCards,
  consensus,
  review: normalized.filter(r => r.reviewFlags.length).sort((a,b) => b.netReturn - a.netReturn)
};

fs.mkdirSync(outDir, {recursive:true});
fs.writeFileSync(path.join(outDir,'OPPORTUNITY_BOARD.json'), JSON.stringify(board,null,2)+'\n');

const pc=x=>Number.isFinite(x)?(100*x).toFixed(2)+'%':'';
const num=x=>Number.isFinite(x)?x.toFixed(2):'';
const lines=['# Opportunity Board','','Primary sort: **net return after modeled costs**.','','## Top 5 by strategy/timeframe',''];
for (const g of top5ByStrategyTimeframe) {
  lines.push(`### ${g.strategy} / ${g.timeframe}`,'','| # | Coin | Net | PF | DD | Trades | Stability | Flags |','|---:|---|---:|---:|---:|---:|---:|---|');
  g.top5.forEach((r,i)=>lines.push(`| ${i+1} | ${r.symbol} | ${pc(r.netReturn)} | ${num(r.profitFactor)} | ${pc(r.maxDrawdown)} | ${r.trades} | ${r.positiveSegments}/3 | ${r.reviewFlags.join(', ')} |`));
  lines.push('');
}
lines.push('## Global top 30','','| # | Coin | Strategy | TF | Net | PF | DD | Trades | Flags |','|---:|---|---|---|---:|---:|---:|---:|---|');
globalTop.slice(0,30).forEach((r,i)=>lines.push(`| ${i+1} | ${r.symbol} | ${r.strategy} | ${r.timeframe} | ${pc(r.netReturn)} | ${num(r.profitFactor)} | ${pc(r.maxDrawdown)} | ${r.trades} | ${r.reviewFlags.join(', ')} |`));
fs.writeFileSync(path.join(outDir,'OPPORTUNITY_BOARD.md'), lines.join('\n')+'\n');

console.log(JSON.stringify({
  combinations: normalized.length,
  eligible: elig.length,
  strategyTimeframeGroups: top5ByStrategyTimeframe.length,
  top5: top5ByStrategyTimeframe,
  consensus: consensus.slice(0,20)
}, null, 2));
