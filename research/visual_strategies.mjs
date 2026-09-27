const finite=Number.isFinite;

function sma(xs,p){
  const out=Array(xs.length).fill(NaN); let s=0;
  for(let i=0;i<xs.length;i++){s+=xs[i];if(i>=p)s-=xs[i-p];if(i>=p-1)out[i]=s/p;}
  return out;
}
function ema(xs,p){
  const out=Array(xs.length).fill(NaN),a=2/(p+1);let q=NaN;
  for(let i=0;i<xs.length;i++){q=finite(q)?a*xs[i]+(1-a)*q:xs[i];out[i]=q;}
  return out;
}
function wma(xs,p){
  const out=Array(xs.length).fill(NaN),d=p*(p+1)/2;
  for(let i=p-1;i<xs.length;i++){let s=0,ok=true;for(let k=0;k<p;k++){const v=xs[i-p+1+k];if(!finite(v)){ok=false;break;}s+=v*(k+1);}if(ok)out[i]=s/d;}
  return out;
}
function hma(xs,p){
  const half=wma(xs,Math.max(1,Math.floor(p/2))),full=wma(xs,p);
  const diff=xs.map((_,i)=>finite(half[i])&&finite(full[i])?2*half[i]-full[i]:NaN);
  return wma(diff,Math.max(1,Math.round(Math.sqrt(p))));
}
function rma(xs,p){
  const out=Array(xs.length).fill(NaN);if(xs.length<p)return out;
  let s=0;for(let i=0;i<p;i++)s+=xs[i];let q=s/p;out[p-1]=q;
  for(let i=p;i<xs.length;i++){q=(q*(p-1)+xs[i])/p;out[i]=q;}
  return out;
}
function tr(c){return c.map((b,i)=>i?Math.max(b.h-b.l,Math.abs(b.h-c[i-1].c),Math.abs(b.l-c[i-1].c)):b.h-b.l);}
function atr(c,p=14){return rma(tr(c),p);}
function rsi(close,p=14){
  const g=Array(close.length).fill(0),l=Array(close.length).fill(0);
  for(let i=1;i<close.length;i++){const d=close[i]-close[i-1];g[i]=Math.max(d,0);l[i]=Math.max(-d,0);}
  const ag=rma(g,p),al=rma(l,p),out=Array(close.length).fill(NaN);
  for(let i=0;i<close.length;i++)if(finite(ag[i])&&finite(al[i]))out[i]=al[i]===0?100:ag[i]===0?0:100-100/(1+ag[i]/al[i]);
  return out;
}
function stdev(xs,p){
  const out=Array(xs.length).fill(NaN);
  for(let i=p-1;i<xs.length;i++){let s=0,s2=0,ok=true;for(let j=i-p+1;j<=i;j++){const v=xs[j];if(!finite(v)){ok=false;break;}s+=v;s2+=v*v;}if(ok){const m=s/p;out[i]=Math.sqrt(Math.max(0,s2/p-m*m));}}
  return out;
}
function crossUp(a0,b0,a1,b1){return [a0,b0,a1,b1].every(finite)&&a0<=b0&&a1>b1;}
function crossDn(a0,b0,a1,b1){return [a0,b0,a1,b1].every(finite)&&a0>=b0&&a1<b1;}
function highest(c,p,key='h'){
  const out=Array(c.length).fill(NaN);
  for(let i=p;i<c.length;i++){let v=-Infinity;for(let j=i-p;j<i;j++)v=Math.max(v,c[j][key]);out[i]=v;}
  return out;
}
function lowest(c,p,key='l'){
  const out=Array(c.length).fill(NaN);
  for(let i=p;i<c.length;i++){let v=Infinity;for(let j=i-p;j<i;j++)v=Math.min(v,c[j][key]);out[i]=v;}
  return out;
}
function macd(close,fast=12,slow=26,signal=9){
  const ef=ema(close,fast),es=ema(close,slow),m=close.map((_,i)=>finite(ef[i])&&finite(es[i])?ef[i]-es[i]:NaN),s=ema(m,signal);
  return {m,s,h:m.map((v,i)=>finite(v)&&finite(s[i])?v-s[i]:NaN)};
}
function stochastic(c,p=14,smooth=3){
  const k=Array(c.length).fill(NaN);
  for(let i=p-1;i<c.length;i++){let h=-Infinity,l=Infinity;for(let j=i-p+1;j<=i;j++){h=Math.max(h,c[j].h);l=Math.min(l,c[j].l);}k[i]=h===l?50:100*(c[i].c-l)/(h-l);}
  return {k,d:sma(k,smooth)};
}
function supertrend(c,p=10,mult=3){
  const a=atr(c,p),hl2=c.map(b=>(b.h+b.l)/2),up=Array(c.length).fill(NaN),dn=Array(c.length).fill(NaN),trend=Array(c.length).fill(1),line=Array(c.length).fill(NaN);
  for(let i=0;i<c.length;i++){
    if(!finite(a[i]))continue;
    let u=hl2[i]+mult*a[i],d=hl2[i]-mult*a[i];
    if(i&&finite(up[i-1]))u=(u<up[i-1]||c[i-1].c>up[i-1])?u:up[i-1];
    if(i&&finite(dn[i-1]))d=(d>dn[i-1]||c[i-1].c<dn[i-1])?d:dn[i-1];
    up[i]=u;dn[i]=d;
    if(i){
      trend[i]=trend[i-1];
      if(trend[i-1]===-1&&c[i].c>up[i-1])trend[i]=1;
      else if(trend[i-1]===1&&c[i].c<dn[i-1])trend[i]=-1;
    }
    line[i]=trend[i]===1?dn[i]:up[i];
  }
  return {trend,line};
}
function adx(c,p=14){
  const n=c.length,plus=Array(n).fill(0),minus=Array(n).fill(0),trs=tr(c);
  for(let i=1;i<n;i++){const up=c[i].h-c[i-1].h,dn=c[i-1].l-c[i].l;plus[i]=up>dn&&up>0?up:0;minus[i]=dn>up&&dn>0?dn:0;}
  const atrR=rma(trs,p),pr=rma(plus,p),mr=rma(minus,p),pdi=Array(n).fill(NaN),mdi=Array(n).fill(NaN),dx=Array(n).fill(NaN);
  for(let i=0;i<n;i++)if(finite(atrR[i])&&atrR[i]>0){pdi[i]=100*pr[i]/atrR[i];mdi[i]=100*mr[i]/atrR[i];const den=pdi[i]+mdi[i];dx[i]=den?100*Math.abs(pdi[i]-mdi[i])/den:0;}
  return {adx:rma(dx,p),pdi,mdi};
}
function roc(close,p){return close.map((v,i)=>i>=p&&close[i-p]!==0?100*(v/close[i-p]-1):NaN);}
function linWeightedKernel(close,band=20){
  const out=Array(close.length).fill(NaN);
  for(let i=band-1;i<close.length;i++){let sw=0,s=0;for(let k=0;k<band;k++){const w=Math.exp(-(k*k)/(2*(band/3)*(band/3)));sw+=w;s+=w*close[i-k];}out[i]=s/sw;}
  return out;
}

