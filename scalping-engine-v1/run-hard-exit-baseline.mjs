import fs from 'node:fs';
import path from 'node:path';
import { STRATEGIES } from '../research/strategy_engine_v2.mjs';

const root=path.resolve('C:/Users/TANSEL/Desktop/NightResearch-20261001/scalping-engine-v1');
const registry=JSON.parse(fs.readFileSync(path.join(root,'SCALP_REGISTRY_V1.json'),'utf8'));
const rr=path.resolve(root,'..','research','full-reset-20261001');
const map=new Map(STRATEGIES.map(s=>[s.id,s]));
const LEVS=[3,5,10], STRESS=0.0015, MAX_HOLD=8;

function csv(file){const z=fs.readFileSync(file,'utf8').trim().split(/\r?\n/u);return z.slice(1).map(x=>{const a=x.split(',').map(Number);return {t:a[0],o:a[1],h:a[2],l:a[3],c:a[4],v:a[5]};});}
function dir(s){return Number(s.longPF6)>=Number(s.shortPF6)?1:-1;}

function tradesFor(c,raw,mode,d,L){
 const move=.10/L, trades=[]; let i=0;
 while(i<raw.length-1){
   let enter=false;
   if(mode==='TARGET_POSITION')enter=raw[i]===d;
   else enter=raw[i]===d;
   if(!enter){i++;continue;}
   const ei=i+1, ep=c[ei].o, et=c[ei].t, stop=d===1?ep*(1-move):ep*(1+move), target=d===1?ep*(1+move):ep*(1-move);
   let exited=false, exitIndex=ei, exitPrice=ep, reason='TIME';
   for(let j=ei;j<Math.min(c.length,ei+MAX_HOLD);j++){
     if(j>ei){
       const sig=raw[j-1];
       const opp=mode==='TARGET_POSITION'?(sig!==d):(sig===-d);
       if(opp){exitIndex=j;exitPrice=c[j].o;reason='OPPOSITE';exited=true;break;}
     }
     if(d===1){
       const hitS=c[j].l<=stop, hitT=c[j].h>=target;
       if(hitS&&hitT){exitIndex=j;exitPrice=stop;reason='STOP_SAME_BAR';exited=true;break;}
       if(hitS){exitIndex=j;exitPrice=stop;reason='STOP';exited=true;break;}
       if(hitT){exitIndex=j;exitPrice=target;reason='TARGET';exited=true;break;}
     }else{
       const hitS=c[j].h>=stop, hitT=c[j].l<=target;
       if(hitS&&hitT){exitIndex=j;exitPrice=stop;reason='STOP_SAME_BAR';exited=true;break;}
       if(hitS){exitIndex=j;exitPrice=stop;reason='STOP';exited=true;break;}
       if(hitT){exitIndex=j;exitPrice=target;reason='TARGET';exited=true;break;}
     }
   }
   if(!exited){exitIndex=Math.min(c.length-1,ei+MAX_HOLD-1);exitPrice=c[exitIndex].c;reason='TIME';}
   const gross=d===1?exitPrice/ep-1:ep/exitPrice-1;
   trades.push({entryTime:et,exitTime:c[exitIndex].t,gross,reason,holdingBars:exitIndex-ei+1});
   i=Math.max(i+1,exitIndex);
 }
 return trades;
}
function stats(trades,L){
 let eq=1,peak=1,dd=0,gp=0,gl=0,w=0; const months={},reasons={};
 for(const t of trades){
  const r=L*(t.gross-STRESS); reasons[t.reason]=(reasons[t.reason]||0)+1;
  if(r>0){w++;gp+=r}else if(r<0)gl+=r;
  eq=Math.max(0,eq*(1+r)); peak=Math.max(peak,eq); dd=Math.max(dd,peak?1-eq/peak:1);
  const m=new Date(t.exitTime).toISOString().slice(0,7); if(!months[m])months[m]={n:0,eq:1,net:0};
  months[m].n++; months[m].eq=Math.max(0,months[m].eq*(1+r)); months[m].net=months[m].eq-1;
 }
 return {n:trades.length,winRate:trades.length?w/trades.length:0,net:eq-1,maxDD:dd,pf:gl<0?gp/Math.abs(gl):(gp>0?999:0),months,reasons};
}
function analyze(s,cache,L){
 const f=path.join(cache,s.symbol+'-'+s.timeframe+'.csv'); if(!fs.existsSync(f))return {error:'MISSING_CACHE'};
 const c=csv(f),st=map.get(s.strategyId); if(!st)return {error:'NO_STRATEGY'};
 const raw=st.signal(c),d=dir(s),t=tradesFor(c,raw,st.mode||'REVERSAL',d,L),x=stats(t,L);
 const mm=Object.keys(x.months).sort(),last6=mm.slice(-6),last3=last6.slice(-3);
 return {...x,direction:d===1?'LONG':'SHORT',movePct:.10/L,maxHoldBars:MAX_HOLD,positive3:last3.filter(m=>x.months[m].net>0).length,positive6:last6.filter(m=>x.months[m].net>0).length};
}

const rows=[];
for(const s of registry.setups){
 for(const L of LEVS){
  rows.push({symbol:s.symbol,timeframe:s.timeframe,strategyId:s.strategyId,family:s.family,leverage:L,direction:dir(s)===1?'LONG':'SHORT',
   six:analyze(s,path.join(rr,'cache-6m'),L),twelve:analyze(s,path.join(rr,'cache-12m'),L)});
 }
}
fs.writeFileSync(path.join(root,'ONEWAY_HARD_EXIT_BASELINE.json'),JSON.stringify({schemaVersion:1,rule:'one-way; target/stop at 10% margin move; opposite signal exit; max 8 bars; no reversal; conservative stop if TP+SL same bar',stressCost:STRESS,rows},null,2)+'\n');
const summary={};
for(const L of LEVS){
 const z=rows.filter(r=>r.leverage===L);
 summary['x'+L]={setups:z.length,positive6:z.filter(r=>r.six.net>0).length,positive12:z.filter(r=>r.twelve.net>0).length,threeOfThree:z.filter(r=>r.six.positive3===3).length,sixOfSix:z.filter(r=>r.six.positive6===6).length,ddUnder30_12:z.filter(r=>r.twelve.maxDD<.30).length};
}
fs.writeFileSync(path.join(root,'ONEWAY_HARD_EXIT_BASELINE_SUMMARY.json'),JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary));
