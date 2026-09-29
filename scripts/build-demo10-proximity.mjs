import fs from 'node:fs';
import path from 'node:path';

const boardPath=process.argv[2];
const signalPath=process.argv[3];
const candlesDir=process.argv[4];
const outPath=process.argv[5]??'artifacts/demo10-proximity.json';
if(!boardPath||!signalPath||!candlesDir){
  console.error('Usage: node scripts/build-demo10-proximity.mjs BOARD.json CURRENT_SIGNAL_WATCHLIST.json CANDLES_DIR [OUT.json]');
  process.exit(2);
}

const board=JSON.parse(fs.readFileSync(boardPath,'utf8'));
const watch=JSON.parse(fs.readFileSync(signalPath,'utf8'));
const finite=Number.isFinite;
const clamp=(x,a=0,b=100)=>Math.max(a,Math.min(b,x));
const round=(x,n=6)=>finite(Number(x))?Number(Number(x).toFixed(n)):null;
const pc=(score)=>score>=100?'TETIK/WAIT_CLOSE':score>=80?'COK_YAKIN':score>=60?'YAKIN':score>=30?'ORTA':'UZAK';
const signedPct=(level,price)=>finite(level)&&finite(price)&&price!==0?100*(level-price)/price:null;
const closeness=(dist,scale)=>!finite(dist)||!finite(scale)||scale<=0?0:clamp(1-Math.abs(dist)/scale,0,1);
const rma=(xs,p)=>{
  const out=Array(xs.length).fill(NaN);
  if(xs.length<p) return out;
  let s=0; for(let i=0;i<p;i++) s+=xs[i];
  let q=s/p; out[p-1]=q;
  for(let i=p;i<xs.length;i++){ q=(q*(p-1)+xs[i])/p; out[i]=q; }
  return out;
};
const tr=(c)=>c.map((b,i)=>i?Math.max(b.h-b.l,Math.abs(b.h-c[i-1].c),Math.abs(b.l-c[i-1].c)):b.h-b.l);
const atr=(c,p=14)=>rma(tr(c),p);
const sma=(xs,p)=>{
  const out=Array(xs.length).fill(NaN); let s=0;
  for(let i=0;i<xs.length;i++){s+=xs[i];if(i>=p)s-=xs[i-p];if(i>=p-1)out[i]=s/p;}
  return out;
};
function previousRange(c,period){
  if(c.length<period) return {high:NaN,low:NaN};
  const a=c.slice(-period);
  return {high:Math.max(...a.map(x=>x.h)),low:Math.min(...a.map(x=>x.l))};
}
function priorDay(c){
  if(!c.length) return null;
  const dayKey=t=>Math.floor(t/86400000);
  const current=dayKey(c[c.length-1].t);
  const prev=c.filter(x=>dayKey(x.t)<current);
  if(!prev.length) return null;
  const key=dayKey(prev[prev.length-1].t);
  const d=prev.filter(x=>dayKey(x.t)===key);
  return {high:Math.max(...d.map(x=>x.h)),low:Math.min(...d.map(x=>x.l)),close:d[d.length-1].c,candles:d};
}
function sessionPoc(c,bins=24){
  const d=priorDay(c); if(!d) return NaN;
  const a=d.candles,lo=d.low,hi=d.high;
  if(!(hi>lo)) return (hi+lo)/2;
  const step=(hi-lo)/bins,vol=Array(bins).fill(0);
  for(const b of a){
    const tp=(b.h+b.l+b.c)/3;
    const ix=Math.max(0,Math.min(bins-1,Math.floor((tp-lo)/step)));
    vol[ix]+=Math.max(0,b.v);
  }
  let ix=0; for(let i=1;i<bins;i++) if(vol[i]>vol[ix]) ix=i;
  return lo+(ix+0.5)*step;
}
function confirmedPivots(c,left=3,right=3){
  const highs=[],lows=[];
  for(let i=left+right;i<c.length;i++){
    const p=i-right; let ph=true,pl=true;
    for(let j=p-left;j<=p+right;j++){
      if(j===p) continue;
      if(c[j].h>=c[p].h) ph=false;
      if(c[j].l<=c[p].l) pl=false;
    }
    if(ph) highs.push({pivotIndex:p,confirmedIndex:i,price:c[p].h});
    if(pl) lows.push({pivotIndex:p,confirmedIndex:i,price:c[p].l});
  }
  return {highs,lows};
}
function scoreResult(score,level,price,missing,detail={}){
  const s=Math.round(clamp(score));
  return {
    score:s,
    class:pc(s),
    triggerLevel:round(level,10),
    distancePct:round(signedPct(level,price),4),
    missing,
    ...detail
  };
}
function rangeEdge(closed,b){
  const {high,low}=previousRange(closed,72);
  const width=high-low,price=b.c,prev=closed.at(-1)?.c;
  if(!finite(width)||width<=0||!finite(prev)) return null;
  const lo=low+0.15*width,hi=high-0.15*width;
  const longTouch=b.l<=lo, longBull=b.c>b.o, longPrev=b.c>prev;
  const shortTouch=b.h>=hi, shortBear=b.c<b.o, shortPrev=b.c<prev;
  const lscore=(longTouch?50:50*closeness(b.l-lo,Math.max(width*0.20,price*0.005)))+(longBull?25:0)+(longPrev?25:0);
  const sscore=(shortTouch?50:50*closeness(hi-b.h,Math.max(width*0.20,price*0.005)))+(shortBear?25:0)+(shortPrev?25:0);
  return {
    long:scoreResult(lscore,lo,price,[!longTouch?'range low-edge touch':null,!longBull?'bullish candle':null,!longPrev?'close > previous close':null].filter(Boolean).join(' + ')||'ready',{rangeHigh:round(high,10),rangeLow:round(low,10)}),
    short:scoreResult(sscore,hi,price,[!shortTouch?'range high-edge touch':null,!shortBear?'bearish candle':null,!shortPrev?'close < previous close':null].filter(Boolean).join(' + ')||'ready',{rangeHigh:round(high,10),rangeLow:round(low,10)})
  };
}
function liquiditySweep(closed,b){
  const {high,low}=previousRange(closed,24);
  const all=[...closed,b],a=atr(all,14).at(-1),price=b.c;
  if(!finite(a)||a<=0||!finite(high)||!finite(low)) return null;
  const lSweep=low-0.05*a,sSweep=high+0.05*a;
  const ls=b.l<lSweep,lr=b.c>low,ss=b.h>sSweep,sr=b.c<high;
  const lscore=(ls?65:65*closeness(b.l-lSweep,a))+(lr?35:35*closeness(low-b.c,a));
  const sscore=(ss?65:65*closeness(sSweep-b.h,a))+(sr?35:35*closeness(b.c-high,a));
  return {
    long:scoreResult(lscore,lSweep,price,[!ls?'sweep below 24-bar low':null,!lr?'reclaim above range low':null].filter(Boolean).join(' + ')||'ready',{reclaimLevel:round(low,10),atr:round(a,10)}),
    short:scoreResult(sscore,sSweep,price,[!ss?'sweep above 24-bar high':null,!sr?'reclaim below range high':null].filter(Boolean).join(' + ')||'ready',{reclaimLevel:round(high,10),atr:round(a,10)})
  };
}
function pocMean(closed,b){
  const all=[...closed,b],a=atr(all,14).at(-1),poc=sessionPoc(all),price=b.c;
  if(!finite(a)||a<=0||!finite(poc)) return null;
  const lt=poc-0.6*a,st=poc+0.6*a;
  const ld=b.c<lt,lb=b.c>b.o,sd=b.c>st,sb=b.c<b.o;
  const lscore=(ld?65:65*closeness(b.c-lt,a))+(lb?35:0);
  const sscore=(sd?65:65*closeness(st-b.c,a))+(sb?35:0);
  return {
    long:scoreResult(lscore,lt,price,[!ld?'close below POC-0.6ATR':null,!lb?'bullish candle':null].filter(Boolean).join(' + ')||'ready',{poc:round(poc,10),atr:round(a,10)}),
    short:scoreResult(sscore,st,price,[!sd?'close above POC+0.6ATR':null,!sb?'bearish candle':null].filter(Boolean).join(' + ')||'ready',{poc:round(poc,10),atr:round(a,10)})
  };
}
function camarillaMean(closed,b){
  const all=[...closed,b],d=priorDay(all),price=b.c;
  if(!d) return null;
  const r=d.high-d.low,cc=d.close,h3=cc+r*1.1/4,l3=cc-r*1.1/4,h4=cc+r*1.1/2,l4=cc-r*1.1/2;
  const lt=b.l<=l3,lr=b.c>l3,lu=b.c<h4,st=b.h>=h3,sr=b.c<h3,sl=b.c>l4;
  const scale=Math.max(r*0.25,price*0.005);
  const lscore=(lt?55:55*closeness(b.l-l3,scale))+(lr?30:30*closeness(l3-b.c,scale))+(lu?15:0);
  const sscore=(st?55:55*closeness(h3-b.h,scale))+(sr?30:30*closeness(b.c-h3,scale))+(sl?15:0);
  return {
    long:scoreResult(lscore,l3,price,[!lt?'touch L3':null,!lr?'close > L3':null,!lu?'close < H4':null].filter(Boolean).join(' + ')||'ready',{h3:round(h3,10),l3:round(l3,10),h4:round(h4,10),l4:round(l4,10)}),
    short:scoreResult(sscore,h3,price,[!st?'touch H3':null,!sr?'close < H3':null,!sl?'close > L4':null].filter(Boolean).join(' + ')||'ready',{h3:round(h3,10),l3:round(l3,10),h4:round(h4,10),l4:round(l4,10)})
  };
}
function activeFvg(closed){
  let dir=0,lo=NaN,hi=NaN,created=-1;
  for(let i=2;i<closed.length;i++){
    if(closed[i].l>closed[i-2].h){dir=1;lo=closed[i-2].h;hi=closed[i].l;created=i;}
    else if(closed[i].h<closed[i-2].l){dir=-1;lo=closed[i].h;hi=closed[i-2].l;created=i;}
    if(i<=created) continue;
    if(dir===1&&closed[i].l<=hi&&closed[i].h>=lo&&closed[i].c>lo) dir=0;
    else if(dir===-1&&closed[i].h>=lo&&closed[i].l<=hi&&closed[i].c<hi) dir=0;
  }
  return dir?{dir,lo,hi}:null;
}
function fvgFirstTouch(closed,b){
  const x=activeFvg(closed),price=b.c;
  if(!x){
    return {long:scoreResult(0,null,price,'no active bullish FVG'),short:scoreResult(0,null,price,'no active bearish FVG')};
  }
  const width=Math.max(x.hi-x.lo,price*0.002);
  if(x.dir===1){
    const touch=b.l<=x.hi&&b.h>=x.lo,reclaim=b.c>x.lo;
    const sc=(touch?65:65*closeness(b.l-x.hi,width*2))+(reclaim?35:35*closeness(x.lo-b.c,width*2));
    return {long:scoreResult(sc,x.hi,price,[!touch?'touch bullish FVG':null,!reclaim?'close > FVG low':null].filter(Boolean).join(' + ')||'ready',{zoneLow:round(x.lo,10),zoneHigh:round(x.hi,10)}),short:scoreResult(0,null,price,'active FVG is bullish')};
  }
  const touch=b.h>=x.lo&&b.l<=x.hi,reclaim=b.c<x.hi;
  const sc=(touch?65:65*closeness(x.lo-b.h,width*2))+(reclaim?35:35*closeness(b.c-x.hi,width*2));
  return {long:scoreResult(0,null,price,'active FVG is bearish'),short:scoreResult(sc,x.lo,price,[!touch?'touch bearish FVG':null,!reclaim?'close < FVG high':null].filter(Boolean).join(' + ')||'ready',{zoneLow:round(x.lo,10),zoneHigh:round(x.hi,10)})};
}
function trendline(closed,b){
  const all=[...closed,b],a=atr(all,14).at(-1),price=b.c,p=confirmedPivots(closed,3,3),i=closed.length;
  const calc=(arr,dir)=>{
    if(arr.length<3||!finite(a)||a<=0) return scoreResult(0,null,price,'need 3 confirmed pivots');
    const [a1,a2,a3]=arr.slice(-3),dx=a2.pivotIndex-a1.pivotIndex;
    if(dx<=0) return scoreResult(0,null,price,'invalid pivot spacing');
    const slope=(a2.price-a1.price)/dx;
    const expected3=a1.price+slope*(a3.pivotIndex-a1.pivotIndex);
    const valid=Math.abs(a3.price-expected3)<=0.35*a;
    const linePrev=a1.price+slope*((i-1)-a1.pivotIndex);
    const lineNow=a1.price+slope*(i-a1.pivotIndex);
    const threshold=dir===1?lineNow+0.08*a:lineNow-0.08*a;
    const prevOk=dir===1?closed.at(-1).c<=linePrev:closed.at(-1).c>=linePrev;
    const breakOk=dir===1?b.c>threshold:b.c<threshold;
    const d=dir===1?threshold-b.c:b.c-threshold;
    const sc=(valid?20:0)+(prevOk?20:0)+(breakOk?60:60*closeness(d,1.5*a));
    return scoreResult(sc,threshold,price,[!valid?'3rd pivot off trendline':null,!prevOk?'previous close already wrong side':null,!breakOk?'break threshold':null].filter(Boolean).join(' + ')||'ready',{lineNow:round(lineNow,10),atr:round(a,10)});
  };
  return {long:calc(p.highs,1),short:calc(p.lows,-1)};
}
function impulseState(closed){
  const av=atr(closed,14),vv=sma(closed.map(x=>x.v),20);
  let dir=0,lo=NaN,hi=NaN,expires=-1;
  for(let i=20;i<closed.length;i++){
    const a=av[i],v=vv[i]; if(!finite(a)||a<=0||!finite(v)||v<=0) continue;
    if(dir===0&&(closed[i].h-closed[i].l)>=1.5*a&&closed[i].v>=1.3*v){
      const prev=closed[i-1];
      if(closed[i].c>closed[i].o&&prev.c<prev.o){dir=1;lo=prev.l;hi=Math.max(prev.o,prev.c);expires=i+24;continue;}
      if(closed[i].c<closed[i].o&&prev.c>prev.o){dir=-1;lo=Math.min(prev.o,prev.c);hi=prev.h;expires=i+24;continue;}
    }
    if(dir&&i>expires){dir=0;continue;}
    if(dir===1&&closed[i].l<=hi&&closed[i].c>hi){dir=0;continue;}
    if(dir===-1&&closed[i].h>=lo&&closed[i].c<lo){dir=0;continue;}
  }
  return dir&&closed.length<=expires+1?{dir,lo,hi,expires}:null;
}
function impulseOb(closed,b){
  const x=impulseState(closed),price=b.c;
  if(!x) return {long:scoreResult(0,null,price,'no active impulse order block'),short:scoreResult(0,null,price,'no active impulse order block')};
  const width=Math.max(x.hi-x.lo,price*0.002);
  if(x.dir===1){
    const touch=b.l<=x.hi,reclaim=b.c>x.hi;
    const sc=(touch?60:60*closeness(b.l-x.hi,width*3))+(reclaim?40:40*closeness(x.hi-b.c,width*3));
    return {long:scoreResult(sc,x.hi,price,[!touch?'retest bullish OB':null,!reclaim?'close > OB high':null].filter(Boolean).join(' + ')||'ready',{zoneLow:round(x.lo,10),zoneHigh:round(x.hi,10)}),short:scoreResult(0,null,price,'active order block is bullish')};
  }
  const touch=b.h>=x.lo,reclaim=b.c<x.lo;
  const sc=(touch?60:60*closeness(x.lo-b.h,width*3))+(reclaim?40:40*closeness(b.c-x.lo,width*3));
  return {long:scoreResult(0,null,price,'active order block is bearish'),short:scoreResult(sc,x.lo,price,[!touch?'retest bearish OB':null,!reclaim?'close < OB low':null].filter(Boolean).join(' + ')||'ready',{zoneLow:round(x.lo,10),zoneHigh:round(x.hi,10)})};
}
function evaluate(strategy,closed,currentBar){
  if(!currentBar) return null;
  switch(strategy){
    case 'sr_range_edge': return rangeEdge(closed,currentBar);
    case 'sr_liquidity_sweep': return liquiditySweep(closed,currentBar);
    case 'sr25_poc_mean_reversion': return pocMean(closed,currentBar);
    case 'sr25_camarilla_h3_l3': return camarillaMean(closed,currentBar);
    case 'sr25_fvg_first_touch': return fvgFirstTouch(closed,currentBar);
    case 'sr25_trendline_breakout': return trendline(closed,currentBar);
    case 'sr25_impulse_ob_retest': return impulseOb(closed,currentBar);
    default: return null;
  }
}
const rows=[];
for(const row of watch.rows??[]){
  const p=path.join(candlesDir,`${row.executionContract}__${row.timeframe}.json`);
  let prox=null,currentPrice=null,currentBarTime=null;
  if(row.executionContract&&fs.existsSync(p)){
    const doc=JSON.parse(fs.readFileSync(p,'utf8'));
    const closed=doc.candles??[];
    const b=doc.currentBar??(closed.length?closed[closed.length-1]:null);
    if(b){
      currentPrice=Number(b.c);
      currentBarTime=Number(b.t);
      prox=evaluate(row.strategy,closed,b);
    }
  }
  const long=prox?.long??scoreResult(0,null,currentPrice,'proximity unavailable');
  const short=prox?.short??scoreResult(0,null,currentPrice,'proximity unavailable');
  const closest=long.score>=short.score?'LONG':'SHORT';
  rows.push({
    underlying:row.underlying,
    executionContract:row.executionContract,
    strategy:row.strategy,
    timeframe:row.timeframe,
    executionStatus:row.executionStatus,
    signalStatus:row.status,
    currentPrice:round(currentPrice,10),
    currentBarTime,
    long,
    short,
    closestDirection:closest,
    closestScore:Math.max(long.score,short.score),
    closestClass:pc(Math.max(long.score,short.score)),
    previewOnly:true
  });
}
const out={
  schemaVersion:1,
  generatedAt:new Date().toISOString(),
  cohortId:board.cohortId??null,
  semantics:{
    score:'0-100 mechanical proximity to the selected strategy entry conditions; NOT probability',
    classes:{'0-29':'UZAK','30-59':'ORTA','60-79':'YAKIN','80-99':'COK_YAKIN','100':'TETIK/WAIT_CLOSE'},
    preview:'uses the currently open candle for proximity preview only',
    execution:'orders remain driven only by confirmed closed-candle fresh signals'
  },
  rows
};
fs.mkdirSync(path.dirname(outPath),{recursive:true});
fs.writeFileSync(outPath,JSON.stringify(out,null,2)+'\n');
console.log(JSON.stringify({rows:rows.length,near:rows.filter(x=>x.closestScore>=60).length,veryNear:rows.filter(x=>x.closestScore>=80).length}));
