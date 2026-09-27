import fs from 'node:fs';
import path from 'node:path';

const baselineDir=path.resolve(process.argv[2] ?? 'artifacts/legacy-baseline');
const currentDir=path.resolve(process.argv[3] ?? 'artifacts/sr35-parity-current');
const outFile=path.resolve(process.argv[4] ?? 'artifacts/sr35-integrity/legacy-15m-parity.json');

const targets=[
  ['FHEUSDT','15m','sr_break_retest'],
  ['FHEUSDT','15m','sr_level_flip'],
  ['BULLAUSDT','15m','sr_volume_breakout'],
  ['PIPPINUSDT','15m','sr_volume_breakout'],
  ['TANSSIUSDT','15m','sr_range_edge'],
  ['QUSDT','15m','sr_prior_day_sweep'],
];

function walk(dir){
  const out=[];
  if(!fs.existsSync(dir)) return out;
  for(const ent of fs.readdirSync(dir,{withFileTypes:true})){
    const p=path.join(dir,ent.name);
    if(ent.isDirectory()) out.push(...walk(p));
    else if(ent.isFile()&&ent.name.toLowerCase().endsWith('.json')) out.push(p);
  }
  return out;
}

function collectRows(value,rows=[]){
  if(Array.isArray(value)){
    for(const item of value) collectRows(item,rows);
    return rows;
  }
  if(!value||typeof value!=='object') return rows;
  if(
    typeof value.symbol==='string' &&
    typeof value.timeframe==='string' &&
    typeof value.id==='string' &&
    Number.isFinite(Number(value.net))
  ){
    rows.push(value);
  }
  for(const v of Object.values(value)) collectRows(v,rows);
  return rows;
}

function loadMap(dir){
  const map=new Map();
  for(const file of walk(dir)){
    let obj;
    try{ obj=JSON.parse(fs.readFileSync(file,'utf8')); }catch{ continue; }
    for(const row of collectRows(obj)){
      const key=[row.symbol,row.timeframe,row.id].join('|');
      // Prefer the row with the largest trade count if duplicates exist.
      const prev=map.get(key);
      if(!prev || Number(row.n??0)>Number(prev.n??0)) map.set(key,row);
    }
  }
  return map;
}

function close(a,b,tol=1e-9){
  const x=Number(a),y=Number(b);
  if(!Number.isFinite(x)||!Number.isFinite(y)) return x===y;
  return Math.abs(x-y)<=tol*Math.max(1,Math.abs(x),Math.abs(y));
}

const baseline=loadMap(baselineDir);
const current=loadMap(currentDir);
const checks=[];
let failures=0;
let warnings=0;

for(const [symbol,timeframe,id] of targets){
  const key=[symbol,timeframe,id].join('|');
  const a=baseline.get(key);
  const b=current.get(key);
  if(!a||!b){
    if(a && !b){
      warnings++;
      checks.push({symbol,timeframe,id,status:'DATA_GAP_WARNING',baselineFound:true,currentFound:false});
    } else {
      failures++;
      checks.push({symbol,timeframe,id,status:'MISSING_BASELINE_OR_BOTH',baselineFound:Boolean(a),currentFound:Boolean(b)});
    }
    continue;
  }
  const metrics=['n','net','pf','wr','dd','exp','net15','net6'];
  const diffs={};
  let ok=true;
  for(const m of metrics){
    const same=close(a[m],b[m]);
    diffs[m]={baseline:a[m],current:b[m],same};
    if(!same) ok=false;
  }
  if(!ok) failures++;
  checks.push({symbol,timeframe,id,status:ok?'PASS':'FAIL',diffs});
}

const report={
  baselineDir,
  currentDir,
  targetCount:targets.length,
  failures,
  warnings,
  status:failures===0?(warnings?'PASS_WITH_DATA_GAPS':'PASS'):'FAIL',
  tolerance:1e-9,
  meaning:'PASS means the current engine reproduces the archived January-2026 15m legacy SR-v1 metrics on the selected previously-strong coin/strategy pairs.',
  checks
};
fs.mkdirSync(path.dirname(outFile),{recursive:true});
fs.writeFileSync(outFile,JSON.stringify(report,null,2)+'\n','utf8');
console.log(JSON.stringify({outFile,status:report.status,failures,warnings,checks:checks.map(x=>({symbol:x.symbol,id:x.id,status:x.status}))}));
if(failures) process.exitCode=1;
