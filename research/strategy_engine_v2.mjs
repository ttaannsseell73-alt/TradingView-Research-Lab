const finite = Number.isFinite;

function mean(xs) {
  return xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : 0;
}
function stdev(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s,x)=>s+(x-m)**2,0)/(xs.length-1));
}
function crossOver(ap,bp,a,b) {
  return [ap,bp,a,b].every(finite) && ap <= bp && a > b;
}
function crossUnder(ap,bp,a,b) {
  return [ap,bp,a,b].every(finite) && ap >= bp && a < b;
}
function sma(xs,p) {
  const out=Array(xs.length).fill(NaN);
  let s=0;
  for(let i=0;i<xs.length;i++){
    s+=xs[i];
    if(i>=p) s-=xs[i-p];
    if(i>=p-1) out[i]=s/p;
  }
  return out;
}
function ema(xs,p) {
  const out=Array(xs.length).fill(NaN);
  const a=2/(p+1);
  let q=NaN;
  for(let i=0;i<xs.length;i++){
    q=finite(q)?a*xs[i]+(1-a)*q:xs[i];
    out[i]=q;
  }
  return out;
}
function wma(xs,p) {
  const out=Array(xs.length).fill(NaN);
  const d=p*(p+1)/2;
  for(let i=p-1;i<xs.length;i++){
    let s=0,ok=true;
    for(let k=0;k<p;k++){
      const v=xs[i-p+1+k];
      if(!finite(v)){ok=false;break;}
      s+=v*(k+1);
    }
    if(ok) out[i]=s/d;
  }
  return out;
}
function hma(xs,p) {
  const half=wma(xs,Math.max(1,Math.floor(p/2)));
  const full=wma(xs,p);
  const diff=xs.map((_,i)=>finite(half[i])&&finite(full[i])?2*half[i]-full[i]:NaN);
  return wma(diff,Math.max(1,Math.round(Math.sqrt(p))));
}
function trueRange(c) {
  return c.map((b,i)=>i?Math.max(b.h-b.l,Math.abs(b.h-c[i-1].c),Math.abs(b.l-c[i-1].c)):b.h-b.l);
}
function rma(xs,p) {
  const out=Array(xs.length).fill(NaN);
  if(xs.length<p) return out;
  let s=0;
  for(let i=0;i<p;i++) s+=xs[i];
  let q=s/p;
  out[p-1]=q;
  for(let i=p;i<xs.length;i++){
    q=(q*(p-1)+xs[i])/p;
    out[i]=q;
  }
  return out;
}
function mfi(c,p) {
  const out=Array(c.length).fill(NaN);
  const tp=c.map(b=>(b.h+b.l+b.c)/3);
  const pos=Array(c.length).fill(0),neg=Array(c.length).fill(0);
  for(let i=1;i<c.length;i++){
    const flow=tp[i]*c[i].v;
    if(tp[i]>tp[i-1]) pos[i]=flow;
    else if(tp[i]<tp[i-1]) neg[i]=flow;
  }
  let ps=0,ns=0;
  for(let i=0;i<c.length;i++){
    ps+=pos[i];ns+=neg[i];
    if(i>=p){ps-=pos[i-p];ns-=neg[i-p];}
    if(i>=p-1) out[i]=ns===0?100:100-100/(1+ps/ns);
  }
  return out;
}
function vidyaVar(xs,p) {
  const out=Array(xs.length).fill(NaN),up=Array(xs.length).fill(0),dn=Array(xs.length).fill(0);
  const a=2/(p+1);
  for(let i=1;i<xs.length;i++){
    const d=xs[i]-xs[i-1];
    up[i]=Math.max(d,0);dn[i]=Math.max(-d,0);
  }
  let su=0,sd=0,q=xs[0];
  out[0]=q;
  for(let i=0;i<xs.length;i++){
    su+=up[i];sd+=dn[i];
    if(i>=9){su-=up[i-9];sd-=dn[i-9];}
    const cmo=su+sd===0?0:(su-sd)/(su+sd);
    q=a*Math.abs(cmo)*xs[i]+(1-a*Math.abs(cmo))*q;
    out[i]=q;
  }
  return out;
}
function ottCore(xs,p,percent) {
  const ma=vidyaVar(xs,p),ls=Array(xs.length),ss=Array(xs.length),dir=Array(xs.length).fill(1),ott=Array(xs.length);
  for(let i=0;i<xs.length;i++){
    const f=ma[i]*percent*.01;
    let l=ma[i]-f,s=ma[i]+f;
    if(i){
      if(ma[i]>ls[i-1]) l=Math.max(l,ls[i-1]);
      if(ma[i]<ss[i-1]) s=Math.min(s,ss[i-1]);
      dir[i]=dir[i-1];
      if(dir[i-1]===-1&&ma[i]>ss[i-1]) dir[i]=1;
      else if(dir[i-1]===1&&ma[i]<ls[i-1]) dir[i]=-1;
    }
    ls[i]=l;ss[i]=s;
    const mt=dir[i]===1?l:s;
    ott[i]=ma[i]>mt?mt*(200+percent)/200:mt*(200-percent)/200;
  }
  return {ma,ott};
}

