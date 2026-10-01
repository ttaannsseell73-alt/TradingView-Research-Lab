import fs from 'node:fs';
import path from 'node:path';

const outDir = path.resolve(process.argv[2] ?? '');
const family = process.argv[3] ?? path.basename(outDir);
if (!outDir || !fs.existsSync(outDir)) throw new Error('Usage: node scripts/summarize-fullreset-family.mjs OUT_DIR FAMILY');
const MONTHS6 = ['2026-04','2026-05','2026-06','2026-07','2026-08','2026-09'];
const MONTHS3 = MONTHS6.slice(-3);

function esc(v) {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/u.test(s) ? '"' + s.replaceAll('"','""') + '"' : s;
}
function compound(rows, key) {
  return rows.reduce((eq,r)=>eq*Math.max(1e-9,1+Number(r?.[key]??0)),1)-1;
}
function checkpointFiles() {
  const dirs = fs.readdirSync(outDir).filter(x=>/^checkpoints-\d+-of-\d+$/u.test(x)).sort();
  return dirs.flatMap(d=>fs.readdirSync(path.join(outDir,d))
    .filter(x=>/^task-\d{6}\.json$/u.test(x))
    .sort().map(x=>path.join(outDir,d,x)));
}
const rows = [];
const failures = [];
for (const file of checkpointFiles()) {
  const cp = JSON.parse(fs.readFileSync(file,'utf8'));
  if (cp.failure) failures.push(cp.failure);
  const monthly = cp.monthlyResults ?? [];
  for (const r of cp.results ?? []) {
    const mine = monthly.filter(m=>m.id===r.id && m.symbol===r.symbol && m.timeframe===r.timeframe);
    const byMonth = new Map(mine.map(m=>[m.month,m]));
    const m6 = MONTHS6.map(m=>byMonth.get(m)).filter(Boolean);
    const m3 = MONTHS3.map(m=>byMonth.get(m)).filter(Boolean);
    const pass6 = m6.filter(m=>m.pass).length;
    const pass3 = m3.filter(m=>m.pass).length;
    const gate3 = m3.length===3 && pass3===3;
    const gate6 = m6.length===6 && pass6===6;
    const item = {
      family, symbol:r.symbol, timeframe:r.timeframe, id:r.id, name:r.name, version:r.version,
      canonicalMode:'ORIGINAL_NO_VARIANT',
      eligible3:m3.length, pass3, eligible6:m6.length, pass6, gate3, gate6,
      researchPass:Boolean(r.pass), trades:r.n, winRate:r.wr, pf:r.pf, net:r.net,
      stressNet:r.net15, lowCostNet:r.net6, dd:r.dd, expectancy:r.exp, sharpeLike:r.sh,
      longTrades:r.longTrades, longNet:r.longNet, longPF:r.longPF,
      shortTrades:r.shortTrades, shortNet:r.shortNet, shortPF:r.shortPF,
      coverage:r.coverage, historyDays:r.historyDays, firstBar:r.firstBar, lastBar:r.lastBar,
      recent3Net:compound(m3,'net'), recent3StressNet:compound(m3,'net15'),
      recent6Net:compound(m6,'net'), recent6StressNet:compound(m6,'net15'),
      months:Object.fromEntries(MONTHS6.map(m=>[m,byMonth.get(m)??null])),
    };
    item.mandatoryGate = item.gate3 && item.gate6 && item.researchPass;
    rows.push(item);
  }
}
rows.sort((a,b)=>Number(b.mandatoryGate)-Number(a.mandatoryGate)
  || Number(b.recent6StressNet??-Infinity)-Number(a.recent6StressNet??-Infinity)
  || Number(b.pf??-Infinity)-Number(a.pf??-Infinity)
  || Number(a.dd??Infinity)-Number(b.dd??Infinity));

const pass3 = rows.filter(r=>r.gate3 && r.researchPass);
const pass6 = rows.filter(r=>r.mandatoryGate);
fs.writeFileSync(path.join(outDir,'ALL_RESULTS.ndjson'),rows.map(r=>JSON.stringify(r)).join('\n')+'\n');
fs.writeFileSync(path.join(outDir,'FAILURES.json'),JSON.stringify(failures,null,2)+'\n');
const cols = [
  'family','symbol','timeframe','id','name','version','canonicalMode',
  'eligible3','pass3','eligible6','pass6','researchPass','mandatoryGate',
  'trades','winRate','pf','net','stressNet','dd','expectancy',
  'longTrades','longNet','longPF','shortTrades','shortNet','shortPF',
  'recent3Net','recent3StressNet','recent6Net','recent6StressNet',
  'coverage','historyDays','firstBar','lastBar'
];
function writeCsv(name, data) {
  const lines=[cols.join(',')];
  for(const r of data) lines.push(cols.map(c=>esc(r[c])).join(','));
  fs.writeFileSync(path.join(outDir,name),lines.join('\n')+'\n','utf8');
}
writeCsv('RECENT_3M_PASS.csv',pass3);
writeCsv('RECENT_6M_PASS.csv',pass6);

const byTf = Object.fromEntries([...new Set(rows.map(r=>r.timeframe))].sort().map(tf=>[
  tf,{tested:rows.filter(r=>r.timeframe===tf).length,pass3:pass3.filter(r=>r.timeframe===tf).length,pass6:pass6.filter(r=>r.timeframe===tf).length}
]));
const status = {
  schemaVersion:1, family, generatedAt:new Date().toISOString(),
  tested:rows.length, taskFailures:failures.length, pass3:pass3.length, pass6:pass6.length,
  mandatoryRule:'3/3 AND 6/6, canonical strategy only, no variants',
  byTimeframe:byTf,
  top6m:pass6.slice(0,100).map(r=>({symbol:r.symbol,timeframe:r.timeframe,id:r.id,stressNet:r.recent6StressNet,pf:r.pf,dd:r.dd,trades:r.trades}))
};
fs.writeFileSync(path.join(outDir,'MASTER_STATUS.json'),JSON.stringify(status,null,2)+'\n');

const md = [
  '# '+family+' — Full Reset 6M',
  '',
  '- Tested combinations: **'+rows.length+'**',
  '- 3/3 PASS: **'+pass3.length+'**',
  '- 6/6 PASS: **'+pass6.length+'**',
  '- Task failures: **'+failures.length+'**',
  '- Variants: **FORBIDDEN**',
  '',
  '## Top 6/6 candidates',
  '',
  '| # | Coin | TF | Strategy | 6M stress net | PF | DD | Trades |',
  '|---:|---|---|---|---:|---:|---:|---:|',
  ...pass6.slice(0,50).map((r,i)=>'| '+(i+1)+' | '+r.symbol+' | '+r.timeframe+' | '+r.id+' | '+(100*r.recent6StressNet).toFixed(2)+'% | '+Number(r.pf).toFixed(3)+' | '+(100*Number(r.dd)).toFixed(2)+'% | '+r.trades+' |'),
  ''
].join('\n');
fs.writeFileSync(path.join(outDir,'FINAL_REPORT.md'),md,'utf8');
console.log(JSON.stringify({family,tested:rows.length,pass3:pass3.length,pass6:pass6.length,failures:failures.length}));
