import fs from 'node:fs';
import path from 'node:path';
import { STRATEGIES } from '../research/strategy_engine_v2.mjs';

const root=path.resolve('C:/Users/TANSEL/Desktop/NightResearch-20261001/scalping-engine-v1');
const registry=JSON.parse(fs.readFileSync(path.join(root,'SCALP_REGISTRY_V1.json'),'utf8'));
const researchRoot=path.resolve(root,'..','research','full-reset-20261001');
const stratMap=new Map(STRATEGIES.map(s=>[s.id,s]));
const LEVS=[3,5,10], COST=0.0014, STRESS=0.0015;

function readCsv(file){
  const lines=fs.readFileSync(file,'utf8').trim().split(/\r?\n/u);
  return lines.slice(1).map(x=>{const a=x.split(',').map(Number);return {t:a[0],o:a[1],h:a[2],l:a[3],c:a[4],v:a[5]};});
}
function chosenDir(s){return Number(s.longPF6)>=Number(s.shortPF6)?1:-1;}

function oneWayTrades(c,raw,mode,dir){
  const trades=[]; let pos=false,entryPrice=0,entryTime=0,entryIndex=-1;
  function close(px,xt,exitIndex,finalClose){
    if(!pos)return;
    const gross=dir===1?px/entryPrice-1:entryPrice/px-1;
    const last=finalClose?exitIndex:Math.max(entryIndex,exitIndex-1);
    let adverse=0;
    if(dir===1){
      let min=Infinity; for(let k=entryIndex;k<=last;k++)min=Math.min(min,c[k].l);
      adverse=Math.max(0,1-min/entryPrice);
    }else{
      let max=-Infinity; for(let k=entryIndex;k<=last;k++)max=Math.max(max,c[k].h);
      adverse=Math.max(0,max/entryPrice-1);
    }
    trades.push({entryTime,exitTime:xt,entryPrice,exitPrice:px,gross,mae:adverse,holdingBars:last-entryIndex+1});
    pos=false;
  }
  for(let i=0;i<raw.length-1;i++){
    const x=raw[i],px=c[i+1].o,tm=c[i+1].t;
    if(mode==='TARGET_POSITION'){
      const want=[-1,0,1].includes(x)?x:0;
      if(!pos&&want===dir){pos=true;entryPrice=px;entryTime=tm;entryIndex=i+1;}
      else if(pos&&want!==dir)close(px,tm,i+1,false);
    }else{
      if(!pos&&x===dir){pos=true;entryPrice=px;entryTime=tm;entryIndex=i+1;}
      else if(pos&&x===-dir)close(px,tm,i+1,false);
    }
  }
  if(pos&&c.length){const i=c.length-1;close(c[i].c,c[i].t,i,true);}
  return trades;
}