function signalsPMax(c) {
  const close=c.map(b=>b.c),ma=ema(close,10),atr=rma(trueRange(c),10);
  const ls=Array(close.length).fill(NaN),ss=Array(close.length).fill(NaN),dir=Array(close.length).fill(1),pm=Array(close.length).fill(NaN),sig=Array(close.length).fill(0);
  for(let i=0;i<close.length;i++){
    if(!finite(atr[i])) continue;
    const up=ma[i]-3*atr[i],dn=ma[i]+3*atr[i];
    let l=up,s=dn;
    if(i&&finite(ls[i-1])){
      if(ma[i]>ls[i-1]) l=Math.max(up,ls[i-1]);
      if(ma[i]<ss[i-1]) s=Math.min(dn,ss[i-1]);
      dir[i]=dir[i-1];
      if(dir[i-1]===-1&&ma[i]>ss[i-1]) dir[i]=1;
      else if(dir[i-1]===1&&ma[i]<ls[i-1]) dir[i]=-1;
    }
    ls[i]=l;ss[i]=s;pm[i]=dir[i]===1?l:s;
    if(i){
      if(crossOver(ma[i-1],pm[i-1],ma[i],pm[i])) sig[i]=1;
      else if(crossUnder(ma[i-1],pm[i-1],ma[i],pm[i])) sig[i]=-1;
    }
  }
  return sig;
}
function signalsAlphaTrend(c) {
  const atr=sma(trueRange(c),14),mf=mfi(c,14),at=Array(c.length).fill(NaN),sig=Array(c.length).fill(0);
  for(let i=0;i<c.length;i++){
    if(!finite(atr[i])||!finite(mf[i])) continue;
    const up=c[i].l-atr[i],dn=c[i].h+atr[i],prev=i&&finite(at[i-1])?at[i-1]:0;
    at[i]=mf[i]>=50?Math.max(up,prev):Math.min(dn,prev);
    if(i>=3){
      if(crossOver(at[i-1],at[i-3],at[i],at[i-2])) sig[i]=1;
      else if(crossUnder(at[i-1],at[i-3],at[i],at[i-2])) sig[i]=-1;
    }
  }
  return sig;
}
function signalsOTT(c) {
  const close=c.map(b=>b.c),{ma,ott}=ottCore(close,2,1.4),sig=Array(close.length).fill(0);
  for(let i=4;i<close.length;i++){
    if(crossOver(ma[i-1],ott[i-3],ma[i],ott[i-2])) sig[i]=1;
    else if(crossUnder(ma[i-1],ott[i-3],ma[i],ott[i-2])) sig[i]=-1;
  }
  return sig;
}
function signalsTOTT(c) {
  const close=c.map(b=>b.c),{ma,ott}=ottCore(close,40,1),up=ott.map(v=>v*1.006),dn=ott.map(v=>v*.994),sig=Array(close.length).fill(0);
  for(let i=4;i<close.length;i++){
    if(crossOver(ma[i-1],up[i-3],ma[i],up[i-2])) sig[i]=1;
    else if(crossUnder(ma[i-1],dn[i-3],ma[i],dn[i-2])) sig[i]=-1;
  }
  return sig;
}
function signalsMavilimW(c) {
  let x=c.map(b=>b.c);
  for(const p of [3,5,8,13,21,34]) x=wma(x,p);
  const sig=Array(x.length).fill(0);
  for(let i=2;i<x.length;i++){
    if(![x[i],x[i-1],x[i-2]].every(finite)) continue;
    const prev=x[i-1]-x[i-2],cur=x[i]-x[i-1];
    if(prev<=0&&cur>0) sig[i]=1;
    else if(prev>=0&&cur<0) sig[i]=-1;
  }
  return sig;
}

