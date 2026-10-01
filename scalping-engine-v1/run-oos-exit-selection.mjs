import fs from 'node:fs';
import path from 'node:path';
import { STRATEGIES } from '../research/strategy_engine_v2.mjs';

const ROOT=path.resolve('C:/Users/TANSEL/Desktop/NightResearch-20261001/scalping-engine-v1');
const CACHE=path.resolve(ROOT,'..','research','full-reset-20261001','cache-12m');
const registry=JSON.parse(fs.readFileSync(path.join(ROOT,'SCALP_REGISTRY_V1.json'),'utf8'));
const map=new Map(STRATEGIES.map(s=>[s.id,s]));
const COST=.0015,LEVS=[3,5,10],RISKS=[.005,.01];
const POLICIES=[
 {id:'M5_S3',tpMargin:.05,slMargin:.03},
 {id:'M7_5_S5',tpMargin:.075,slMargin:.05},
 {id:'M10_S5',tpMargin:.10,slMargin:.05}
];
const HOURS=[2,4];
const CAL_START=Date.parse('2025-10-01T00:00:00Z'),SPLIT=Date.parse('2026-04-01T00:00:00Z'),END=Date.parse('2026-10-01T00:00:00Z');
const CAL_MONTHS=['2025-10','2025-11','2025-12','2026-01','2026-02','2026-03'];
const VAL_MONTHS=['2026-04','2026-05','2026-06','2026-07','2026-08','2026-09'];

function readCsv(file){const z=fs.readFileSync(file,'utf8').trim().split(/\r?\n/u);return z.slice(1).map(x=>{const a=x.split(',').map(Number);return {t:a[0],o:a[1],h:a[2],l:a[3],c:a[4],v:a[5]};});}
function dir(s){return Number(s.longPF6)>=Number(s.shortPF6)?1:-1;}
function tfMs(tf){return tf==='1m'?60000:tf==='5m'?300000:900000;}

function tradesWindow(c,raw,mode,d,L,p,hours,tf,start,end){
 const tpMove=p.tpMargin/L,slMove=p.slMargin/L,maxBars=Math.max(1,Math.floor(hours*3600000/tfMs(tf)));
 const out=[];let armed=true,prev=0,i=0;
 while(i<raw.length-1){
   const x=raw[i];let enter=false;
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
   const ei=i+1,et=c[ei].t;
   if(et<start){i++;continue;}
   if(et>=end)break;
   const ep=c[ei].o,tp=d===1?ep*(1+tpMove):ep*(1-tpMove),sl=d===1?ep*(1-slMove):ep*(1+slMove);
   let xi=ei,xp=ep,reason='TIME',done=false;
   for(let j=ei;j<Math.min(c.length,ei+maxBars);j++){
     if(c[j].t>=end)break;
     if(j>ei){
       const sig=raw[j-1],opp=mode==='TARGET_POSITION'?sig!==d:sig===-d;
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
   if(!done){
     xi=Math.min(c.length-1,ei+maxBars-1);
     while(xi>ei&&c[xi].t>=end)xi--;
     xp=c[xi].c;reason='TIME';
   }
   const gross=d===1?xp/ep-1:ep/xp-1;
   out.push({entryTime:et,exitTime:c[xi].t,gross,reason});
   i=Math.max(i+1,xi);
 }
 return out;
}

function stats(ts,L,p,risk,months){
 const marginFraction=risk/p.slMargin,exposure=marginFraction*L;
 let eq=1,peak=1,dd=0,gp=0,gl=0,w=0;const mm=Object.fromEntries(months.map(m=>[m,{n:0,eq:1,net:0}]));
 for(const t of ts){
   const er=exposure*(t.gross-COST);
   if(er>0){w++;gp+=er}else if(er<0)gl+=er;
   eq=Math.max(0,eq*(1+er));peak=Math.max(peak,eq);dd=Math.max(dd,peak?1-eq/peak:1);
   const m=new Date(t.exitTime).toISOString().slice(0,7);
   if(mm[m]){mm[m].n++;mm[m].eq=Math.max(0,mm[m].eq*(1+er));mm[m].net=mm[m].eq-1;}
 }
 return {n:ts.length,net:eq-1,maxDD:dd,pf:gl<0?gp/Math.abs(gl):(gp>0?999:0),winRate:ts.length?w/ts.length:0,positiveMonths:months.filter(m=>mm[m].net>0).length,months:mm,marginFraction,effectiveNotional:exposure};
}
function better(a,b){
 if(!b)return true;
 if(a.positiveMonths!==b.positiveMonths)return a.positiveMonths>b.positiveMonths;
 const ap=a.net>0,bp=b.net>0;if(ap!==bp)return ap;
 const af=a.pf>1,bf=b.pf>1;if(af!==bf)return af;
 const ar=a.maxDD>0?a.net/a.maxDD:a.net,br=b.maxDD>0?b.net/b.maxDD:b.net;
 if(ar!==br)return ar>br;
 return a.maxDD<b.maxDD;
}

const rows=[];
for(let si=0;si<registry.setups.length;si++){
 const s=registry.setups[si],file=path.join(CACHE,s.symbol+'-'+s.timeframe+'.csv');if(!fs.existsSync(file))continue;
 const c=readCsv(file),st=map.get(s.strategyId);if(!st)continue;
 const raw=st.signal(c),d=dir(s),mode=st.mode||'REVERSAL';
 for(const L of LEVS)for(const risk of RISKS){
   let best=null;
   for(const p of POLICIES)for(const h of HOURS){
     const tr=tradesWindow(c,raw,mode,d,L,p,h,s.timeframe,CAL_START,SPLIT);
     const x=stats(tr,L,p,risk,CAL_MONTHS);
     if(x.n<20)continue;
     if(better(x,best?.cal))best={policy:p,hours:h,cal:x};
   }
   if(!best)continue;
   const tv=tradesWindow(c,raw,mode,d,L,best.policy,best.hours,s.timeframe,SPLIT,END);
   const val=stats(tv,L,best.policy,risk,VAL_MONTHS);
   rows.push({symbol:s.symbol,timeframe:s.timeframe,strategyId:s.strategyId,family:s.family,direction:d===1?'LONG':'SHORT',leverage:L,risk,selectedPolicy:best.policy.id,selectedHours:best.hours,calibration:best.cal,validation:val});
 }
 if((si+1)%5===0||si+1===registry.setups.length)console.log(JSON.stringify({progress:(si+1)+'/'+registry.setups.length}));
}
fs.writeFileSync(path.join(ROOT,'OOS_EXIT_SELECTION.json'),JSON.stringify({schemaVersion:1,calibration:'2025-10..2026-03',validation:'2026-04..2026-09',selection:'maximize positive months, then positive net/PF, net-to-DD, DD',rows},null,2)+'\n');

const summary={};
for(const L of LEVS)for(const risk of RISKS){
 const z=rows.filter(r=>r.leverage===L&&r.risk===risk),k='x'+L+'_r'+String(risk*100).replace('.','_');
 summary[k]={setups:z.length,cal6of6:z.filter(r=>r.calibration.positiveMonths===6).length,val3of3:z.filter(r=>['2026-07','2026-08','2026-09'].every(m=>r.validation.months[m].net>0)).length,val6of6:z.filter(r=>r.validation.positiveMonths===6).length,valPositive:z.filter(r=>r.validation.net>0).length,valDDunder10:z.filter(r=>r.validation.maxDD<.10).length,valDDunder20:z.filter(r=>r.validation.maxDD<.20).length};
}
fs.writeFileSync(path.join(ROOT,'OOS_EXIT_SELECTION_SUMMARY.json'),JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary));