function sigBollRsi(c){
  const close=c.map(b=>b.c),mid=sma(close,20),sd=stdev(close,20),x=rsi(close,14),sig=Array(c.length).fill(0);
  for(let i=1;i<c.length;i++){if(![mid[i],sd[i],x[i]].every(finite))continue;const lo=mid[i]-2*sd[i],hi=mid[i]+2*sd[i];if(c[i].c<lo&&x[i]<30)sig[i]=1;else if(c[i].c>hi&&x[i]>70)sig[i]=-1;}
  return sig;
}
function sigMacdSma200(c){
  const close=c.map(b=>b.c),m=macd(close),ma=sma(close,200),sig=Array(c.length).fill(0);
  for(let i=1;i<c.length;i++){if(!finite(ma[i]))continue;if(crossUp(m.m[i-1],m.s[i-1],m.m[i],m.s[i])&&close[i]>ma[i])sig[i]=1;else if(crossDn(m.m[i-1],m.s[i-1],m.m[i],m.s[i])&&close[i]<ma[i])sig[i]=-1;}
  return sig;
}
function sigSupertrend(c){
  const st=supertrend(c,10,3),sig=Array(c.length).fill(0);
  for(let i=1;i<c.length;i++){if(st.trend[i]!==st.trend[i-1])sig[i]=st.trend[i];}
  return sig;
}
function sigMacdRsi(c){
  const close=c.map(b=>b.c),m=macd(close),x=rsi(close,14),sig=Array(c.length).fill(0);
  for(let i=1;i<c.length;i++){if(crossUp(m.m[i-1],m.s[i-1],m.m[i],m.s[i])&&x[i]>50)sig[i]=1;else if(crossDn(m.m[i-1],m.s[i-1],m.m[i],m.s[i])&&x[i]<50)sig[i]=-1;}
  return sig;
}
function sigHull(c){
  const close=c.map(b=>b.c),h=hma(close,55),sig=Array(c.length).fill(0);
  for(let i=2;i<c.length;i++){if(![h[i],h[i-1],h[i-2]].every(finite))continue;if(h[i]>h[i-1]&&h[i-1]<=h[i-2])sig[i]=1;else if(h[i]<h[i-1]&&h[i-1]>=h[i-2])sig[i]=-1;}
  return sig;
}
function sigEmaCross(c){
  const close=c.map(b=>b.c),a=ema(close,9),b=ema(close,21),sig=Array(c.length).fill(0);
  for(let i=1;i<c.length;i++){if(crossUp(a[i-1],b[i-1],a[i],b[i]))sig[i]=1;else if(crossDn(a[i-1],b[i-1],a[i],b[i]))sig[i]=-1;}
  return sig;
}
function sigGolden(c){
  const close=c.map(b=>b.c),a=sma(close,50),b=sma(close,200),sig=Array(c.length).fill(0);
  for(let i=1;i<c.length;i++){if(crossUp(a[i-1],b[i-1],a[i],b[i]))sig[i]=1;else if(crossDn(a[i-1],b[i-1],a[i],b[i]))sig[i]=-1;}
  return sig;
}
function sigFractalBreak(c){
  const hi=highest(c,5),lo=lowest(c,5),sig=Array(c.length).fill(0);
  for(let i=1;i<c.length;i++){if(finite(hi[i])&&c[i-1].c<=hi[i]&&c[i].c>hi[i])sig[i]=1;else if(finite(lo[i])&&c[i-1].c>=lo[i]&&c[i].c<lo[i])sig[i]=-1;}
  return sig;
}
function sigMacdStoch(c){
  const close=c.map(b=>b.c),m=macd(close),s=stochastic(c,14,3),sig=Array(c.length).fill(0);
  for(let i=1;i<c.length;i++){if(crossUp(m.m[i-1],m.s[i-1],m.m[i],m.s[i])&&s.k[i]<35)sig[i]=1;else if(crossDn(m.m[i-1],m.s[i-1],m.m[i],m.s[i])&&s.k[i]>65)sig[i]=-1;}
  return sig;
}
function sigEmaSlope(c){
  const close=c.map(b=>b.c),f=ema(close,20),s=ema(close,50),sig=Array(c.length).fill(0);
  for(let i=2;i<c.length;i++){if(crossUp(f[i-1],s[i-1],f[i],s[i])&&s[i]>s[i-1])sig[i]=1;else if(crossDn(f[i-1],s[i-1],f[i],s[i])&&s[i]<s[i-1])sig[i]=-1;}
  return sig;
}
function sigSqueeze(c){
  const close=c.map(b=>b.c),mid=sma(close,20),sd=stdev(close,20),a=atr(c,20),mom=close.map((v,i)=>i>=12?v-close[i-12]:NaN),sig=Array(c.length).fill(0);
  for(let i=1;i<c.length;i++){if(![mid[i],sd[i],a[i],mom[i],mom[i-1]].every(finite))continue;const squeeze=2*sd[i]<1.5*a[i];if(!squeeze&&mom[i]>0&&mom[i-1]<=0)sig[i]=1;else if(!squeeze&&mom[i]<0&&mom[i-1]>=0)sig[i]=-1;}
  return sig;
}
function sigAdxDi(c){
  const d=adx(c,14),sig=Array(c.length).fill(0);
  for(let i=1;i<c.length;i++){if(!finite(d.adx[i])||d.adx[i]<20)continue;if(crossUp(d.pdi[i-1],d.mdi[i-1],d.pdi[i],d.mdi[i]))sig[i]=1;else if(crossDn(d.pdi[i-1],d.mdi[i-1],d.pdi[i],d.mdi[i]))sig[i]=-1;}
  return sig;
}
function sigCoppock(c){
  const close=c.map(b=>b.c),r14=roc(close,14),r11=roc(close,11),r=r14.map((v,i)=>finite(v)&&finite(r11[i])?v+r11[i]:NaN),cp=wma(r,10),sig=Array(c.length).fill(0);
  for(let i=2;i<c.length;i++){if(![cp[i],cp[i-1],cp[i-2]].every(finite))continue;if(cp[i]>cp[i-1]&&cp[i-1]<=cp[i-2])sig[i]=1;else if(cp[i]<cp[i-1]&&cp[i-1]>=cp[i-2])sig[i]=-1;}
  return sig;
}
function sigRsi(c){
  const x=rsi(c.map(b=>b.c),14),sig=Array(c.length).fill(0);
  for(let i=1;i<c.length;i++){if(x[i-1]<=30&&x[i]>30)sig[i]=1;else if(x[i-1]>=70&&x[i]<70)sig[i]=-1;}
  return sig;
}
function sigBbMean(c){
  const close=c.map(b=>b.c),mid=sma(close,20),sd=stdev(close,20),sig=Array(c.length).fill(0);
  for(let i=1;i<c.length;i++){if(!finite(mid[i])||!finite(sd[i]))continue;const lo=mid[i]-2*sd[i],hi=mid[i]+2*sd[i];if(close[i-1]<lo&&close[i]>=lo)sig[i]=1;else if(close[i-1]>hi&&close[i]<=hi)sig[i]=-1;}
  return sig;
}
function sigVixFix(c){
  const close=c.map(b=>b.c),hh=highest(c,22,'c'),wvf=Array(c.length).fill(NaN),sig=Array(c.length).fill(0);
  for(let i=0;i<c.length;i++)if(finite(hh[i])&&hh[i]>0)wvf[i]=100*(hh[i]-c[i].l)/hh[i];
  const ma=sma(wvf,20),sd=stdev(wvf,20);
  for(let i=1;i<c.length;i++){if(![wvf[i],ma[i],sd[i]].every(finite))continue;const band=ma[i]+2*sd[i];if(wvf[i-1]>band&&wvf[i]<=band)sig[i]=1;else if(wvf[i]>band&&c[i].c<c[i].o)sig[i]=-1;}
  return sig;
}
function sigSrBreak(c){
  const hi=highest(c,50),lo=lowest(c,50),sig=Array(c.length).fill(0);
  for(let i=1;i<c.length;i++){if(finite(hi[i])&&c[i].c>hi[i])sig[i]=1;else if(finite(lo[i])&&c[i].c<lo[i])sig[i]=-1;}
  return sig;
}
function sigHighVolBox(c){
  const hi=highest(c,20),lo=lowest(c,20),v=sma(c.map(b=>b.v),20),sig=Array(c.length).fill(0);
  for(let i=1;i<c.length;i++){if(!finite(v[i])||c[i].v<1.8*v[i])continue;if(finite(hi[i])&&c[i].c>hi[i])sig[i]=1;else if(finite(lo[i])&&c[i].c<lo[i])sig[i]=-1;}
  return sig;
}
function sigAutoRange(c){
  const hi=highest(c,30),lo=lowest(c,30),a=atr(c,14),sig=Array(c.length).fill(0);
  for(let i=1;i<c.length;i++){if(![hi[i],lo[i],a[i]].every(finite))continue;if((hi[i]-lo[i])>6*a[i])continue;if(c[i].c>hi[i])sig[i]=1;else if(c[i].c<lo[i])sig[i]=-1;}
  return sig;
}
function sigFibBb(c){
  const close=c.map(b=>b.c),mid=sma(close,20),sd=stdev(close,20),sig=Array(c.length).fill(0);
  for(let i=1;i<c.length;i++){if(!finite(mid[i])||!finite(sd[i]))continue;const up=mid[i]+1.618*sd[i],dn=mid[i]-1.618*sd[i];if(close[i-1]<=up&&close[i]>up)sig[i]=1;else if(close[i-1]>=dn&&close[i]<dn)sig[i]=-1;}
  return sig;
}
function sigIchimokuHull(c){
  const convH=highest(c,9),convL=lowest(c,9),baseH=highest(c,26),baseL=lowest(c,26),h=hma(c.map(b=>b.c),55),sig=Array(c.length).fill(0);
  for(let i=1;i<c.length;i++){const ten=(convH[i]+convL[i])/2,kij=(baseH[i]+baseL[i])/2;if(![ten,kij,h[i],h[i-1]].every(finite))continue;if(ten>kij&&c[i].c>h[i]&&h[i]>h[i-1])sig[i]=1;else if(ten<kij&&c[i].c<h[i]&&h[i]<h[i-1])sig[i]=-1;}
  return sig;
}
function sigOpenClose(c){
  const o=ema(c.map(b=>b.o),5),cl=ema(c.map(b=>b.c),5),sig=Array(c.length).fill(0);
  for(let i=1;i<c.length;i++){if(crossUp(cl[i-1],o[i-1],cl[i],o[i]))sig[i]=1;else if(crossDn(cl[i-1],o[i-1],cl[i],o[i]))sig[i]=-1;}
  return sig;
}
function sigCandles(c){
  const sig=Array(c.length).fill(0);
  for(let i=1;i<c.length;i++){const b0=c[i-1],b=c[i];const bullEng=b.c>b.o&&b0.c<b0.o&&b.o<=b0.c&&b.c>=b0.o;const bearEng=b.c<b.o&&b0.c>b0.o&&b.o>=b0.c&&b.c<=b0.o;if(bullEng)sig[i]=1;else if(bearEng)sig[i]=-1;}
  return sig;
}
function sigTma(c){
  const close=c.map(b=>b.c),a=sma(close,10),b=sma(a,10),sd=stdev(close,20),sig=Array(c.length).fill(0);
  for(let i=1;i<c.length;i++){if(![b[i],sd[i]].every(finite))continue;const lo=b[i]-1.5*sd[i],hi=b[i]+1.5*sd[i];if(close[i-1]<lo&&close[i]>=lo)sig[i]=1;else if(close[i-1]>hi&&close[i]<=hi)sig[i]=-1;}
  return sig;
}
function sigScalper(c){
  const close=c.map(b=>b.c),f=ema(close,8),s=ema(close,21),x=rsi(close,7),a=atr(c,7),sig=Array(c.length).fill(0);
  for(let i=1;i<c.length;i++){if(![f[i],s[i],x[i],a[i]].every(finite))continue;if(crossUp(f[i-1],s[i-1],f[i],s[i])&&x[i]>55&&(c[i].h-c[i].l)>0.5*a[i])sig[i]=1;else if(crossDn(f[i-1],s[i-1],f[i],s[i])&&x[i]<45&&(c[i].h-c[i].l)>0.5*a[i])sig[i]=-1;}
  return sig;
}
function sigNW(c){
  const close=c.map(b=>b.c),k=linWeightedKernel(close,30),sd=stdev(close.map((v,i)=>finite(k[i])?v-k[i]:NaN),30),sig=Array(c.length).fill(0);
  for(let i=1;i<c.length;i++){if(![k[i],sd[i]].every(finite))continue;const lo=k[i]-2*sd[i],hi=k[i]+2*sd[i];if(close[i-1]<lo&&close[i]>=lo)sig[i]=1;else if(close[i-1]>hi&&close[i]<=hi)sig[i]=-1;}
  return sig;
}
function sigVolDelta(c){
  const vd=c.map(b=>(b.c>=b.o?1:-1)*b.v),m=sma(vd,20),sig=Array(c.length).fill(0);
  for(let i=1;i<c.length;i++){if(!finite(m[i]))continue;if(vd[i]>2*Math.abs(m[i])&&c[i].c>c[i].o)sig[i]=1;else if(vd[i]<-2*Math.abs(m[i])&&c[i].c<c[i].o)sig[i]=-1;}
  return sig;
}
function sigStructVwap(c){
  const sig=Array(c.length).fill(0),a=atr(c,14);let pv=0,v=0,vwap=NaN,anchor=-1;
  for(let i=0;i<c.length;i++){
    if(i>=20){let hh=-Infinity,ll=Infinity;for(let j=i-20;j<i;j++){hh=Math.max(hh,c[j].h);ll=Math.min(ll,c[j].l);}if(c[i].c>hh||c[i].c<ll){anchor=i;pv=0;v=0;}}
    if(anchor<0)continue;const tp=(c[i].h+c[i].l+c[i].c)/3;pv+=tp*c[i].v;v+=c[i].v;vwap=v?pv/v:NaN;
    if(i&&finite(vwap)&&finite(a[i])){if(c[i-1].c<=vwap&&c[i].c>vwap+0.05*a[i])sig[i]=1;else if(c[i-1].c>=vwap&&c[i].c<vwap-0.05*a[i])sig[i]=-1;}
  }
  return sig;
}

