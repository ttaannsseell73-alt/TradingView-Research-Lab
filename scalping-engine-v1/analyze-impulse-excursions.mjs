import fs from 'node:fs';
import path from 'node:path';
import { STRATEGIES } from '../research/strategy_engine_v2.mjs';

const ROOT=path.resolve('C:/Users/TANSEL/Desktop/NightResearch-20261001/scalping-engine-v1');
const CACHE=path.resolve(ROOT,'..','research','full-reset-20261001','cache-12m');
const registry=JSON.parse(fs.readFileSync(path.join(ROOT,'SCALP_REGISTRY_V1.json'),'utf8'));
const map=new Map(STRATEGIES.map(s=>[s.id,s]));
const SPLIT=Date.parse('2026-04-01T00:00:00Z');

function readCsv(file){
 const z=fs.readFileSync(file,'utf8').trim().split(/\r?\n/u);
 return z.slice(1).map(x=>{const a=x.split(',').map(Number);return {t:a[0],o:a[1],h:a[2],l:a[3],c:a[4],v:a[5]};});
}
function direction(s){return Number(s.longPF6)>=Number(s.shortPF6)?1:-1;}
function q(xs,p){if(!xs.length)return null;const a=[...xs].sort((x,y)=>x-y),i=(a.length-1)*p,l=Math.floor(i),h=Math.ceil(i);return l===h?a[l]:a[l]+(a[h]-a[l])*(i-l);}

function naturalTrades(c,raw,mode,dir){
 const trades=[];let pos=false,ep=0,et=0,ei=-1,armed=true,prev=0;
 for(let i=0;i<raw.length-1;i++){
   const x=raw[i];
   if(mode==='TARGET_POSITION'){
     const state=[-1,0,1].includes(x)?x:0;
     const enter=armed&&state===dir&&prev!==dir;
     const exit=pos&&state!==dir&&prev===dir;
     if(enter){pos=true;armed=false;ep=c[i+1].o;et=c[i+1].t;ei=i+1;}
     else if(exit){
       const xi=i+1,xp=c[xi].o,last=Math.max(ei,xi-1);
       finish(xi,xp,last);
       if(state!==dir)armed=true;
     }
     if(!pos&&state!==dir)armed=true;
     prev=state;
   }else{
     if(!pos&&armed&&x===dir){pos=true;armed=false;ep=c[i+1].o;et=c[i+1].t;ei=i+1;}
     else if(pos&&x===-dir){
       const xi=i+1,xp=c[xi].o,last=Math.max(ei,xi-1);finish(xi,xp,last);armed=true;
     }else if(!pos&&x===-dir)armed=true;
   }
 }
 if(pos&&c.length)finish(c.length-1,c[c.length-1].c,c.length-1);
 return trades;

 function finish(xi,xp,last){
   let mfe=0,mae=0,mfeBar=0,maeBar=0;
   for(let k=ei;k<=last;k++){
     const fav=dir===1?c[k].h/ep-1:ep/c[k].l-1;
     const adv=dir===1?1-c[k].l/ep:c[k].h/ep-1;
     if(fav>mfe){mfe=fav;mfeBar=k-ei+1;}
     if(adv>mae){mae=adv;maeBar=k-ei+1;}
   }
   const gross=dir===1?xp/ep-1:ep/xp-1;
   trades.push({entryTime:et,exitTime:c[xi].t,gross,mfe,mae,mfeBar,maeBar,holdingBars:last-ei+1});
   pos=false;
 }
}
function summarize(ts){
 const win=ts.filter(t=>t.gross>0),loss=ts.filter(t=>t.gross<=0);
 const pack=a=>({n:a.length,
   grossMed:q(a.map(t=>t.gross),.5),mfe25:q(a.map(t=>t.mfe),.25),mfe50:q(a.map(t=>t.mfe),.5),mfe75:q(a.map(t=>t.mfe),.75),
   mae50:q(a.map(t=>t.mae),.5),mae75:q(a.map(t=>t.mae),.75),mae90:q(a.map(t=>t.mae),.90),mae95:q(a.map(t=>t.mae),.95),
   hold50:q(a.map(t=>t.holdingBars),.5),hold75:q(a.map(t=>t.holdingBars),.75),
   tMfe50:q(a.map(t=>t.mfeBar),.5),tMfe75:q(a.map(t=>t.mfeBar),.75)});
 return {all:pack(ts),winners:pack(win),losers:pack(loss)};
}

const rows=[];
for(const s of registry.setups){
 const file=path.join(CACHE,s.symbol+'-'+s.timeframe+'.csv');
 if(!fs.existsSync(file))continue;
 const c=readCsv(file),st=map.get(s.strategyId); if(!st)continue;
 const d=direction(s),raw=st.signal(c),tr=naturalTrades(c,raw,st.mode||'REVERSAL',d);
 const cal=tr.filter(t=>t.entryTime<SPLIT),val=tr.filter(t=>t.entryTime>=SPLIT);
 rows.push({symbol:s.symbol,timeframe:s.timeframe,strategyId:s.strategyId,family:s.family,direction:d===1?'LONG':'SHORT',calibration:summarize(cal),validation:summarize(val),trades:tr});
}
fs.writeFileSync(path.join(ROOT,'IMPULSE_EXCURSIONS.json'),JSON.stringify({schemaVersion:1,split:new Date(SPLIT).toISOString(),rows},null,2)+'\n');
console.log(JSON.stringify({setups:rows.length,calTrades:rows.reduce((n,r)=>n+r.calibration.all.n,0),valTrades:rows.reduce((n,r)=>n+r.validation.all.n,0)}));
