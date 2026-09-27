const finite=Number.isFinite;

function sma(xs,p){
  const out=Array(xs.length).fill(NaN); let s=0;
  for(let i=0;i<xs.length;i++){s+=xs[i]; if(i>=p)s-=xs[i-p]; if(i>=p-1)out[i]=s/p;}
  return out;
}
function ema(xs,p){
  const out=Array(xs.length).fill(NaN),a=2/(p+1); let q=NaN;
  for(let i=0;i<xs.length;i++){q=finite(q)?a*xs[i]+(1-a)*q:xs[i]; out[i]=q;}
  return out;
}
function rma(xs,p){
  const out=Array(xs.length).fill(NaN); if(xs.length<p)return out;
  let s=0; for(let i=0;i<p;i++)s+=xs[i]; let q=s/p; out[p-1]=q;
  for(let i=p;i<xs.length;i++){q=(q*(p-1)+xs[i])/p; out[i]=q;}
  return out;
}
function tr(c){return c.map((b,i)=>i?Math.max(b.h-b.l,Math.abs(b.h-c[i-1].c),Math.abs(b.l-c[i-1].c)):b.h-b.l);}
function rsi(c,p=14){
  const close=c.map(b=>b.c),g=Array(c.length).fill(0),l=Array(c.length).fill(0);
  for(let i=1;i<c.length;i++){const d=close[i]-close[i-1];g[i]=Math.max(d,0);l[i]=Math.max(-d,0);}
  const ag=rma(g,p),al=rma(l,p),out=Array(c.length).fill(NaN);
  for(let i=0;i<c.length;i++)if(finite(ag[i])&&finite(al[i]))out[i]=al[i]===0?100:100-100/(1+ag[i]/al[i]);
  return out;
}
function prevRange(c,p){
  const hi=Array(c.length).fill(NaN),lo=Array(c.length).fill(NaN);
  for(let i=p;i<c.length;i++){let h=-Infinity,l=Infinity;for(let j=i-p;j<i;j++){h=Math.max(h,c[j].h);l=Math.min(l,c[j].l);}hi[i]=h;lo[i]=l;}
  return {hi,lo};
}
function confirmedPivots(c,left=3,right=3){
  const hi=Array(c.length).fill(NaN),lo=Array(c.length).fill(NaN); let h=NaN,l=NaN;
  for(let i=0;i<c.length;i++){
    if(i>=left+right){
      const p=i-right; let ph=true,pl=true;
      for(let j=p-left;j<=p+right;j++){if(j===p)continue;if(c[j].h>=c[p].h)ph=false;if(c[j].l<=c[p].l)pl=false;}
      if(ph)h=c[p].h;if(pl)l=c[p].l;
    }
    hi[i]=h;lo[i]=l;
  }
  return {hi,lo};
}
function priorPeriodLevels(c,keyFn){
  const hi=Array(c.length).fill(NaN),lo=Array(c.length).fill(NaN);
  let key=null,h=-Infinity,l=Infinity,ph=NaN,pl=NaN;
  for(let i=0;i<c.length;i++){
    const k=keyFn(c[i].t);
    if(key===null)key=k;
    if(k!==key){ph=h;pl=l;key=k;h=-Infinity;l=Infinity;}
    hi[i]=ph;lo[i]=pl;h=Math.max(h,c[i].h);l=Math.min(l,c[i].l);
  }
  return {hi,lo};
}
function sweepLevel(c,hi,lo,{body=false,vol=null,volMult=0,rangeAtr=null,trend=null,rsiVals=null,rsiLong=101,rsiShort=-1,wick=false}={}){
  const atr=rma(tr(c),14),sig=Array(c.length).fill(0);
  for(let i=1;i<c.length;i++){
    const a=atr[i];if(!finite(a)||a<=0)continue;
    const h=hi[i],l=lo[i];
    let L=finite(l)&&c[i].l<l-0.05*a&&c[i].c>l;
    let S=finite(h)&&c[i].h>h+0.05*a&&c[i].c<h;
    if(body){L=L&&c[i].c>c[i].o;S=S&&c[i].c<c[i].o;}
    if(vol){L=L&&c[i].v>=volMult*vol[i];S=S&&c[i].v>=volMult*vol[i];}
    if(rangeAtr){L=L&&(c[i].h-c[i].l)>=rangeAtr*a;S=S&&(c[i].h-c[i].l)>=rangeAtr*a;}
    if(trend){L=L&&c[i].c>trend[i];S=S&&c[i].c<trend[i];}
    if(rsiVals){L=L&&rsiVals[i]<=rsiLong;S=S&&rsiVals[i]>=rsiShort;}
    if(wick){
      const bodySize=Math.max(Math.abs(c[i].c-c[i].o),0.02*a);
      L=L&&(Math.min(c[i].o,c[i].c)-c[i].l)>1.5*bodySize;
      S=S&&(c[i].h-Math.max(c[i].o,c[i].c))>1.5*bodySize;
    }
    if(L)sig[i]=1;else if(S)sig[i]=-1;
  }
  return sig;
}
function rangeSweep(period,opts={}){return c=>{const {hi,lo}=prevRange(c,period);return sweepLevel(c,hi,lo,opts);};}
function priorDay(c){return priorPeriodLevels(c,t=>Math.floor(t/86400000));}
function priorWeek(c){return priorPeriodLevels(c,t=>Math.floor((t-345600000)/604800000));}
function priorMonth(c){return priorPeriodLevels(c,t=>{const d=new Date(t);return d.getUTCFullYear()*12+d.getUTCMonth();});}