function replay(trades,L,cost){
  let eq=1,peak=1,dd=0,wins=0,gp=0,gl=0,bust=false;
  const months={};
  for(const t of trades){
    const r=L*(t.gross-cost);
    if(r>0){wins++;gp+=r;}else if(r<0)gl+=r;
    if(r<=-1){eq=0;dd=1;bust=true;}
    else if(!bust){eq*=1+r;peak=Math.max(peak,eq);dd=Math.max(dd,1-eq/peak);}
    const m=new Date(t.exitTime).toISOString().slice(0,7);
    if(!months[m])months[m]={n:0,eq:1,net:0};
    months[m].n++;
    if(months[m].eq>0)months[m].eq=Math.max(0,months[m].eq*(1+r));
    months[m].net=months[m].eq-1;
  }
  return {n:trades.length,winRate:trades.length?wins/trades.length:0,net:bust?-1:eq-1,maxDD:dd,pf:gl<0?gp/Math.abs(gl):(gp>0?999:0),bust,months};
}
function q(xs,p){
  if(!xs.length)return 0; const a=[...xs].sort((x,y)=>x-y),i=(a.length-1)*p,lo=Math.floor(i),hi=Math.ceil(i);
  return lo===hi?a[lo]:a[lo]+(a[hi]-a[lo])*(i-lo);
}
function analyze(setup,cacheDir,label){
  const file=path.join(cacheDir,setup.symbol+'-'+setup.timeframe+'.csv');
  if(!fs.existsSync(file))return {label,error:'MISSING_CACHE'};
  const c=readCsv(file),s=stratMap.get(setup.strategyId);
  if(!s)return {label,error:'STRATEGY_NOT_FOUND'};
  const raw=s.signal(c),dir=chosenDir(setup),trades=oneWayTrades(c,raw,s.mode||'REVERSAL',dir),maes=trades.map(t=>t.mae);
  const leverage={};
  for(const L of LEVS){
    const barrier=1/L,breaches=trades.filter(t=>t.mae>=barrier).length;
    leverage['x'+L]={barrierUnderlying:barrier,maeBreaches:breaches,maeBreachRate:trades.length?breaches/trades.length:0,base:replay(trades,L,COST),stress:replay(trades,L,STRESS)};
  }
  return {label,direction:dir===1?'LONG':'SHORT',trades:trades.length,maxMAE:maes.length?Math.max(...maes):0,p95MAE:q(maes,.95),medianMAE:q(maes,.5),avgHoldingBars:trades.length?trades.reduce((a,t)=>a+t.holdingBars,0)/trades.length:0,leverage};
}

const rows=[];
for(let i=0;i<registry.setups.length;i++){
  const s=registry.setups[i];
  rows.push({...s,direction:chosenDir(s)===1?'LONG':'SHORT',replay6m:analyze(s,path.join(researchRoot,'cache-6m'),'6m'),replay12m:analyze(s,path.join(researchRoot,'cache-12m'),'12m')});
  if((i+1)%5===0||i+1===registry.setups.length)console.log(JSON.stringify({progress:(i+1)+'/'+registry.setups.length}));
}
const summary={schemaVersion:1,engine:'SCALPING_ENGINE_V1',mode:'ONE_WAY_ONE_IMPULSE_NO_REVERSAL',cost:COST,stressCost:STRESS,leverage:LEVS,setups:rows.length,directions:{LONG:rows.filter(r=>r.direction==='LONG').length,SHORT:rows.filter(r=>r.direction==='SHORT').length},rows};
fs.writeFileSync(path.join(root,'ONEWAY_LEVERAGE_REPLAY.json'),JSON.stringify(summary,null,2)+'\n','utf8');

const flat=[];
for(const r of rows)for(const L of LEVS){
  const a=r.replay6m.leverage['x'+L],b=r.replay12m.leverage?.['x'+L];
  flat.push({symbol:r.symbol,timeframe:r.timeframe,strategyId:r.strategyId,family:r.family,direction:r.direction,leverage:L,trades6:r.replay6m.trades,maxMAE6:r.replay6m.maxMAE,p95MAE6:r.replay6m.p95MAE,breaches6:a.maeBreaches,breachRate6:a.maeBreachRate,netStress6:a.stress.net,ddStress6:a.stress.maxDD,bust6:a.stress.bust,trades12:r.replay12m.trades,breaches12:b?.maeBreaches,netStress12:b?.stress?.net,ddStress12:b?.stress?.maxDD,bust12:b?.stress?.bust});
}
const cols=Object.keys(flat[0]); const esc=v=>{const s=v==null?'':String(v);return /[",\r\n]/u.test(s)?'"'+s.replaceAll('"','""')+'"':s;};
fs.writeFileSync(path.join(root,'ONEWAY_LEVERAGE_REPLAY.csv'),[cols.join(','),...flat.map(r=>cols.map(k=>esc(r[k])).join(','))].join('\n')+'\n','utf8');
console.log(JSON.stringify({status:'DONE',setups:rows.length,directions:summary.directions}));
