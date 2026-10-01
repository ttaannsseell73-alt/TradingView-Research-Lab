import fs from 'node:fs';
import path from 'node:path';
import { STRATEGIES } from '../research/strategy_engine_v2.mjs';

const ROOT=path.resolve('C:/Users/TANSEL/Desktop/NightResearch-20261001/scalping-engine-v1');
const RR=path.resolve(ROOT,'..','research','full-reset-20261001');
const registry=JSON.parse(fs.readFileSync(path.join(ROOT,'SCALP_REGISTRY_V1.json'),'utf8'));
const map=new Map(STRATEGIES.map(s=>[s.id,s]));
const STRESS=0.0015, LEVS=[3,5,10];
const POLICIES=[
 {id:'M5_S3',tpMargin:.05,slMargin:.03},
 {id:'M7_5_S5',tpMargin:.075,slMargin:.05},
 {id:'M10_S5',tpMargin:.10,slMargin:.05}
];
const HORIZONS=[1,2,4];

function readCsv(file){
 const z=fs.readFileSync(file,'utf8').trim().split(/\r?\n/u);
 return z.slice(1).map(x=>{const a=x.split(',').map(Number);return {t:a[0],o:a[1],h:a[2],l:a[3],c:a[4],v:a[5]};});
}
function dir(s){return Number(s.longPF6)>=Number(s.shortPF6)?1:-1;}
function tfMs(tf){return tf==='1m'?60000:tf==='5m'?300000:900000;}

function quickTrades(c,raw,mode,d,L,p,hours,tf){
 const tpMove=p.tpMargin/L,slMove=p.slMargin/L,maxBars=Math.max(1,Math.floor(hours*3600000/tfMs(tf)));
 const out=[]; let armed=true,prev=0,i=0;
 while(i<raw.length-1){
   const x=raw[i]; let enter=false;
   if(mode==='TARGET_POSITION'){
     const state=[-1,0,1].includes(x)?x:0;
     enter=armed&&state===d&&prev!==d;
     if(!armed&&state!==d)armed=true;
     prev=state;
   }else{
     enter=armed&&x===d;
     if(!armed&&x===-d)armed=true;
   }
   if(!enter){i++;continue;}
   armed=false;
   const ei=i+1,ep=c[ei].o,et=c[ei].t;
   const tp=d===1?ep*(1+tpMove):ep*(1-tpMove);
   const sl=d===1?ep*(1-slMove):ep*(1+slMove);
   let xi=ei,xp=ep,reason='TIME',done=false;
   for(let j=ei;j<Math.min(c.length,ei+maxBars);j++){
     if(j>ei){
       const sig=raw[j-1];
       const opp=mode==='TARGET_POSITION'?sig!==d:sig===-d;
       if(opp){xi=j;xp=c[j].o;reason='OPPOSITE';done=true;armed=true;break;}
     }
     if(d===1){
       const hs=c[j].l<=sl,ht=c[j].h>=tp;
       if(hs){xi=j;xp=sl;reason=ht?'STOP_SAME_BAR':'STOP';done=true;break;}
       if(ht){xi=j;xp=tp;reason='TARGET';done=true;break;}
     }else{
       const hs=c[j].h>=sl,ht=c[j].l<=tp;
       if(hs){xi=j;xp=sl;reason=ht?'STOP_SAME_BAR':'STOP';done=true;break;}
       if(ht){xi=j;xp=tp;reason='TARGET';done=true;break;}
     }
   }
   if(!done){xi=Math.min(c.length-1,ei+maxBars-1);xp=c[xi].c;reason='TIME';}
   const gross=d===1?xp/ep-1:ep/xp-1;
   out.push({entryTime:et,exitTime:c[xi].t,gross,reason});
   i=Math.max(i+1,xi);
 }
 return out;
}

function stats(trades,L){
 let eq=1,peak=1,dd=0,gp=0,gl=0,w=0;const months={},reasons={};
 for(const t of trades){
   const r=L*(t.gross-STRESS);
   reasons[t.reason]=(reasons[t.reason]||0)+1;
   if(r>0){w++;gp+=r}else if(r<0)gl+=r;
   eq=Math.max(0,eq*(1+r));peak=Math.max(peak,eq);dd=Math.max(dd,peak?1-eq/peak:1);
   const m=new Date(t.exitTime).toISOString().slice(0,7);
   if(!months[m])months[m]={n:0,eq:1,net:0};
   months[m].n++;months[m].eq=Math.max(0,months[m].eq*(1+r));months[m].net=months[m].eq-1;
 }
 const ks=Object.keys(months).sort(),l6=ks.slice(-6),l3=l6.slice(-3);
 return {n:trades.length,winRate:trades.length?w/trades.length:0,net:eq-1,maxDD:dd,pf:gl<0?gp/Math.abs(gl):(gp>0?999:0),positive3:l3.filter(m=>months[m].net>0).length,positive6:l6.filter(m=>months[m].net>0).length,reasons};
}

function prep(setup,cache){
 const file=path.join(cache,setup.symbol+'-'+setup.timeframe+'.csv');
 if(!fs.existsSync(file))return null;
 const c=readCsv(file),s=map.get(setup.strategyId); if(!s)return null;
 return {c,raw:s.signal(c),mode:s.mode||'REVERSAL'};
}

const rows=[];
for(let idx=0;idx<registry.setups.length;idx++){
 const s=registry.setups[idx],d=dir(s);
 const a6=prep(s,path.join(RR,'cache-6m')),a12=prep(s,path.join(RR,'cache-12m'));
 if(!a6||!a12)continue;
 for(const L of LEVS)for(const p of POLICIES)for(const h of HORIZONS){
   const t6=quickTrades(a6.c,a6.raw,a6.mode,d,L,p,h,s.timeframe);
   const t12=quickTrades(a12.c,a12.raw,a12.mode,d,L,p,h,s.timeframe);
   rows.push({symbol:s.symbol,timeframe:s.timeframe,strategyId:s.strategyId,family:s.family,direction:d===1?'LONG':'SHORT',leverage:L,policy:p.id,hours:h,six:stats(t6,L),twelve:stats(t12,L)});
 }
 if((idx+1)%5===0||idx+1===registry.setups.length)console.log(JSON.stringify({progress:(idx+1)+'/'+registry.setups.length}));
}

fs.writeFileSync(path.join(ROOT,'QUICK_SCALP_GRID.json'),JSON.stringify({schemaVersion:2,stressCost:STRESS,policies:POLICIES,horizonsHours:HORIZONS,rows},null,2)+'\n');
const summary={};
for(const L of LEVS){
 summary['x'+L]={};
 for(const p of POLICIES)for(const h of HORIZONS){
   const z=rows.filter(r=>r.leverage===L&&r.policy===p.id&&r.hours===h);
   summary['x'+L][p.id+'_H'+h]={
     positive6:z.filter(r=>r.six.net>0).length,
     positive12:z.filter(r=>r.twelve.net>0).length,
     threeOfThree:z.filter(r=>r.six.positive3===3).length,
     sixOfSix:z.filter(r=>r.six.positive6===6).length,
     ddUnder30_6:z.filter(r=>r.six.maxDD<.30).length,
     ddUnder30_12:z.filter(r=>r.twelve.maxDD<.30).length
   };
 }
}
fs.writeFileSync(path.join(ROOT,'QUICK_SCALP_GRID_SUMMARY.json'),JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary));
