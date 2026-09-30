import fs from 'node:fs';
import path from 'node:path';
import { FIB_EW_STRATEGIES, FIB_EW_STRATEGY_IDS } from '../research/fib_elliott_strategies.mjs';
import { evaluateStrategies } from '../research/strategy_engine_v2.mjs';

function parseCsv(file){
  const raw=fs.readFileSync(file,'utf8').trim();
  if(!raw) return [];
  return raw.split(/\r?\n/).slice(1).map(line=>{
    const [t,o,h,l,c,v]=line.split(',').map(Number);
    return {t,o,h,l,c,v};
  }).filter(b=>[b.t,b.o,b.h,b.l,b.c,b.v].every(Number.isFinite));
}

const root=path.resolve(process.env.RESEARCH_CSV_DIR);
const outDir=path.resolve(process.env.AUDIT_OUT_DIR ?? 'artifacts/fib-ew-integrity');
fs.mkdirSync(outDir,{recursive:true});
const start=Date.parse(process.env.AUDIT_START ?? '2025-09-20T00:00:00Z');
const end=Date.parse(process.env.AUDIT_END ?? '2026-09-20T00:00:00Z');
const byId=new Map(FIB_EW_STRATEGIES.map(s=>[s.id,s]));
const causality=[];
let failures=0,warnings=0;

for(const symbol of ['BTCUSDT','ETHUSDT']){
  for(const tf of ['5m','15m','1h','4h']){
    const file=path.join(root,symbol+'-'+tf+'.csv');
    if(!fs.existsSync(file)){ warnings++; causality.push({symbol,timeframe:tf,status:'MISSING_CSV'}); continue; }
    const candles=parseCsv(file).filter(b=>b.t>=start&&b.t<end);
    if(candles.length<300){ warnings++; causality.push({symbol,timeframe:tf,status:'TOO_SHORT'}); continue; }
    for(const id of FIB_EW_STRATEGY_IDS){
      const s=byId.get(id);
      const full=s.signal(candles);
      let mismatch=null;
      for(const frac of [0.20,0.40,0.60,0.80,0.95]){
        const cut=Math.max(100,Math.min(candles.length-1,Math.floor(candles.length*frac)));
        const prefix=s.signal(candles.slice(0,cut+1));
        for(let i=0;i<prefix.length;i++) if(Number(prefix[i]??0)!==Number(full[i]??0)){ mismatch={cut,index:i,time:candles[i]?.t??null}; break; }
        if(mismatch) break;
      }
      if(mismatch) failures++;
      causality.push({symbol,timeframe:tf,id,status:mismatch?'FAIL':'PASS',mismatch});
    }
  }
}

const deterministic=[];
for(const symbol of ['BTCUSDT','ETHUSDT']){
  const tf='15m',file=path.join(root,symbol+'-'+tf+'.csv');
  if(!fs.existsSync(file)) continue;
  const candles=parseCsv(file).filter(b=>b.t>=start&&b.t<end);
  const opts={start,end,minTrades:1,strategyIds:FIB_EW_STRATEGY_IDS};
  const a=evaluateStrategies(candles,opts);
  const b=evaluateStrategies(candles,opts);
  const ok=JSON.stringify(a)===JSON.stringify(b);
  if(!ok) failures++;
  deterministic.push({symbol,timeframe:tf,status:ok?'PASS':'FAIL'});
}

const report={
  schemaVersion:1,
  audit:'FIB/EW causal integrity',
  strategyCount:FIB_EW_STRATEGY_IDS.length,
  executionModel:'closed-bar signal -> next candle open; TARGET_POSITION exits after fixed 12-bar horizon unless opposite setup arrives',
  pivotModel:'3-left/3-right pivot becomes visible only at confirmation bar; no retroactive signal writes',
  failures,warnings,deterministic,causality,
  status:failures?'FAIL':warnings?'PASS_WITH_DATA_GAPS':'PASS'
};
fs.writeFileSync(path.join(outDir,'fib-ew-integrity.json'),JSON.stringify(report,null,2)+'\n','utf8');
console.log(JSON.stringify(report));
if(failures) process.exitCode=1;