function signalsPriorDay(c){const {hi,lo}=priorDay(c);return sweepLevel(c,hi,lo);}
function signalsPriorWeek(c){const {hi,lo}=priorWeek(c);return sweepLevel(c,hi,lo);}
function signalsPriorMonth(c){const {hi,lo}=priorMonth(c);return sweepLevel(c,hi,lo);}
function signalsPivotSfp(c){const {hi,lo}=confirmedPivots(c,3,3);return sweepLevel(c,hi,lo);}
function signalsPivotSfpBody(c){const {hi,lo}=confirmedPivots(c,3,3);return sweepLevel(c,hi,lo,{body:true});}
function signalsVolAbsorb(c){const {hi,lo}=prevRange(c,24),v=sma(c.map(b=>b.v),20);return sweepLevel(c,hi,lo,{vol:v,volMult:1.5});}
function signalsAtrExpansion(c){const {hi,lo}=prevRange(c,24);return sweepLevel(c,hi,lo,{rangeAtr:1.2});}
function signalsEmaTrend(c){const {hi,lo}=prevRange(c,24),e=ema(c.map(b=>b.c),50);return sweepLevel(c,hi,lo,{trend:e});}
function signalsRsiExhaust(c){const {hi,lo}=prevRange(c,24),x=rsi(c,14);return sweepLevel(c,hi,lo,{rsiVals:x,rsiLong:40,rsiShort:60});}
function signalsWickSfp(c){const {hi,lo}=prevRange(c,24);return sweepLevel(c,hi,lo,{wick:true});}
function signalsCompression(c){
  const {hi,lo}=prevRange(c,24),atr=rma(tr(c),14),sig=Array(c.length).fill(0);
  for(let i=24;i<c.length;i++){
    if(!finite(atr[i])||!finite(hi[i])||!finite(lo[i])||(hi[i]-lo[i])>4*atr[i])continue;
    if(c[i].l<lo[i]-0.05*atr[i]&&c[i].c>lo[i])sig[i]=1;
    else if(c[i].h>hi[i]+0.05*atr[i]&&c[i].c<hi[i])sig[i]=-1;
  }
  return sig;
}
function signalsMss(c){
  const {hi,lo}=prevRange(c,24),atr=rma(tr(c),14),sig=Array(c.length).fill(0);let pending=0,expires=-1,trigger=NaN;
  for(let i=24;i<c.length;i++){
    const a=atr[i];if(!finite(a)||a<=0)continue;
    if(c[i].l<lo[i]-0.05*a&&c[i].c>lo[i]){pending=1;expires=i+3;trigger=c[i].h;continue;}
    if(c[i].h>hi[i]+0.05*a&&c[i].c<hi[i]){pending=-1;expires=i+3;trigger=c[i].l;continue;}
    if(i>expires){pending=0;continue;}
    if(pending===1&&c[i].c>trigger){sig[i]=1;pending=0;}
    else if(pending===-1&&c[i].c<trigger){sig[i]=-1;pending=0;}
  }
  return sig;
}
function signalsFvgAfter(c){
  const {hi,lo}=prevRange(c,24),atr=rma(tr(c),14),sig=Array(c.length).fill(0);let pending=0,expires=-1;
  for(let i=24;i<c.length;i++){
    const a=atr[i];if(!finite(a)||a<=0)continue;
    if(c[i].l<lo[i]-0.05*a&&c[i].c>lo[i]){pending=1;expires=i+4;continue;}
    if(c[i].h>hi[i]+0.05*a&&c[i].c<hi[i]){pending=-1;expires=i+4;continue;}
    if(i>expires){pending=0;continue;}
    if(i>=2&&pending===1&&c[i].l>c[i-2].h){sig[i]=1;pending=0;}
    else if(i>=2&&pending===-1&&c[i].h<c[i-2].l){sig[i]=-1;pending=0;}
  }
  return sig;
}
function signalsFailedBreakout(c){
  const {hi,lo}=prevRange(c,24),atr=rma(tr(c),14),sig=Array(c.length).fill(0);
  for(let i=25;i<c.length;i++){
    const a=atr[i];if(!finite(a)||a<=0)continue;
    if(c[i-1].c<lo[i-1]-0.05*a&&c[i].c>lo[i])sig[i]=1;
    else if(c[i-1].c>hi[i-1]+0.05*a&&c[i].c<hi[i])sig[i]=-1;
  }
  return sig;
}
function sessionRangeSweep(c,startHour,endHour){
  const sig=Array(c.length).fill(0),atr=rma(tr(c),14);let day=null,h=-Infinity,l=Infinity,ready=false;
  for(let i=0;i<c.length;i++){
    const d=new Date(c[i].t),dk=Math.floor(c[i].t/86400000),hr=d.getUTCHours();
    if(day===null||dk!==day){day=dk;h=-Infinity;l=Infinity;ready=false;}
    if(hr>=startHour&&hr<endHour){h=Math.max(h,c[i].h);l=Math.min(l,c[i].l);continue;}
    if(hr>=endHour&&finite(h)&&finite(l))ready=true;
    if(!ready||!finite(atr[i])||atr[i]<=0)continue;
    if(c[i].l<l-0.05*atr[i]&&c[i].c>l)sig[i]=1;
    else if(c[i].h>h+0.05*atr[i]&&c[i].c<h)sig[i]=-1;
  }
  return sig;
}
const signalsAsiaSweep=c=>sessionRangeSweep(c,0,8);
const signalsOpeningRangeSweep=c=>sessionRangeSweep(c,0,1);

