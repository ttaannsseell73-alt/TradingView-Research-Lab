import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? '');
if (!root || !fs.existsSync(root)) throw new Error('Usage: node scripts/merge-fullreset-6m.mjs ROOT');
const families = ['algo9','sr35','sweep20','visual28','fib9'];

function readNdjson(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file,'utf8').trim().split(/\r?\n/u).filter(Boolean).map(JSON.parse);
}
function esc(v) {
  const s=v==null?'':String(v);
  return /[",\r\n]/u.test(s)?'"'+s.replaceAll('"','""')+'"':s;
}
const rows=[];
const failures=[];
const familyStatus=[];
const checkpointIndex={};
for(const family of families){
  const dir=path.join(root,'out-'+family);
  rows.push(...readNdjson(path.join(dir,'ALL_RESULTS.ndjson')));
  if(fs.existsSync(path.join(dir,'FAILURES.json'))) failures.push(...JSON.parse(fs.readFileSync(path.join(dir,'FAILURES.json'),'utf8')).map(x=>({family,...x})));
  if(fs.existsSync(path.join(dir,'MASTER_STATUS.json'))) familyStatus.push(JSON.parse(fs.readFileSync(path.join(dir,'MASTER_STATUS.json'),'utf8')));
  checkpointIndex[family]=fs.existsSync(dir)
    ? fs.readdirSync(dir).filter(x=>/^checkpoints-\d+-of-\d+$/u.test(x))
      .reduce((n,d)=>n+fs.readdirSync(path.join(dir,d)).filter(x=>/^task-\d{6}\.json$/u.test(x)).length,0)
    : 0;
}
rows.sort((a,b)=>Number(b.mandatoryGate)-Number(a.mandatoryGate)
  || Number(b.recent6StressNet??-Infinity)-Number(a.recent6StressNet??-Infinity)
  || Number(b.pf??-Infinity)-Number(a.pf??-Infinity)
  || Number(a.dd??Infinity)-Number(b.dd??Infinity));
const pass3=rows.filter(r=>r.gate3&&r.researchPass);
const pass6=rows.filter(r=>r.mandatoryGate);

fs.writeFileSync(path.join(root,'ALL_RESULTS.ndjson'),rows.map(JSON.stringify).join('\n')+'\n');
fs.writeFileSync(path.join(root,'FAILURES.json'),JSON.stringify(failures,null,2)+'\n');
fs.writeFileSync(path.join(root,'CHECKPOINT_INDEX.json'),JSON.stringify(checkpointIndex,null,2)+'\n');
fs.writeFileSync(path.join(root,'SURVIVORS_6M.json'),JSON.stringify({
  generatedAt:new Date().toISOString(), count:pass6.length,
  candidates:pass6.map(r=>({family:r.family,symbol:r.symbol,timeframe:r.timeframe,id:r.id,version:r.version}))
},null,2)+'\n');
const cols=['family','symbol','timeframe','id','name','version','eligible3','pass3','eligible6','pass6',
  'trades','winRate','pf','net','stressNet','dd','expectancy','recent3Net','recent3StressNet',
  'recent6Net','recent6StressNet','longTrades','longNet','longPF','shortTrades','shortNet','shortPF',
  'coverage','historyDays','firstBar','lastBar'];
function csv(name,data){
  const out=[cols.join(',')];
  for(const r of data) out.push(cols.map(c=>esc(r[c])).join(','));
  fs.writeFileSync(path.join(root,name),out.join('\n')+'\n','utf8');
}
csv('RECENT_3M_PASS.csv',pass3);
csv('RECENT_6M_PASS.csv',pass6);

const status={
  schemaVersion:1, runId:'full-reset-20261001', generatedAt:new Date().toISOString(),
  activeUniverse:527, eligibleSixMonthSymbols:503, shortHistorySymbols:24,
  stage1TradeableUniverse:248, canonicalStrategies:101, variants:false,
  testedCombinations:rows.length, pass3:pass3.length, pass6:pass6.length,
  taskFailures:failures.length, familyStatus, checkpointIndex
};
fs.writeFileSync(path.join(root,'MASTER_STATUS.json'),JSON.stringify(status,null,2)+'\n');
const familyLines=familyStatus.map(s=>'| '+s.family+' | '+s.tested+' | '+s.pass3+' | '+s.pass6+' | '+s.taskFailures+' |');
const top=pass6.slice(0,100);
const md=[
  '# Full Reset Research — 6M Gate',
  '',
  '- Active Binance USD-M universe: **527**',
  '- Full 6-month history: **503**',
  '- Stage-1 tradeable test universe: **248**',
  '- Insufficient 6-month history: **24**',
  '- Canonical strategies: **101**',
  '- Variants: **none**',
  '- Mandatory gate: **3/3 AND 6/6 PASS**',
  '- 3/3 survivors: **'+pass3.length+'**',
  '- 6/6 survivors: **'+pass6.length+'**',
  '',
  '## Families','',
  '| Family | Tested | 3/3 | 6/6 | Failures |',
  '|---|---:|---:|---:|---:|',...familyLines,'',
  '## Top 6/6 research survivors','',
  '| # | Family | Coin | TF | Strategy | 6M stress net | PF | DD | Trades |',
  '|---:|---|---|---|---|---:|---:|---:|---:|',
  ...top.map((r,i)=>'| '+(i+1)+' | '+r.family+' | '+r.symbol+' | '+r.timeframe+' | '+r.id+' | '+(100*r.recent6StressNet).toFixed(2)+'% | '+Number(r.pf).toFixed(3)+' | '+(100*Number(r.dd)).toFixed(2)+'% | '+r.trades+' |'),''
].join('\n');
fs.writeFileSync(path.join(root,'FINAL_REPORT.md'),md,'utf8');
console.log(JSON.stringify({tested:rows.length,pass3:pass3.length,pass6:pass6.length,failures:failures.length}));
