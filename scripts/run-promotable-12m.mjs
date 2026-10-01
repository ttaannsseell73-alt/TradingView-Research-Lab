import fs from 'node:fs';
import path from 'node:path';
import { evaluateStrategies } from '../research/strategy_engine_v2.mjs';

const base=path.resolve(process.argv[2]??'research/full-reset-20261001');
const source=JSON.parse(fs.readFileSync(path.join(base,'promotable_current.json'),'utf8')).rows;
const cache=path.join(base,'cache-12m');
const START=Date.parse('2025-10-01T00:00:00Z');
const END=Date.parse('2026-10-01T00:00:00Z');
const MONTHS=Array.from({length:12},(_,i)=>{
  const d=new Date(Date.UTC(2025,9+i,1));
  const n=new Date(Date.UTC(2025,10+i,1));
  return {key:d.toISOString().slice(0,7),start:d.getTime(),end:n.getTime()};
});
const LAST9=MONTHS.slice(-9).map(x=>x.key);
const TF_MIN={ '1m':50,'5m':30,'15m':25,'1h':20,'4h':10 };

function parseCsv(file){
  const raw=fs.readFileSync(file,'utf8').trim();
  if(!raw)return[];
  return raw.split(/\r?\n/u).slice(1).map(line=>{
    const [t,o,h,l,c,v]=line.split(',').map(Number); return {t,o,h,l,c,v};
  }).filter(b=>[b.t,b.o,b.h,b.l,b.c,b.v].every(Number.isFinite));
}
function compound(xs,key){return xs.reduce((e,x)=>e*Math.max(1e-9,1+Number(x[key]??0)),1)-1;}
const out=[]; const failures=[];
for(let i=0;i<source.length;i++){
  const s=source[i]; const file=path.join(cache,`${s.symbol}-${s.timeframe}.csv`);
  try{
    if(!fs.existsSync(file)) throw new Error('MISSING_CACHE');
    const candles=parseCsv(file).filter(b=>b.t>=START&&b.t<END);
    const full=evaluateStrategies(candles,{cost:0.0014,stressCost:0.0015,lowCost:0.0006,
      minTrades:TF_MIN[s.timeframe]??20,start:START,end:END,strategyIds:[s.id]})[0];
    if(!full) throw new Error('STRATEGY_NOT_FOUND');
    const monthly=[];
    for(const m of MONTHS){
      const c=candles.filter(b=>b.t>=m.start&&b.t<m.end);
      const expected=Math.floor((m.end-m.start)/({'1m':60000,'5m':300000,'15m':900000,'1h':3600000,'4h':14400000}[s.timeframe]));
      const coverage=expected?c.length/expected:0;
      if(coverage<0.98){monthly.push({month:m.key,coverage,pass:false,status:'PARTIAL_COVERAGE'});continue;}
      const r=evaluateStrategies(c,{cost:0.0014,stressCost:0.0015,lowCost:0.0006,minTrades:5,start:m.start,end:m.end,strategyIds:[s.id]})[0];
      monthly.push({month:m.key,coverage,...r});
    }
    const eligible12=monthly.filter(x=>x.coverage>=0.98).length;
    const pass12=monthly.filter(x=>x.coverage>=0.98&&x.pass).length;
    const m9=monthly.filter(x=>LAST9.includes(x.month));
    const eligible9=m9.filter(x=>x.coverage>=0.98).length;
    const pass9=m9.filter(x=>x.coverage>=0.98&&x.pass).length;
    out.push({...s,full12:full,eligible9,pass9,eligible12,pass12,
      net9:compound(m9,'net'),stressNet9:compound(m9,'net15'),
      net12:compound(monthly,'net'),stressNet12:compound(monthly,'net15'),monthly});
  }catch(e){failures.push({...s,error:String(e?.message??e)});}
  if((i+1)%10===0||i+1===source.length)console.log(JSON.stringify({progress:`${i+1}/${source.length}`,failures:failures.length}));
}
out.sort((a,b)=>b.pass12-a.pass12||b.pass9-a.pass9||Number(b.stressNet12)-Number(a.stressNet12)||Number(a.full12.dd)-Number(b.full12.dd));
fs.writeFileSync(path.join(base,'PROMOTABLE_12M.json'),JSON.stringify({count:out.length,failures,rows:out},null,2)+'\n');
const cols=['symbol','timeframe','id','family','eligible9','pass9','eligible12','pass12','stressNet9','stressNet12','pf12','dd12','trades12','quoteVolume24h','spreadBps','openInterestNotional'];
const esc=v=>{const z=v==null?'':String(v);return /[",\r\n]/u.test(z)?'"'+z.replaceAll('"','""')+'"':z;};
const lines=[cols.join(',')];
for(const r of out){
 const vals=[r.symbol,r.timeframe,r.id,r.family,r.eligible9,r.pass9,r.eligible12,r.pass12,r.stressNet9,r.stressNet12,r.full12.pf,r.full12.dd,r.full12.n,r.quoteVolume24h,r.spreadBps,r.openInterestNotional];
 lines.push(vals.map(esc).join(','));
}
fs.writeFileSync(path.join(base,'PROMOTABLE_12M.csv'),lines.join('\n')+'\n');
const summary={
  count:out.length,failures:failures.length,
  pass9of9:out.filter(x=>x.eligible9===9&&x.pass9===9).length,
  pass12of12:out.filter(x=>x.eligible12===12&&x.pass12===12).length,
  passAtLeast11of12:out.filter(x=>x.eligible12===12&&x.pass12>=11).length,
  top:out.slice(0,30).map(x=>({symbol:x.symbol,timeframe:x.timeframe,id:x.id,family:x.family,pass9:x.pass9,pass12:x.pass12,stressNet12:x.stressNet12,pf:x.full12.pf,dd:x.full12.dd,trades:x.full12.n}))
};
fs.writeFileSync(path.join(base,'PROMOTABLE_12M_SUMMARY.json'),JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary));