export const VISUAL_STRATEGIES=[
  {id:'vis_bollinger_rsi_double',name:'Bollinger + RSI Double — Derived Adapter',family:'mean_reversion',version:'visual-derived-v1',mode:'REVERSAL',signal:sigBollRsi},
  {id:'vis_macd_sma200',name:'MACD + SMA200 — Derived Adapter',family:'trend_momentum',version:'visual-derived-v1',mode:'REVERSAL',signal:sigMacdSma200},
  {id:'vis_supertrend_10_3',name:'SuperTrend 10/3 — Derived Adapter',family:'trend_atr',version:'visual-derived-v1',mode:'REVERSAL',signal:sigSupertrend},
  {id:'vis_macd_rsi',name:'MACD + RSI — Derived Adapter',family:'momentum',version:'visual-derived-v1',mode:'REVERSAL',signal:sigMacdRsi},
  {id:'vis_hull_suite',name:'Hull Suite — Derived Adapter',family:'trend',version:'visual-derived-v1',mode:'REVERSAL',signal:sigHull},
  {id:'vis_ema_cross_9_21',name:'Single EMA Cross 9/21 — Derived Adapter',family:'trend',version:'visual-derived-v1',mode:'REVERSAL',signal:sigEmaCross},
  {id:'vis_golden_cross_50_200',name:'Golden Cross SMA50/200 — Derived Adapter',family:'trend',version:'visual-derived-v1',mode:'REVERSAL',signal:sigGolden},
  {id:'vis_fractal_breakout',name:'Fractal Breakout — Derived Adapter',family:'breakout',version:'visual-derived-v1',mode:'REVERSAL',signal:sigFractalBreak},
  {id:'vis_macd_stoch',name:'MACD + Stochastic — Derived Adapter',family:'momentum',version:'visual-derived-v1',mode:'REVERSAL',signal:sigMacdStoch},
  {id:'vis_ema_slope_cross',name:'EMA Slope + EMA Cross — Derived Adapter',family:'trend',version:'visual-derived-v1',mode:'REVERSAL',signal:sigEmaSlope},
  {id:'vis_squeeze_momentum',name:'Squeeze Momentum — Derived Adapter',family:'volatility_momentum',version:'visual-derived-v1',mode:'REVERSAL',signal:sigSqueeze},
  {id:'vis_adx_di',name:'ADX + DI — Derived Adapter',family:'trend_strength',version:'visual-derived-v1',mode:'REVERSAL',signal:sigAdxDi},
  {id:'vis_coppock',name:'Coppock Curve — Derived Adapter',family:'momentum',version:'visual-derived-v1',mode:'REVERSAL',signal:sigCoppock},
  {id:'vis_rsi_entries',name:'RSI Signals Entries — Derived Adapter',family:'momentum',version:'visual-derived-v1',mode:'REVERSAL',signal:sigRsi},
  {id:'vis_bb_mean_reversion',name:'Bollinger Mean Reversion — Derived Adapter',family:'mean_reversion',version:'visual-derived-v1',mode:'REVERSAL',signal:sigBbMean},
  {id:'vis_vixfix_reversal',name:'Williams Vix Fix Reversal — Derived Adapter',family:'volatility',version:'visual-derived-v1',mode:'REVERSAL',signal:sigVixFix},
  {id:'vis_sr_breaks',name:'Support & Resistance Breaks — Derived Adapter',family:'breakout',version:'visual-derived-v1',mode:'REVERSAL',signal:sigSrBreak},
  {id:'vis_high_volume_box',name:'High Volume Boxes — Derived Adapter',family:'volume_breakout',version:'visual-derived-v1',mode:'REVERSAL',signal:sigHighVolBox},
  {id:'vis_auto_range_breakout',name:'Auto Range Detector Breakout — Derived Adapter',family:'range_breakout',version:'visual-derived-v1',mode:'REVERSAL',signal:sigAutoRange},
  {id:'vis_fibonacci_bb',name:'Fibonacci Bollinger Bands — Derived Adapter',family:'volatility_breakout',version:'visual-derived-v1',mode:'REVERSAL',signal:sigFibBb},
  {id:'vis_ichimoku_hull',name:'Ichimoku + Hull — Derived Adapter',family:'trend_filter',version:'visual-derived-v1',mode:'REVERSAL',signal:sigIchimokuHull},
  {id:'vis_open_close_cross',name:'Open Close Cross — Derived Adapter',family:'price_action_trend',version:'visual-derived-v1',mode:'REVERSAL',signal:sigOpenClose},
  {id:'vis_candlestick_reversal',name:'Candlestick Reversal Patterns — Derived Adapter',family:'price_action',version:'visual-derived-v1',mode:'REVERSAL',signal:sigCandles},
  {id:'vis_tma_overlay',name:'TMA Overlay Reversal — Derived Adapter',family:'mean_reversion',version:'visual-derived-v1',mode:'REVERSAL',signal:sigTma},
  {id:'vis_super_scalper',name:'Super Scalper 5m/15m — Derived Adapter',family:'scalping',version:'visual-derived-v1',mode:'REVERSAL',signal:sigScalper},
  {id:'vis_nadaraya_watson',name:'Nadaraya-Watson Envelope — Causal Derived Adapter',family:'statistical_mean_reversion',version:'visual-derived-v1',mode:'REVERSAL',signal:sigNW},
  {id:'vis_volume_delta_pivot',name:'Volume Delta Pivot Matrix — Derived Adapter',family:'volume_orderflow',version:'visual-derived-v1',mode:'REVERSAL',signal:sigVolDelta},
  {id:'vis_structure_vwap',name:'Structure-Anchored VWAP — Derived Adapter',family:'vwap',version:'visual-derived-v1',mode:'REVERSAL',signal:sigStructVwap}
];

export const VISUAL_STRATEGY_IDS=VISUAL_STRATEGIES.map(s=>s.id);
