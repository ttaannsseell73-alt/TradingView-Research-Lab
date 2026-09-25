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

function rollingMeanFinite(xs,p) {
  const out=Array(xs.length).fill(NaN);
  for(let i=p-1;i<xs.length;i++){
    const win=xs.slice(i-p+1,i+1);
    if(!win.every(finite)) continue;
    out[i]=mean(win);
  }
  return out;
}
function rollingStdPopulation(xs,p) {
  const out=Array(xs.length).fill(NaN);
  for(let i=p-1;i<xs.length;i++){
    const win=xs.slice(i-p+1,i+1);
    if(!win.every(finite)) continue;
    const m=mean(win);
    out[i]=Math.sqrt(win.reduce((s,x)=>s+(x-m)**2,0)/p);
  }
  return out;
}
function rsi(xs,p) {
  const gains=Array(xs.length).fill(0),losses=Array(xs.length).fill(0);
  for(let i=1;i<xs.length;i++){
    const d=xs[i]-xs[i-1];
    gains[i]=Math.max(d,0);
    losses[i]=Math.max(-d,0);
  }
  const ag=rma(gains,p),al=rma(losses,p),out=Array(xs.length).fill(NaN);
  for(let i=0;i<xs.length;i++){
    if(!finite(ag[i])||!finite(al[i])) continue;
    out[i]=al[i]===0?100:ag[i]===0?0:100-100/(1+ag[i]/al[i]);
  }
  return out;
}
function crossAny(ap,bp,a,b) {
  return crossOver(ap,bp,a,b)||crossUnder(ap,bp,a,b);
}
function qqeTrack(xs,{rsiPeriod=6,smoothing=5,factor=3}={}) {
  const rsiMa=ema(rsi(xs,rsiPeriod),smoothing);
  const wilders=rsiPeriod*2-1;
  const atrRsi=rsiMa.map((v,i)=>i&&finite(v)&&finite(rsiMa[i-1])?Math.abs(rsiMa[i-1]-v):NaN);
  const maAtr=ema(atrRsi,wilders);
  const dar=ema(maAtr,wilders).map(v=>finite(v)?v*factor:NaN);
  const longband=Array(xs.length).fill(NaN),shortband=Array(xs.length).fill(NaN),trend=Array(xs.length).fill(1),fast=Array(xs.length).fill(NaN);
  for(let i=0;i<xs.length;i++){
    if(!finite(rsiMa[i])||!finite(dar[i])) continue;
    const idx=rsiMa[i],newShort=idx+dar[i],newLong=idx-dar[i];
    const prevLong=i&&finite(longband[i-1])?longband[i-1]:0;
    const prevShort=i&&finite(shortband[i-1])?shortband[i-1]:0;
    const prevIdx=i&&finite(rsiMa[i-1])?rsiMa[i-1]:idx;
    longband[i]=prevIdx>prevLong&&idx>prevLong?Math.max(prevLong,newLong):newLong;
    shortband[i]=prevIdx<prevShort&&idx<prevShort?Math.min(prevShort,newShort):newShort;
    let tr=i?trend[i-1]:1;
    if(i>=2&&finite(shortband[i-1])&&finite(shortband[i-2])&&finite(rsiMa[i-1])){
      if(crossAny(rsiMa[i-1],shortband[i-2],rsiMa[i],shortband[i-1])) tr=1;
      else if(finite(longband[i-1])&&finite(longband[i-2])&&crossAny(longband[i-2],rsiMa[i-1],longband[i-1],rsiMa[i])) tr=-1;
    }
    trend[i]=tr;
    fast[i]=tr===1?longband[i]:shortband[i];
  }
  return {rsiMa,fast};
}


