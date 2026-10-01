import fs from 'node:fs';
import path from 'node:path';
import { STRATEGIES } from '../research/strategy_engine_v2.mjs';

const ROOT=path.resolve('C:/Users/TANSEL/Desktop/NightResearch-20261001/scalping-engine-v1');
const RR=path.resolve(ROOT,'..','research','full-reset-20261001');
const registry=JSON.parse(fs.readFileSync(path.join(ROOT,'SCALP_REGISTRY_V1.json'),'utf8'));
const stratMap=new Map(STRATEGIES.map(s=>[s.id,s]));
const COST=0.0014, STRESS=0.0015, LEVS=[3,5,10];

const PROFILES=[
  {id:'TIGHT',hardAtr:1.00,trailAtr:1.00,activateAtr:0.75,maxHold:{'1m':8,'5m':8,'15m':6}},
  {id:'BALANCED',hardAtr:1.50,trailAtr:1.25,activateAtr:1.00,maxHold:{'1m':12,'5m':10,'15m':8}},
  {id:'LOOSE',hardAtr:2.00,trailAtr:1.50,activateAtr:1.25,maxHold:{'1m':16,'5m':12,'15m':10}}
];

function readCsv(file){
  const z=fs.readFileSync(file,'utf8').trim().split(/\r?\n/u);
  return z.slice(1).map(x=>{const a=x.split(',').map(Number);return {t:a[0],o:a[1],h:a[2],l:a[3],c:a[4],v:a[5]};});
}
function direction(s){return Number(s.longPF6)>=Number(s.shortPF6)?1:-1;}

function atr14(c){
  const tr=Array(c.length).fill(NaN);
  for(let i=0;i<c.length;i++){
    if(i===0) tr[i]=c[i].h-c[i].l;
    else tr[i]=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));
  }
  const out=Array(c.length).fill(NaN); let acc=0;
  for(let i=0;i<tr.length;i++){
    if(i<14){acc+=tr[i]; if(i===13)out[i]=acc/14;}
    else out[i]=(out[i-1]*13+tr[i])/14;
  }
  return out;
}
function recentLow(c,i,n=5){let v=Infinity;for(let k=Math.max(0,i-n);k<i;k++)v=Math.min(v,c[k].l);return v;}
function recentHigh(c,i,n=5){let v=-Infinity;for(let k=Math.max(0,i-n);k<i;k++)v=Math.max(v,c[k].h);return v;}

