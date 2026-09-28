import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve(process.argv[2] ?? 'artifacts/range48-cloud-merged');
const files=fs.existsSync(root)?fs.readdirSync(root):[];

function readNdjson(namePrefix){
  const rows=[];
  for(const name of files.filter(n=>n.startsWith(namePrefix)&&n.endsWith('.ndjson')).sort()){
    const p=path.join(root,name);
    const txt=fs.readFileSync(p,'utf8');
    for(const line of txt.split(/\r?\n/)){
      if(line.trim()) rows.push(JSON.parse(line));
    }
  }
  return rows;
}
function esc(v){
  if(v==null)return '';
  const s=String(v);
  return /[",\r\n]/u.test(s)?'"'+s.replace(/"/g,'""')+'"':s;
}

let results=readNdjson('results-cloud-');
let monthly=readNdjson('monthly-cloud-');
let failures=readNdjson('failures-cloud-');

// Turbo cloud shards use one JSON payload per shard. Keep backwards read support
// so archived artifacts remain inspectable, but all new runs use result-cloud-*.
for(const name of files.filter(n=>n.startsWith('result-cloud-')&&n.endsWith('.json')).sort()){
  const payload=JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
  if(Array.isArray(payload.results)) results.push(...payload.results);
  if(Array.isArray(payload.monthlyResults)) monthly.push(...payload.monthlyResults);
  if(Array.isArray(payload.failures)) failures.push(...payload.failures);
}

const byKey=new Map();
for(const r of results){
  const key=`${r.symbol}|${r.timeframe}|${r.id}`;
  byKey.set(key,{...r,months:[]});
}
for(const m of monthly){
  if(!m.id)continue;
  const key=`${m.symbol}|${m.timeframe}|${m.id}`;
  const row=byKey.get(key);
  if(row) row.months.push(m);
}
const rows=[...byKey.values()].map(r=>{
  r.months.sort((a,b)=>String(a.month).localeCompare(String(b.month)));
  const eligible=r.months.length;
  const pass=r.months.filter(m=>m.pass).length;
  const positive=r.months.filter(m=>Number(m.net)>0).length;
  const stressPositive=r.months.filter(m=>Number(m.net15)>0).length;
  return {...r,eligibleMonths:eligible,passMonths:pass,positiveMonths:positive,stressPositiveMonths:stressPositive};
});
rows.sort((a,b)=>
  Number(b.passMonths)-Number(a.passMonths)
  || Number(b.stressPositiveMonths)-Number(a.stressPositiveMonths)
  || Number(b.pf??-Infinity)-Number(a.pf??-Infinity)
  || Number(b.net15??-Infinity)-Number(a.net15??-Infinity)
  || Number(a.dd??Infinity)-Number(b.dd??Infinity)
);

const full12=rows.filter(r=>r.eligibleMonths>=12);
const top=full12.filter(r=>r.passMonths>=10);
const cols=['symbol','timeframe','id','passMonths','eligibleMonths','positiveMonths','stressPositiveMonths','n','wr','pf','net','net15','net6','dd','exp','coverage','historyDays','firstBar','lastBar'];
const csv=[cols.join(',')];
for(const r of top) csv.push(cols.map(c=>esc(r[c])).join(','));
fs.writeFileSync(path.join(root,'range48-cloud-top-12m.csv'),csv.join('\n')+'\n','utf8');

const summary={
  schemaVersion:1,
  strategy:'swp_range48_reclaim',
  timeframe:'15m',
  totalResults:rows.length,
  failures:failures.length,
  full12MonthSymbols:full12.length,
  pass12of12:full12.filter(r=>r.passMonths===12).length,
  pass11of12:full12.filter(r=>r.passMonths===11).length,
  pass10of12:full12.filter(r=>r.passMonths===10).length,
  topCandidates:top.slice(0,250),
  failureSample:failures.slice(0,100)
};
fs.writeFileSync(path.join(root,'range48-cloud-summary.json'),JSON.stringify(summary,null,2)+'\n','utf8');
console.log(JSON.stringify({
  totalResults:summary.totalResults,
  failures:summary.failures,
  full12MonthSymbols:summary.full12MonthSymbols,
  pass12of12:summary.pass12of12,
  pass11of12:summary.pass11of12,
  pass10of12:summary.pass10of12,
  top:summary.topCandidates.slice(0,20).map(x=>({symbol:x.symbol,passMonths:x.passMonths,pf:x.pf,net:x.net,dd:x.dd,n:x.n}))
},null,2));