function rollingLinReg(xs,p,offset=0) {
  const out=Array(xs.length).fill(NaN);
  const sx=(p-1)*p/2;
  const sxx=(p-1)*p*(2*p-1)/6;
  const denom=p*sxx-sx*sx;
  for(let i=p-1;i<xs.length;i++){
    let sy=0,sxy=0,ok=true;
    for(let k=0;k<p;k++){
      const y=xs[i-p+1+k];
      if(!finite(y)){ok=false;break;}
      sy+=y;sxy+=k*y;
    }
    if(!ok) continue;
    const slope=denom===0?0:(p*sxy-sx*sy)/denom;
    const intercept=(sy-slope*sx)/p;
    out[i]=intercept+slope*(p-1-offset);
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


function signalsSSLHybridQQEFlip(c) {
  const close=c.map(b=>b.c);
  const highs=hma(c.map(b=>b.h),60);
  const lows=hma(c.map(b=>b.l),60);
  const state=Array(c.length).fill(0),ssl=Array(c.length).fill(NaN);
  for(let i=0;i<c.length;i++){
    let s=i?state[i-1]:0;
    if(finite(highs[i])&&c[i].c>highs[i]) s=1;
    else if(finite(lows[i])&&c[i].c<lows[i]) s=-1;
    state[i]=s;
    ssl[i]=s<0?highs[i]:lows[i];
  }

  const q1=qqeTrack(close,{rsiPeriod:6,smoothing:5,factor:3});
  const q2=qqeTrack(close,{rsiPeriod:6,smoothing:5,factor:1.61});
  const basis=rollingMeanFinite(q1.fast.map(v=>finite(v)?v-50:NaN),50);
  const dev=rollingStdPopulation(q1.fast.map(v=>finite(v)?v-50:NaN),50);
  const upper=basis.map((v,i)=>finite(v)&&finite(dev[i])?v+0.35*dev[i]:NaN);
  const lower=basis.map((v,i)=>finite(v)&&finite(dev[i])?v-0.35*dev[i]:NaN);

  const sig=Array(c.length).fill(0);
  let started=false;
  for(let i=1;i<c.length;i++){
    if(!started&&finite(ssl[i])&&finite(ssl[i-1])&&crossAny(close[i-1],ssl[i-1],close[i],ssl[i])) started=true;
    if(!started) continue;
    if(![ssl[i],q1.rsiMa[i],q2.rsiMa[i],q2.fast[i],upper[i],lower[i]].every(finite)) continue;
    const green1=q2.rsiMa[i]-50>3;
    const green2=q1.rsiMa[i]-50>upper[i];
    const red1=q2.rsiMa[i]-50<-3;
    const red2=q1.rsiMa[i]-50<lower[i];
    const qqeLine=q2.fast[i]-50;
    if(close[i]>ssl[i]&&green1&&green2&&qqeLine>0) sig[i]=1;
    else if(close[i]<ssl[i]&&red1&&red2&&qqeLine<0) sig[i]=-1;
  }
  return sig;
}

/*
UT Bot Strategy research adapter.
QuantNomad's public strategy defaults: sensitivity key=1, ATR period=10,
regular candles (Heikin-Ashi source disabled). This independent adapter
uses the published ATR trailing-stop state machine, confirmed-bar signals
and the lab's common next-bar-open execution model.
*/
function signalsUTBotQuantNomad(c) {
  const src=c.map(b=>b.c);
  const atr=rma(trueRange(c),10);
  const stop=Array(c.length).fill(NaN);
  const sig=Array(c.length).fill(0);

  for(let i=0;i<c.length;i++){
    if(!finite(atr[i])) continue;
    const loss=atr[i]; // key value = 1
    const prevStop=i&&finite(stop[i-1])?stop[i-1]:0;
    const prevSrc=i?src[i-1]:src[i];

    if(i&&src[i]>prevStop&&prevSrc>prevStop) {
      stop[i]=Math.max(prevStop,src[i]-loss);
    } else if(i&&src[i]<prevStop&&prevSrc<prevStop) {
      stop[i]=Math.min(prevStop,src[i]+loss);
    } else {
      stop[i]=src[i]>prevStop?src[i]-loss:src[i]+loss;
    }

    if(i&&finite(stop[i-1])){
      if(crossOver(src[i-1],stop[i-1],src[i],stop[i])&&src[i]>stop[i]) sig[i]=1;
      else if(crossUnder(src[i-1],stop[i-1],src[i],stop[i])&&src[i]<stop[i]) sig[i]=-1;
    }
  }
  return sig;
}

/*
Chandelier Exit + ZLSMA research adapter.
Public strategy defaults: CE ATR period=1, ATR multiplier=2, prior-bar OHLC4
source, ZLSMA length=50. Unlike reversal-only systems this strategy can be
flat between exits and the next qualified entry, so it emits target positions.
*/
function targetsChandelierZLSMA(c) {
  const n=c.length;
  const haClose=Array(n).fill(NaN);
  const tr=trueRange(c);
  const longStop=Array(n).fill(NaN),shortStop=Array(n).fill(NaN);
  const dir=Array(n).fill(1);
  for(let i=1;i<n;i++){
    haClose[i]=(c[i-1].o+c[i-1].h+c[i-1].l+c[i-1].c)/4;
    const atr=2*tr[i-1];
    let ls=haClose[i]-atr;
    let ss=haClose[i]+atr;
    const prevLs=i>1&&finite(longStop[i-1])?longStop[i-1]:ls;
    const prevSs=i>1&&finite(shortStop[i-1])?shortStop[i-1]:ss;
    if(haClose[i]>prevLs) ls=Math.max(ls,prevLs);
    if(haClose[i]<prevSs) ss=Math.min(ss,prevSs);
    longStop[i]=ls;shortStop[i]=ss;
    const prevDir=i>1?dir[i-1]:1;
    dir[i]=haClose[i]>prevSs?1:haClose[i]<prevLs?-1:prevDir;
  }

  const lsma=rollingLinReg(haClose,50,0);
  const lsma2=rollingLinReg(lsma,50,0);
  const zlsma=lsma.map((v,i)=>finite(v)&&finite(lsma2[i])?2*v-lsma2[i]:NaN);

  const target=Array(n).fill(0);
  let pos=0;
  let pending=0;
  for(let i=1;i<n;i++){
    const crossUp=crossOver(haClose[i-1],zlsma[i-1],haClose[i],zlsma[i]);
    const crossDn=crossUnder(haClose[i-1],zlsma[i-1],haClose[i],zlsma[i]);
    const buy=dir[i]===1&&dir[i-1]===-1;
    const sell=dir[i]===-1&&dir[i-1]===1;
    let enterLong=buy&&crossUp;
    let enterShort=sell&&crossDn;
    const exitLong=crossDn;
    const exitShort=crossUp;

    if(pos===0&&pending!==0){
      pos=pending;
      pending=0;
      target[i]=pos;
      continue;
    }

    if(pos===0){
      if(enterLong) pos=1;
      else if(enterShort) pos=-1;
    } else if(pos===1){
      if(exitLong){
        if(enterShort) pending=-1;
        pos=0;
      }
    } else if(pos===-1){
      if(exitShort){
        if(enterLong) pending=1;
        pos=0;
      }
    }
    target[i]=pos;
  }
  return target;
}


/*
Squeeze Momentum (LazyBear/Kivanc lineage) research adapter.
Ported from the already-tested CoinStrategyLab implementation:
OHLC4 BB/KC squeeze state, 20-bar linear-regression momentum,
type2 zero-side turn, and squeeze-release requirement.
*/
function signalsSqueezeMomentum(c) {
  const n=c.length;
  const src=c.map(b=>(b.o+b.h+b.l+b.c)/4);
  const bbBasis=sma(src,20);
  const bbStd=rollingStdPopulation(src,20);
  const kcMid=sma(src,20);
  const rangeMa=sma(c.map(b=>b.h-b.l),20);
  const hl2=c.map(b=>(b.h+b.l)/2);
  const hl2Ma=sma(hl2,20);
  const center=Array(n).fill(NaN);
  const sqzOff=Array(n).fill(false);

  for(let i=19;i<n;i++){
    let hi=-Infinity,lo=Infinity;
    for(let k=i-19;k<=i;k++){
      hi=Math.max(hi,c[k].h);
      lo=Math.min(lo,c[k].l);
    }
    center[i]=(((hi+lo)/2)+hl2Ma[i])/2;
    const upperBB=bbBasis[i]+2*bbStd[i];
    const lowerBB=bbBasis[i]-2*bbStd[i];
    const upperKC=kcMid[i]+1.5*rangeMa[i];
    const lowerKC=kcMid[i]-1.5*rangeMa[i];
    sqzOff[i]=lowerBB<lowerKC&&upperBB>upperKC;
  }

  const raw=src.map((v,i)=>finite(center[i])?v-center[i]:NaN);
  const val=rollingLinReg(raw,20,0);
  const sig=Array(n).fill(0);
  for(let i=2;i<n;i++){
    if(![val[i],val[i-1],val[i-2]].every(finite)||!sqzOff[i]) continue;
    const risingTurn=val[i]>val[i-1]&&val[i-1]<=val[i-2]&&val[i]<0;
    const fallingTurn=val[i]<val[i-1]&&val[i-1]>=val[i-2]&&val[i]>0;
    if(risingTurn) sig[i]=1;
    else if(fallingTurn) sig[i]=-1;
  }
  return sig;
}

/*
QQE MOD + SSL Hybrid + Waddah Attar Explosion adapter.
Ported from the CoinStrategyLab implementation that produced the legacy
EXECUTION_PASS evidence. Entry is an event: new QQE color state AND
SSL directional filter AND WAE explosion filter on the same closed bar.
*/
function signalsQQESSLWAE(c) {
  const close=c.map(b=>b.c);
  const n=c.length;

  const q1=qqeTrack(close,{rsiPeriod:6,smoothing:6,factor:3});
  const q=q1.fast.map(v=>finite(v)?v-50:NaN);
  const basis=rollingMeanFinite(q,50);
  const dev=rollingStdPopulation(q,50);
  const upper=basis.map((v,i)=>finite(v)&&finite(dev[i])?v+0.35*dev[i]:NaN);
  const lower=basis.map((v,i)=>finite(v)&&finite(dev[i])?v-0.35*dev[i]:NaN);

  const rsi2Ma=ema(rsi(close,6),5);
  const qqeGreen=Array(n).fill(false);
  const qqeRed=Array(n).fill(false);
  for(let i=0;i<n;i++){
    if(![q1.rsiMa[i],rsi2Ma[i],upper[i],lower[i]].every(finite)) continue;
    qqeGreen[i]=(rsi2Ma[i]-50)>3&&(q1.rsiMa[i]-50)>upper[i];
    qqeRed[i]=(rsi2Ma[i]-50)<-3&&(q1.rsiMa[i]-50)<lower[i];
  }

  const bbmc=hma(close,60);
  const rangeMa=ema(trueRange(c),60);
  const macdFast=ema(close,20);
  const macdSlow=ema(close,40);
  const explosionStd=rollingStdPopulation(close,20);
  const sig=Array(n).fill(0);

  for(let i=1;i<n;i++){
    if(![bbmc[i],rangeMa[i],macdFast[i],macdSlow[i],macdFast[i-1],macdSlow[i-1],explosionStd[i]].every(finite)) continue;
    const upperK=bbmc[i]+rangeMa[i]*0.2;
    const lowerK=bbmc[i]-rangeMa[i]*0.2;
    const sslBuy=close[i]>upperK&&close[i]>bbmc[i];
    const sslSell=close[i]<lowerK&&close[i]<bbmc[i];

    const macdNow=macdFast[i]-macdSlow[i];
    const macdPrev=macdFast[i-1]-macdSlow[i-1];
    const t1=(macdNow-macdPrev)*180;
    const trendUp=Math.max(t1,0);
    const trendDown=Math.max(-t1,0);
    const explosion=explosionStd[i]*4;
    const waeBuy=trendUp>0&&trendUp>explosion;
    const waeSell=trendDown>0&&trendDown>explosion;

    const qqeBuy=qqeGreen[i]&&!qqeGreen[i-1];
    const qqeSell=qqeRed[i]&&!qqeRed[i-1];

    if(qqeBuy&&sslBuy&&waeBuy) sig[i]=1;
    else if(qqeSell&&sslSell&&waeSell) sig[i]=-1;
  }
  return sig;
}

export const STRATEGIES = [
  {id:'pmax',name:'PMax Explorer',family:'trend_atr',version:'kivanc-core-v1',mode:'REVERSAL',signal:signalsPMax},
  {id:'alphatrend',name:'AlphaTrend',family:'trend_volume_atr',version:'kivanc-core-v1',mode:'REVERSAL',signal:signalsAlphaTrend},
  {id:'ott',name:'Optimized Trend Tracker',family:'adaptive_trend',version:'kivanc-core-v1',mode:'REVERSAL',signal:signalsOTT},
  {id:'tott',name:'Twin Optimized Trend Tracker',family:'adaptive_trend',version:'kivanc-core-v1',mode:'REVERSAL',signal:signalsTOTT},
  {id:'mavilimw',name:'MavilimW',family:'smoothed_trend',version:'kivanc-core-v1',mode:'REVERSAL',signal:signalsMavilimW},
  {id:'ssl_hybrid_flip',name:'SSL Hybrid — Flip Mode',family:'baseline_trend',version:'tv-open-v1',mode:'REVERSAL',signal:signalsSSLHybridFlip},
  {id:'ssl_hybrid_qqe_flip',name:'SSL Hybrid + QQE — Flip Mode',family:'trend_momentum_filter',version:'tv-open-v1',mode:'REVERSAL',signal:signalsSSLHybridQQEFlip},
  {id:'ut_bot_quantnomad',name:'UT Bot Strategy — QuantNomad',family:'atr_trailing_stop',version:'tv-open-v1',mode:'REVERSAL',signal:signalsUTBotQuantNomad},
  {id:'chandelier_zlsma',name:'Chandelier Exit ZLSMA Strategy',family:'trend_breakout_filter',version:'tv-open-v1',mode:'TARGET_POSITION',signal:targetsChandelierZLSMA},
  {id:'squeeze_momentum',name:'Squeeze Momentum',family:'compression_momentum',version:'coin-strategy-lab-v1',mode:'REVERSAL',signal:signalsSqueezeMomentum},
  {id:'qqe_ssl_wae',name:'QQE MOD + SSL Hybrid + WAE',family:'momentum_trend_explosion',version:'coin-strategy-lab-v1',mode:'REVERSAL',signal:signalsQQESSLWAE}
];

function backtest(c,signals,tradeStart=-Infinity) {
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
    if(tm<tradeStart) continue;
    if(pos) closeTrade(px,tm);
    pos=s;entryPrice=px;entryTime=tm;
  }
  if(pos&&c.length){
    const b=c[c.length-1];
    closeTrade(b.c,b.t);
  }
  return trades;
}
function backtestTargetPosition(c,target,tradeStart=-Infinity) {
  const trades=[];
  let pos=0,entryPrice=0,entryTime=0;
  const closeTrade=(px,xt)=>{
    if(!pos) return;
    const gross=pos===1?px/entryPrice-1:entryPrice/px-1;
    trades.push({side:pos,entryTime,exitTime:xt,gross});
  };
  for(let i=0;i<target.length-1;i++){
    const want=target[i];
    if(![-1,0,1].includes(want)||want===pos) continue;
    const px=c[i+1].o,tm=c[i+1].t;
    if(tm<tradeStart) continue;
    if(pos) closeTrade(px,tm);
    pos=want;
    if(pos){entryPrice=px;entryTime=tm;}
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

function directionLabel(x){
  return x>0?'LONG':x<0?'SHORT':'FLAT';
}

export function evaluateCurrentSignals(candles, {
  asOf=Infinity,
  intervalMs=null,
  strategyIds=null
}={}) {
  const ids=strategyIds?new Set(strategyIds):null;
  const usable=(intervalMs&&Number.isFinite(asOf))
    ? candles.filter(b=>Number.isFinite(b.t)&&b.t+intervalMs<=asOf)
    : candles.slice();
  if(!usable.length) return [];

  const lastIndex=usable.length-1;
  return STRATEGIES
    .filter(s=>!ids||ids.has(s.id))
    .map(s=>{
      const raw=s.signal(usable);
      let state=0;
      let lastSignalIndex=-1;

      if((s.mode??'REVERSAL')==='TARGET_POSITION'){
        state=[-1,0,1].includes(raw[lastIndex])?raw[lastIndex]:0;
        for(let i=lastIndex;i>=1;i--){
          if(raw[i]!==raw[i-1]){
            lastSignalIndex=i;
            break;
          }
        }
        if(lastSignalIndex<0&&raw[0]!==0) lastSignalIndex=0;
      } else {
        for(let i=0;i<=lastIndex;i++){
          if(raw[i]===1||raw[i]===-1){
            state=raw[i];
            lastSignalIndex=i;
          }
        }
      }

      const lastSignalTime=lastSignalIndex>=0?usable[lastSignalIndex].t:null;
      const signalAgeBars=lastSignalIndex>=0?lastIndex-lastSignalIndex:null;
      const fresh=signalAgeBars===0;
      let action='FLAT';
      if(state===1) action=fresh?'ENTER_LONG':'HOLD_LONG';
      else if(state===-1) action=fresh?'ENTER_SHORT':'HOLD_SHORT';
      else if((s.mode??'REVERSAL')==='TARGET_POSITION'&&fresh) action='EXIT_TO_FLAT';

      return {
        id:s.id,
        name:s.name,
        family:s.family,
        version:s.version,
        mode:s.mode??'REVERSAL',
        direction:directionLabel(state),
        targetPosition:state,
        action,
        fresh,
        signalAgeBars,
        lastSignalTime,
        lastClosedBarTime:usable[lastIndex].t,
        barsUsed:usable.length
      };
    });
}

export function evaluateStrategies(candles, {
  cost=0.0014,
  stressCost=0.0015,
  lowCost=0.0006,
  minTrades=20,
  start,
  end
}={}) {
  if(!Number.isFinite(start)||!Number.isFinite(end)) throw new Error('evaluateStrategies requires finite start/end');
  return STRATEGIES.map(s=>{
    const raw=s.signal(candles);
    const trades=s.mode==='TARGET_POSITION'?backtestTargetPosition(candles,raw,start):backtest(candles,raw,start);
    const base=stats(trades,cost,start,end);
    const stress=stats(trades,stressCost,start,end);
    const low=stats(trades,lowCost,start,end);
    const pass=base.n>=minTrades&&base.net>0&&base.exp>0&&base.pf>1.05&&base.posseg>=2&&stress.net>0;
    return {
      id:s.id,
      name:s.name,
      family:s.family,
      version:s.version,
      mode:s.mode??'REVERSAL',
      minTradesRequired:minTrades,
      ...base,
      net15:stress.net,
      net6:low.net,
      pass
    };
  });
}