/*
SSL Hybrid research adapter.
Public strategy supports disabling TP/SL and relying on SSL direction flips.
We intentionally use that mode for deterministic OHLC universe ranking:
HMA(60) high/low SSL1, closed-bar direction, next-bar-open execution.
No copied Pine source is embedded here; this is an independent implementation
from the published rules/default parameters.
*/
function signalsSSLHybridFlip(c) {
  const highs=hma(c.map(b=>b.h),60);
  const lows=hma(c.map(b=>b.l),60);
  const state=Array(c.length).fill(0);
  const ssl=Array(c.length).fill(NaN);
  const sig=Array(c.length).fill(0);
  for(let i=0;i<c.length;i++){
    let s=i?state[i-1]:0;
    if(finite(highs[i])&&c[i].c>highs[i]) s=1;
    else if(finite(lows[i])&&c[i].c<lows[i]) s=-1;
    state[i]=s;
    ssl[i]=s<0?highs[i]:lows[i];
    if(i&&finite(ssl[i])&&finite(ssl[i-1])){
      if(crossOver(c[i-1].c,ssl[i-1],c[i].c,ssl[i])) sig[i]=1;
      else if(crossUnder(c[i-1].c,ssl[i-1],c[i].c,ssl[i])) sig[i]=-1;
    }
  }
  return sig;
}

export const STRATEGIES = [
  {id:'pmax',name:'PMax Explorer',family:'trend_atr',version:'kivanc-core-v1',signal:signalsPMax},
  {id:'alphatrend',name:'AlphaTrend',family:'trend_volume_atr',version:'kivanc-core-v1',signal:signalsAlphaTrend},
  {id:'ott',name:'Optimized Trend Tracker',family:'adaptive_trend',version:'kivanc-core-v1',signal:signalsOTT},
  {id:'tott',name:'Twin Optimized Trend Tracker',family:'adaptive_trend',version:'kivanc-core-v1',signal:signalsTOTT},
  {id:'mavilimw',name:'MavilimW',family:'smoothed_trend',version:'kivanc-core-v1',signal:signalsMavilimW},
  {id:'ssl_hybrid_flip',name:'SSL Hybrid — Flip Mode',family:'baseline_trend',version:'tv-open-v1',signal:signalsSSLHybridFlip}
];

function backtest(c,signals) {
  const trades=[];
  let pos=0,entryPrice=0,entryTime=0;
  const closeTrade=(px,xt)=>{
    if(!pos) return;
    const gross=pos===1?px/entryPrice-1:entryPrice/px-1;
    trades.push({side:pos,entryTime,exitTime:xt,gross});
  };
  for(let i=0;i<signals.length-1;i++){
    const s=signals[i];
    if(!s||s===pos) continue;
    const px=c[i+1].o,tm=c[i+1].t;
    if(pos) closeTrade(px,tm);
    pos=s;entryPrice=px;entryTime=tm;
  }
  if(pos&&c.length){
    const b=c[c.length-1];
    closeTrade(b.c,b.t);
  }
  return trades;
}
function stats(trades,cost,start,end) {
  const rs=trades.map(t=>t.gross-cost);
  let eq=1,peak=1,dd=0,wins=0,grossWins=0,grossLoss=0;
  for(const r of rs){
    if(r>0){wins++;grossWins+=r;}
    else if(r<0) grossLoss+=r;
    eq*=Math.max(1e-9,1+r);
    peak=Math.max(peak,eq);
    dd=Math.max(dd,1-eq/peak);
  }
  const width=(end-start)/3;
  const seg=[0,1,2].map(j=>trades
    .filter(t=>Math.min(2,Math.floor((t.entryTime-start)/width))===j)
    .reduce((e,t)=>e*(1+t.gross-cost),1)-1);
  const avg=mean(rs),sd=stdev(rs);
  return {
    n:rs.length,
    wr:rs.length?wins/rs.length:0,
    net:eq-1,
    pf:grossLoss<0?grossWins/Math.abs(grossLoss):(grossWins>0?999:0),
    dd,
    exp:avg,
    sh:sd?avg/sd*Math.sqrt(rs.length):0,
    posseg:seg.filter(x=>x>0).length,
    seg
  };
}

export function evaluateStrategies(candles, {
  cost=0.0014,
  stressCost=0.0015,
  lowCost=0.0006,
  start,
  end
}={}) {
  if(!Number.isFinite(start)||!Number.isFinite(end)) throw new Error('evaluateStrategies requires finite start/end');
  return STRATEGIES.map(s=>{
    const trades=backtest(candles,s.signal(candles));
    const base=stats(trades,cost,start,end);
    const stress=stats(trades,stressCost,start,end);
    const low=stats(trades,lowCost,start,end);
    const pass=base.n>=20&&base.net>0&&base.exp>0&&base.pf>1.05&&base.posseg>=2&&stress.net>0;
    return {
      id:s.id,
      name:s.name,
      family:s.family,
      version:s.version,
      ...base,
      net15:stress.net,
      net6:low.net,
      pass
    };
  });
}