export const SWEEP_STRATEGIES=[
  {id:'swp_range12_reclaim',name:'Sweep Range-12 Reclaim',family:'liquidity_sweep',version:'sweep-v1',mode:'REVERSAL',signal:rangeSweep(12)},
  {id:'swp_range24_reclaim',name:'Sweep Range-24 Reclaim',family:'liquidity_sweep',version:'sweep-v1',mode:'REVERSAL',signal:rangeSweep(24)},
  {id:'swp_range48_reclaim',name:'Sweep Range-48 Reclaim',family:'liquidity_sweep',version:'sweep-v1',mode:'REVERSAL',signal:rangeSweep(48)},
  {id:'swp_range96_reclaim',name:'Sweep Range-96 Reclaim',family:'liquidity_sweep',version:'sweep-v1',mode:'REVERSAL',signal:rangeSweep(96)},
  {id:'swp_prior_day',name:'Previous-Day High/Low Sweep',family:'liquidity_sweep',version:'sweep-v1',mode:'REVERSAL',signal:signalsPriorDay},
  {id:'swp_prior_week',name:'Previous-Week High/Low Sweep',family:'liquidity_sweep',version:'sweep-v1',mode:'REVERSAL',signal:signalsPriorWeek},
  {id:'swp_prior_month',name:'Previous-Month High/Low Sweep',family:'liquidity_sweep',version:'sweep-v1',mode:'REVERSAL',signal:signalsPriorMonth},
  {id:'swp_pivot_sfp',name:'Confirmed-Pivot Swing Failure',family:'sfp',version:'sweep-v1',mode:'REVERSAL',signal:signalsPivotSfp},
  {id:'swp_pivot_sfp_body',name:'Pivot SFP + Body Confirmation',family:'sfp',version:'sweep-v1',mode:'REVERSAL',signal:signalsPivotSfpBody},
  {id:'swp_volume_absorption',name:'Sweep + Volume Absorption',family:'liquidity_volume',version:'sweep-v1',mode:'REVERSAL',signal:signalsVolAbsorb},
  {id:'swp_atr_expansion',name:'Sweep + ATR Expansion',family:'liquidity_volatility',version:'sweep-v1',mode:'REVERSAL',signal:signalsAtrExpansion},
  {id:'swp_ema50_filter',name:'Sweep + EMA50 Direction Filter',family:'liquidity_trend',version:'sweep-v1',mode:'REVERSAL',signal:signalsEmaTrend},
  {id:'swp_rsi_exhaustion',name:'Sweep + RSI Exhaustion',family:'liquidity_momentum',version:'sweep-v1',mode:'REVERSAL',signal:signalsRsiExhaust},
  {id:'swp_wick_sfp',name:'Sweep + Wick Rejection',family:'sfp',version:'sweep-v1',mode:'REVERSAL',signal:signalsWickSfp},
  {id:'swp_compression_reclaim',name:'Compression Sweep + Reclaim',family:'liquidity_volatility',version:'sweep-v1',mode:'REVERSAL',signal:signalsCompression},
  {id:'swp_mss_confirm',name:'Sweep + Micro Structure Shift',family:'liquidity_structure',version:'sweep-v1',mode:'REVERSAL',signal:signalsMss},
  {id:'swp_fvg_after',name:'Sweep + Post-Sweep FVG',family:'liquidity_fvg',version:'sweep-v1',mode:'REVERSAL',signal:signalsFvgAfter},
  {id:'swp_failed_breakout',name:'Two-Bar Failed Breakout Sweep',family:'turtle_soup',version:'sweep-v1',mode:'REVERSAL',signal:signalsFailedBreakout},
  {id:'swp_asia_range',name:'Asia Range Sweep',family:'session_liquidity',version:'sweep-v1',mode:'REVERSAL',signal:signalsAsiaSweep},
  {id:'swp_opening_range',name:'UTC Opening-Range Sweep',family:'session_liquidity',version:'sweep-v1',mode:'REVERSAL',signal:signalsOpeningRangeSweep}
];
export const SWEEP_STRATEGY_IDS=SWEEP_STRATEGIES.map(s=>s.id);