function oneWayAdaptiveTrades(c,raw,mode,dir,profile){
  const A=atr14(c),trades=[]; let i=20;
  while(i<raw.length-1){
    const sig=raw[i];
    const enter=(mode==='TARGET_POSITION'?sig===dir:sig===dir);
    if(!enter){i++;continue;}
    const ei=i+1, ep=c[ei].o, et=c[ei].t, entryAtr=A[i];
    if(!Number.isFinite(entryAtr)||entryAtr<=0){i++;continue;}
    let stop;
    if(dir===1) stop=Math.max(ep-profile.hardAtr*entryAtr,recentLow(c,ei,5));
    else stop=Math.min(ep+profile.hardAtr*entryAtr,recentHigh(c,ei,5));
    let extreme=ep,activeTrail=false,exitIndex=ei,exitPrice=ep,reason='TIME',done=false;
    const maxHold=profile.maxHold[c[ei]&&c[ei].t?guessTf(c):'15m']??8;
    for(let j=ei;j<Math.min(c.length,ei+maxHold);j++){
      if(j>ei){
        const prior=raw[j-1];
        const opp=mode==='TARGET_POSITION'?(prior!==dir):(prior===-dir);
        if(opp){exitIndex=j;exitPrice=c[j].o;reason='OPPOSITE';done=true;break;}
      }
      if(dir===1){
        if(c[j].l<=stop){exitIndex=j;exitPrice=stop;reason='STOP';done=true;break;}
        extreme=Math.max(extreme,c[j].h);
        if(extreme-ep>=profile.activateAtr*entryAtr)activeTrail=true;
        if(activeTrail){
          const a=Number.isFinite(A[Math.max(0,j-1)])?A[Math.max(0,j-1)]:entryAtr;
          const next=Math.max(ep,extreme-profile.trailAtr*a);
          stop=Math.max(stop,next);
        }
      }else{
        if(c[j].h>=stop){exitIndex=j;exitPrice=stop;reason='STOP';done=true;break;}
        extreme=Math.min(extreme,c[j].l);
        if(ep-extreme>=profile.activateAtr*entryAtr)activeTrail=true;
        if(activeTrail){
          const a=Number.isFinite(A[Math.max(0,j-1)])?A[Math.max(0,j-1)]:entryAtr;
          const next=Math.min(ep,extreme+profile.trailAtr*a);
          stop=Math.min(stop,next);
        }
      }
    }
    if(!done){exitIndex=Math.min(c.length-1,ei+maxHold-1);exitPrice=c[exitIndex].c;reason='TIME';}
    const gross=dir===1?exitPrice/ep-1:ep/exitPrice-1;
    trades.push({entryTime:et,exitTime:c[exitIndex].t,gross,reason,holdingBars:exitIndex-ei+1});
    i=Math.max(i+1,exitIndex);
  }
  return trades;
}
function guessTf(c){
  if(c.length<2)return '15m';
  const d=c[1].t-c[0].t;
  if(d<=60000)return '1m'; if(d<=300000)return '5m'; return '15m';
}
function stats(trades,L,cost){
  let eq=1,peak=1,dd=0,w=0,gp=0,gl=0; const months={},reasons={};
  for(const t of trades){
    const r=L*(t.gross-cost);
    reasons[t.reason]=(reasons[t.reason]||0)+1;
    if(r>0){w++;gp+=r}else if(r<0)gl+=r;
    eq=Math.max(0,eq*(1+r)); peak=Math.max(peak,eq); dd=Math.max(dd,peak?1-eq/peak:1);
    const m=new Date(t.exitTime).toISOString().slice(0,7);
    if(!months[m])months[m]={n:0,eq:1,net:0};
    months[m].n++; months[m].eq=Math.max(0,months[m].eq*(1+r)); months[m].net=months[m].eq-1;
  }
  const keys=Object.keys(months).sort(),last6=keys.slice(-6),last3=last6.slice(-3);
  return {n:trades.length,winRate:trades.length?w/trades.length:0,net:eq-1,maxDD:dd,pf:gl<0?gp/Math.abs(gl):(gp>0?999:0),months,reasons,positive3:last3.filter(m=>months[m].net>0).length,positive6:last6.filter(m=>months[m].net>0).length};
}
function analyze(setup,cache,profile,L){
  const file=path.join(cache,setup.symbol+'-'+setup.timeframe+'.csv');
  if(!fs.existsSync(file))return {error:'MISSING_CACHE'};
  const c=readCsv(file),s=stratMap.get(setup.strategyId); if(!s)return {error:'NO_STRATEGY'};
  const raw=s.signal(c),d=direction(setup),tr=oneWayAdaptiveTrades(c,raw,s.mode||'REVERSAL',d,profile);
  return {direction:d===1?'LONG':'SHORT',profile:profile.id,leverage:L,...stats(tr,L,STRESS)};
}

const rows=[];
for(const setup of registry.setups){
  for(const profile of PROFILES){
    for(const L of LEVS){
      rows.push({
        symbol:setup.symbol,timeframe:setup.timeframe,strategyId:setup.strategyId,family:setup.family,
        direction:direction(setup)===1?'LONG':'SHORT',profile:profile.id,leverage:L,
        six:analyze(setup,path.join(RR,'cache-6m'),profile,L),
        twelve:analyze(setup,path.join(RR,'cache-12m'),profile,L)
      });
    }
  }
}
fs.writeFileSync(path.join(ROOT,'ADAPTIVE_EXIT_GRID.json'),JSON.stringify({schemaVersion:1,profiles:PROFILES,stressCost:STRESS,rows},null,2)+'\n');

const summary={};
for(const profile of PROFILES){
  summary[profile.id]={};
  for(const L of LEVS){
    const z=rows.filter(r=>r.profile===profile.id&&r.leverage===L);
    summary[profile.id]['x'+L]={
      setups:z.length,
      positive6:z.filter(r=>r.six.net>0).length,
      positive12:z.filter(r=>r.twelve.net>0).length,
      threeOfThree:z.filter(r=>r.six.positive3===3).length,
      sixOfSix:z.filter(r=>r.six.positive6===6).length,
      ddUnder30_6:z.filter(r=>r.six.maxDD<.30).length,
      ddUnder30_12:z.filter(r=>r.twelve.maxDD<.30).length
    };
  }
}
fs.writeFileSync(path.join(ROOT,'ADAPTIVE_EXIT_GRID_SUMMARY.json'),JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary));
