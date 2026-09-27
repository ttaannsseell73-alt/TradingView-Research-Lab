const finite = Number.isFinite;

function mean(xs){ return xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:0; }

function sma(xs,p){
  const out=Array(xs.length).fill(NaN);
  let s=0;
  for(let i=0;i<xs.length;i++){
    s+=xs[i];
    if(i>=p) s-=xs[i-p];
    if(i>=p-1) out[i]=s/p;
  }
  return out;
}

function rma(xs,p){
  const out=Array(xs.length).fill(NaN);
  if(xs.length<p) return out;
  let s=0;
  for(let i=0;i<p;i++) s+=xs[i];
  let q=s/p; out[p-1]=q;
  for(let i=p;i<xs.length;i++){ q=(q*(p-1)+xs[i])/p; out[i]=q; }
  return out;
}

function trueRange(c){
  return c.map((b,i)=>i?Math.max(b.h-b.l,Math.abs(b.h-c[i-1].c),Math.abs(b.l-c[i-1].c)):b.h-b.l);
}

function previousRange(c,period){
  const high=Array(c.length).fill(NaN),low=Array(c.length).fill(NaN);
  const hiQ=[],loQ=[];
  for(let i=0;i<c.length;i++){
    while(hiQ.length&&hiQ[0]<=i-period-1) hiQ.shift();
    while(loQ.length&&loQ[0]<=i-period-1) loQ.shift();
    if(i>0){
      const j=i-1;
      while(hiQ.length&&c[hiQ.at(-1)].h<=c[j].h) hiQ.pop();
      while(loQ.length&&c[loQ.at(-1)].l>=c[j].l) loQ.pop();
      hiQ.push(j);loQ.push(j);
    }
    if(i>=period&&hiQ.length&&loQ.length){
      high[i]=c[hiQ[0]].h; low[i]=c[loQ[0]].l;
    }
  }
  return {high,low};
}

function confirmedPivots(c,left=3,right=3){
  const highs=[],lows=[];
  const highLevel=Array(c.length).fill(NaN),lowLevel=Array(c.length).fill(NaN);
  let lastH=NaN,lastL=NaN;
  for(let i=0;i<c.length;i++){
    if(i>=left+right){
      const p=i-right;
      let ph=true,pl=true;
      for(let j=p-left;j<=p+right;j++){
        if(j===p) continue;
        if(c[j].h>=c[p].h) ph=false;
        if(c[j].l<=c[p].l) pl=false;
      }
      if(ph){ lastH=c[p].h; highs.push({pivotIndex:p,confirmedIndex:i,price:c[p].h}); }
      if(pl){ lastL=c[p].l; lows.push({pivotIndex:p,confirmedIndex:i,price:c[p].l}); }
    }
    highLevel[i]=lastH; lowLevel[i]=lastL;
  }
  return {highs,lows,highLevel,lowLevel};
}

function utcDayKey(t){ return Math.floor(t/86_400_000); }
function utcWeekKey(t){
  const d=new Date(t);
  const day=(d.getUTCDay()+6)%7;
  return Math.floor((Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate())-day*86_400_000)/(7*86_400_000));
}
function utcMonthKey(t){ const d=new Date(t); return d.getUTCFullYear()*12+d.getUTCMonth(); }

function priorPeriodLevels(c,keyFn){
  const high=Array(c.length).fill(NaN),low=Array(c.length).fill(NaN),close=Array(c.length).fill(NaN);
  let key=null,h=-Infinity,l=Infinity,lastClose=NaN,ph=NaN,pl=NaN,pc=NaN;
  for(let i=0;i<c.length;i++){
    const k=keyFn(c[i].t);
    if(key===null) key=k;
    if(k!==key){
      ph=h;pl=l;pc=lastClose;
      key=k;h=-Infinity;l=Infinity;lastClose=NaN;
    }
    high[i]=ph;low[i]=pl;close[i]=pc;
    h=Math.max(h,c[i].h); l=Math.min(l,c[i].l); lastClose=c[i].c;
  }
  return {high,low,close};
}

function sessionProfiles(c,bins=24){
  const poc=Array(c.length).fill(NaN),vah=Array(c.length).fill(NaN),val=Array(c.length).fill(NaN);
  let day=null,start=0,prev=null;
  const build=(a,b)=>{
    if(b<=a) return null;
    let lo=Infinity,hi=-Infinity;
    for(let i=a;i<b;i++){lo=Math.min(lo,c[i].l);hi=Math.max(hi,c[i].h);}
    if(!finite(lo)||!finite(hi)||hi<=lo) return {poc:(hi+lo)/2,vah:hi,val:lo};
    const step=(hi-lo)/bins,vol=Array(bins).fill(0);
    for(let i=a;i<b;i++){
      const tp=(c[i].h+c[i].l+c[i].c)/3;
      const ix=Math.max(0,Math.min(bins-1,Math.floor((tp-lo)/step)));
      vol[ix]+=Math.max(0,c[i].v);
    }
    let pocIx=0;
    for(let i=1;i<bins;i++) if(vol[i]>vol[pocIx]) pocIx=i;
    const total=vol.reduce((a,x)=>a+x,0),order=[...Array(bins).keys()].sort((a,b)=>vol[b]-vol[a]);
    let acc=0,loIx=pocIx,hiIx=pocIx;
    for(const ix of order){
      if(total>0&&acc/total>=0.70) break;
      acc+=vol[ix];loIx=Math.min(loIx,ix);hiIx=Math.max(hiIx,ix);
    }
    return {
      poc:lo+(pocIx+0.5)*step,
      val:lo+loIx*step,
      vah:lo+(hiIx+1)*step,
    };
  };
  for(let i=0;i<c.length;i++){
    const d=utcDayKey(c[i].t);
    if(day===null){day=d;start=i;}
    if(d!==day){prev=build(start,i);day=d;start=i;}
    if(prev){poc[i]=prev.poc;vah[i]=prev.vah;val[i]=prev.val;}
  }
  return {poc,vah,val};
}

function candleBody(b){ return Math.abs(b.c-b.o); }
function candleRange(b){ return Math.max(1e-12,b.h-b.l); }

function signalsFractalClusterZone(c){
  const piv=confirmedPivots(c,2,2),atr=rma(trueRange(c),14),sig=Array(c.length).fill(0);
  const activeH=[],activeL=[];
  let hiPtr=0,loPtr=0;
  for(let i=0;i<c.length;i++){
    while(hiPtr<piv.highs.length&&piv.highs[hiPtr].confirmedIndex===i){activeH.push(piv.highs[hiPtr++]);if(activeH.length>24)activeH.shift();}
    while(loPtr<piv.lows.length&&piv.lows[loPtr].confirmedIndex===i){activeL.push(piv.lows[loPtr++]);if(activeL.length>24)activeL.shift();}
    const a=atr[i]; if(!finite(a)||a<=0) continue;
    const nearL=activeL.filter(x=>Math.abs(x.price-c[i].l)<=0.35*a);
    const nearH=activeH.filter(x=>Math.abs(x.price-c[i].h)<=0.35*a);
    if(nearL.length>=2&&c[i].c>c[i].o&&c[i].c>mean(nearL.map(x=>x.price))) sig[i]=1;
    else if(nearH.length>=2&&c[i].c<c[i].o&&c[i].c<mean(nearH.map(x=>x.price))) sig[i]=-1;
  }
  return sig;
}

function signalsConfirmedPivotBreakout(c){
  const {highLevel,lowLevel}=confirmedPivots(c,3,3),atr=rma(trueRange(c),14),sig=Array(c.length).fill(0);
  for(let i=1;i<c.length;i++){
    const a=atr[i];if(!finite(a)||a<=0)continue;
    const h=highLevel[i],l=lowLevel[i];
    if(finite(h)&&c[i-1].c<=h&&c[i].c>h+0.10*a) sig[i]=1;
    else if(finite(l)&&c[i-1].c>=l&&c[i].c<l-0.10*a) sig[i]=-1;
  }
  return sig;
}

function signalsBreakoutRetest(c){
  const {highLevel,lowLevel}=confirmedPivots(c,3,3),atr=rma(trueRange(c),14),sig=Array(c.length).fill(0);
  let dir=0,level=NaN,expires=-1;
  for(let i=1;i<c.length;i++){
    const a=atr[i];if(!finite(a)||a<=0)continue;
    if(finite(highLevel[i])&&c[i-1].c<=highLevel[i]&&c[i].c>highLevel[i]+0.10*a){dir=1;level=highLevel[i];expires=i+12;continue;}
    if(finite(lowLevel[i])&&c[i-1].c>=lowLevel[i]&&c[i].c<lowLevel[i]-0.10*a){dir=-1;level=lowLevel[i];expires=i+12;continue;}
    if(i>expires){dir=0;continue;}
    if(dir===1&&c[i].l<=level+0.18*a&&c[i].c>level&&c[i].c>c[i].o){sig[i]=1;dir=0;}
    else if(dir===-1&&c[i].h>=level-0.18*a&&c[i].c<level&&c[i].c<c[i].o){sig[i]=-1;dir=0;}
  }
  return sig;
}

function signalsRoleReversal(c){
  const {highLevel,lowLevel}=confirmedPivots(c,3,3),atr=rma(trueRange(c),14),sig=Array(c.length).fill(0);
  let role=0,level=NaN,expires=-1;
  for(let i=1;i<c.length;i++){
    const a=atr[i];if(!finite(a)||a<=0)continue;
    if(finite(highLevel[i])&&c[i-1].c<=highLevel[i]&&c[i].c>highLevel[i]+0.08*a){role=1;level=highLevel[i];expires=i+18;continue;}
    if(finite(lowLevel[i])&&c[i-1].c>=lowLevel[i]&&c[i].c<lowLevel[i]-0.08*a){role=-1;level=lowLevel[i];expires=i+18;continue;}
    if(i>expires){role=0;continue;}
    if(role===1&&c[i].l<=level+0.10*a&&c[i].c>=level+0.03*a){sig[i]=1;role=0;}
    else if(role===-1&&c[i].h>=level-0.10*a&&c[i].c<=level-0.03*a){sig[i]=-1;role=0;}
  }
  return sig;
}

function signalsWickConfirmedZone(c){
  const {highLevel,lowLevel}=confirmedPivots(c,3,3),atr=rma(trueRange(c),14),sig=Array(c.length).fill(0);
  for(let i=1;i<c.length;i++){
    const a=atr[i];if(!finite(a)||a<=0)continue;
    const body=Math.max(candleBody(c[i]),0.02*a);
    const lw=Math.min(c[i].o,c[i].c)-c[i].l,uw=c[i].h-Math.max(c[i].o,c[i].c);
    if(finite(lowLevel[i])&&Math.abs(c[i].l-lowLevel[i])<=0.25*a&&lw>=1.5*body&&c[i].c>lowLevel[i]) sig[i]=1;
    else if(finite(highLevel[i])&&Math.abs(c[i].h-highLevel[i])<=0.25*a&&uw>=1.5*body&&c[i].c<highLevel[i]) sig[i]=-1;
  }
  return sig;
}

function signalsLiquiditySweep(c){
  const {high,low}=previousRange(c,24),atr=rma(trueRange(c),14),sig=Array(c.length).fill(0);
  for(let i=24;i<c.length;i++){
    const a=atr[i];if(!finite(a)||a<=0)continue;
    if(c[i].l<low[i]-0.05*a&&c[i].c>low[i]) sig[i]=1;
    else if(c[i].h>high[i]+0.05*a&&c[i].c<high[i]) sig[i]=-1;
  }
  return sig;
}

function signalsLiquidityAbsorption(c){
  const {high,low}=previousRange(c,24),atr=rma(trueRange(c),14),vol=sma(c.map(b=>b.v),20),sig=Array(c.length).fill(0);
  for(let i=24;i<c.length;i++){
    const a=atr[i],v=vol[i];if(!finite(a)||a<=0||!finite(v)||v<=0)continue;
    const absorption=c[i].v>=1.5*v&&candleBody(c[i])/candleRange(c[i])<=0.55;
    if(absorption&&c[i].l<low[i]-0.05*a&&c[i].c>low[i]) sig[i]=1;
    else if(absorption&&c[i].h>high[i]+0.05*a&&c[i].c<high[i]) sig[i]=-1;
  }
  return sig;
}

function signalsPreviousDaySweep(c){
  const p=priorPeriodLevels(c,utcDayKey),atr=rma(trueRange(c),14),sig=Array(c.length).fill(0);
  for(let i=1;i<c.length;i++){
    const a=atr[i];if(!finite(a)||a<=0)continue;
    if(finite(p.low[i])&&c[i].l<p.low[i]-0.05*a&&c[i].c>p.low[i]) sig[i]=1;
    else if(finite(p.high[i])&&c[i].h>p.high[i]+0.05*a&&c[i].c<p.high[i]) sig[i]=-1;
  }
  return sig;
}

function signalsPrevWeekMonthSweep(c){
  const w=priorPeriodLevels(c,utcWeekKey),m=priorPeriodLevels(c,utcMonthKey),atr=rma(trueRange(c),14),sig=Array(c.length).fill(0);
  for(let i=1;i<c.length;i++){
    const a=atr[i];if(!finite(a)||a<=0)continue;
    const lows=[w.low[i],m.low[i]].filter(finite),highs=[w.high[i],m.high[i]].filter(finite);
    if(lows.some(x=>c[i].l<x-0.04*a&&c[i].c>x)) sig[i]=1;
    else if(highs.some(x=>c[i].h>x+0.04*a&&c[i].c<x)) sig[i]=-1;
  }
  return sig;
}

function signalsLSOB(c){
  const {high,low}=previousRange(c,24),atr=rma(trueRange(c),14),sig=Array(c.length).fill(0);
  let sweep=0,sweepIx=-1,zoneLo=NaN,zoneHi=NaN,dir=0,expires=-1;
  for(let i=24;i<c.length;i++){
    const a=atr[i];if(!finite(a)||a<=0)continue;
    if(sweep===0){
      if(c[i].l<low[i]-0.05*a&&c[i].c>low[i]){sweep=1;sweepIx=i;}
      else if(c[i].h>high[i]+0.05*a&&c[i].c<high[i]){sweep=-1;sweepIx=i;}
      continue;
    }
    if(i-sweepIx<=4&&dir===0){
      const displacement=candleRange(c[i])>=1.2*a;
      if(sweep===1&&displacement&&c[i].c>c[i].o){
        let j=i-1;while(j>sweepIx-4&&j>=0&&c[j].c>=c[j].o)j--;
        const b=c[Math.max(0,j)];zoneLo=b.l;zoneHi=Math.max(b.o,b.c);dir=1;expires=i+20;
      } else if(sweep===-1&&displacement&&c[i].c<c[i].o){
        let j=i-1;while(j>sweepIx-4&&j>=0&&c[j].c<=c[j].o)j--;
        const b=c[Math.max(0,j)];zoneLo=Math.min(b.o,b.c);zoneHi=b.h;dir=-1;expires=i+20;
      }
    }
    if(i-sweepIx>4&&dir===0){sweep=0;continue;}
    if(dir&&i>expires){sweep=0;dir=0;continue;}
    if(dir===1&&c[i].l<=zoneHi&&c[i].c>zoneHi){sig[i]=1;sweep=0;dir=0;}
    else if(dir===-1&&c[i].h>=zoneLo&&c[i].c<zoneLo){sig[i]=-1;sweep=0;dir=0;}
  }
  return sig;
}

function signalsImpulseOB(c){
  const atr=rma(trueRange(c),14),vol=sma(c.map(b=>b.v),20),sig=Array(c.length).fill(0);
  let dir=0,lo=NaN,hi=NaN,expires=-1;
  for(let i=20;i<c.length;i++){
    const a=atr[i],v=vol[i];if(!finite(a)||a<=0||!finite(v)||v<=0)continue;
    if(dir===0&&candleRange(c[i])>=1.5*a&&c[i].v>=1.3*v){
      const prev=c[i-1];
      if(c[i].c>c[i].o&&prev.c<prev.o){dir=1;lo=prev.l;hi=Math.max(prev.o,prev.c);expires=i+24;continue;}
      if(c[i].c<c[i].o&&prev.c>prev.o){dir=-1;lo=Math.min(prev.o,prev.c);hi=prev.h;expires=i+24;continue;}
    }
    if(dir&&i>expires){dir=0;continue;}
    if(dir===1&&c[i].l<=hi&&c[i].c>hi){sig[i]=1;dir=0;}
    else if(dir===-1&&c[i].h>=lo&&c[i].c<lo){sig[i]=-1;dir=0;}
  }
  return sig;
}

function signalsFVGFirstTouch(c){
  const sig=Array(c.length).fill(0);let dir=0,lo=NaN,hi=NaN,created=-1;
  for(let i=2;i<c.length;i++){
    if(c[i].l>c[i-2].h){dir=1;lo=c[i-2].h;hi=c[i].l;created=i;}
    else if(c[i].h<c[i-2].l){dir=-1;lo=c[i].h;hi=c[i-2].l;created=i;}
    if(i<=created) continue;
    if(dir===1&&c[i].l<=hi&&c[i].h>=lo){if(c[i].c>lo)sig[i]=1;dir=0;}
    else if(dir===-1&&c[i].h>=lo&&c[i].l<=hi){if(c[i].c<hi)sig[i]=-1;dir=0;}
  }
  return sig;
}

function signalsInverseFVG(c){
  const sig=Array(c.length).fill(0);let gapDir=0,lo=NaN,hi=NaN,flipped=0,expires=-1;
  for(let i=2;i<c.length;i++){
    if(c[i].l>c[i-2].h){gapDir=1;lo=c[i-2].h;hi=c[i].l;flipped=0;}
    else if(c[i].h<c[i-2].l){gapDir=-1;lo=c[i].h;hi=c[i-2].l;flipped=0;}
    if(gapDir===1&&!flipped&&c[i].c<lo){flipped=-1;expires=i+16;continue;}
    if(gapDir===-1&&!flipped&&c[i].c>hi){flipped=1;expires=i+16;continue;}
    if(flipped&&i>expires){gapDir=0;flipped=0;continue;}
    if(flipped===1&&c[i].l<=hi&&c[i].c>hi){sig[i]=1;gapDir=0;flipped=0;}
    else if(flipped===-1&&c[i].h>=lo&&c[i].c<lo){sig[i]=-1;gapDir=0;flipped=0;}
  }
  return sig;
}

function signalsPDHSweepFVG(c){
  const p=priorPeriodLevels(c,utcDayKey),sig=Array(c.length).fill(0);
  let pending=0,expires=-1;
  for(let i=2;i<c.length;i++){
    if(finite(p.low[i])&&c[i].l<p.low[i]&&c[i].c>p.low[i]){pending=1;expires=i+8;}
    else if(finite(p.high[i])&&c[i].h>p.high[i]&&c[i].c<p.high[i]){pending=-1;expires=i+8;}
    if(i>expires){pending=0;continue;}
    const bullFvg=c[i].l>c[i-2].h,bearFvg=c[i].h<c[i-2].l;
    const bullMss=i>=3&&c[i].c>Math.max(c[i-1].h,c[i-2].h);
    const bearMss=i>=3&&c[i].c<Math.min(c[i-1].l,c[i-2].l);
    if(pending===1&&(bullFvg||bullMss)){sig[i]=1;pending=0;}
    else if(pending===-1&&(bearFvg||bearMss)){sig[i]=-1;pending=0;}
  }
  return sig;
}

function signalsSupplyDemandRetest(c){
  const atr=rma(trueRange(c),14),sig=Array(c.length).fill(0);
  let dir=0,lo=NaN,hi=NaN,expires=-1;
  for(let i=16;i<c.length;i++){
    const a=atr[i];if(!finite(a)||a<=0)continue;
    const base=[c[i-3],c[i-2],c[i-1]],baseRange=Math.max(...base.map(x=>x.h))-Math.min(...base.map(x=>x.l));
    if(dir===0&&baseRange<=1.1*a&&candleRange(c[i])>=1.5*a){
      lo=Math.min(...base.map(x=>x.l));hi=Math.max(...base.map(x=>x.h));
      if(c[i].c>hi){dir=1;expires=i+30;continue;}
      if(c[i].c<lo){dir=-1;expires=i+30;continue;}
    }
    if(dir&&i>expires){dir=0;continue;}
    if(dir===1&&c[i].l<=hi&&c[i].c>hi){sig[i]=1;dir=0;}
    else if(dir===-1&&c[i].h>=lo&&c[i].c<lo){sig[i]=-1;dir=0;}
  }
  return sig;
}

function signalsKernelSupplyDemand(c){
  const piv=confirmedPivots(c,2,2),atr=rma(trueRange(c),14),vol=sma(c.map(b=>b.v),20),sig=Array(c.length).fill(0);
  const zones=[];let hp=0,lp=0;
  for(let i=0;i<c.length;i++){
    const a=atr[i],v=vol[i];
    while(hp<piv.highs.length&&piv.highs[hp].confirmedIndex===i){
      const p=piv.highs[hp++],pv=c[p.pivotIndex].v;
      const reaction=i+1<c.length?Math.abs(c[i].c-c[p.pivotIndex].c):0;
      const score=(finite(v)&&v>0?pv/v:1)+(finite(a)&&a>0?reaction/a:0);
      if(score>=1.8) zones.push({dir:-1,price:p.price,born:i});
    }
    while(lp<piv.lows.length&&piv.lows[lp].confirmedIndex===i){
      const p=piv.lows[lp++],pv=c[p.pivotIndex].v;
      const reaction=i+1<c.length?Math.abs(c[i].c-c[p.pivotIndex].c):0;
      const score=(finite(v)&&v>0?pv/v:1)+(finite(a)&&a>0?reaction/a:0);
      if(score>=1.8) zones.push({dir:1,price:p.price,born:i});
    }
    if(zones.length>40) zones.splice(0,zones.length-40);
    if(!finite(a)||a<=0) continue;
    for(let z=zones.length-1;z>=0;z--){
      const zone=zones[z];if(i-zone.born<2)continue;
      if(zone.dir===1&&Math.abs(c[i].l-zone.price)<=0.25*a&&c[i].c>zone.price){sig[i]=1;zones.splice(z,1);break;}
      if(zone.dir===-1&&Math.abs(c[i].h-zone.price)<=0.25*a&&c[i].c<zone.price){sig[i]=-1;zones.splice(z,1);break;}
    }
  }
  return sig;
}

function camarilla(c){
  const p=priorPeriodLevels(c,utcDayKey);
  const h3=Array(c.length).fill(NaN),l3=Array(c.length).fill(NaN),h4=Array(c.length).fill(NaN),l4=Array(c.length).fill(NaN);
  for(let i=0;i<c.length;i++){
    if(![p.high[i],p.low[i],p.close[i]].every(finite))continue;
    const r=p.high[i]-p.low[i],cc=p.close[i];
    h3[i]=cc+r*1.1/4;l3[i]=cc-r*1.1/4;h4[i]=cc+r*1.1/2;l4[i]=cc-r*1.1/2;
  }
  return {h3,l3,h4,l4};
}

function signalsCamarillaMean(c){
  const x=camarilla(c),sig=Array(c.length).fill(0);
  for(let i=1;i<c.length;i++){
    if(finite(x.l3[i])&&c[i].l<=x.l3[i]&&c[i].c>x.l3[i]&&c[i].c<x.h4[i])sig[i]=1;
    else if(finite(x.h3[i])&&c[i].h>=x.h3[i]&&c[i].c<x.h3[i]&&c[i].c>x.l4[i])sig[i]=-1;
  }
  return sig;
}

function signalsCamarillaBreak(c){
  const x=camarilla(c),sig=Array(c.length).fill(0);
  for(let i=1;i<c.length;i++){
    if(finite(x.h4[i])&&c[i-1].c<=x.h4[i]&&c[i].c>x.h4[i])sig[i]=1;
    else if(finite(x.l4[i])&&c[i-1].c>=x.l4[i]&&c[i].c<x.l4[i])sig[i]=-1;
  }
  return sig;
}

function cpr(c){
  const p=priorPeriodLevels(c,utcDayKey),pivot=Array(c.length).fill(NaN),bc=Array(c.length).fill(NaN),tc=Array(c.length).fill(NaN);
  for(let i=0;i<c.length;i++){
    if(![p.high[i],p.low[i],p.close[i]].every(finite))continue;
    const pv=(p.high[i]+p.low[i]+p.close[i])/3,b=(p.high[i]+p.low[i])/2,t=2*pv-b;
    pivot[i]=pv;bc[i]=Math.min(b,t);tc[i]=Math.max(b,t);
  }
  return {pivot,bc,tc};
}

function signalsNarrowCPR(c){
  const x=cpr(c),atr=rma(trueRange(c),14),sig=Array(c.length).fill(0);
  for(let i=1;i<c.length;i++){
    const a=atr[i];if(!finite(a)||a<=0||![x.bc[i],x.tc[i]].every(finite))continue;
    if((x.tc[i]-x.bc[i])/a>0.45)continue;
    if(c[i-1].c<=x.tc[i]&&c[i].c>x.tc[i])sig[i]=1;
    else if(c[i-1].c>=x.bc[i]&&c[i].c<x.bc[i])sig[i]=-1;
  }
  return sig;
}

function signalsPOCMean(c){
  const p=sessionProfiles(c),atr=rma(trueRange(c),14),sig=Array(c.length).fill(0);
  for(let i=1;i<c.length;i++){
    const a=atr[i],x=p.poc[i];if(!finite(a)||a<=0||!finite(x))continue;
    if(c[i].c<x-0.6*a&&c[i].c>c[i].o)sig[i]=1;
    else if(c[i].c>x+0.6*a&&c[i].c<c[i].o)sig[i]=-1;
  }
  return sig;
}

function signalsValueArea80(c){
  const p=sessionProfiles(c),sig=Array(c.length).fill(0);
  for(let i=1;i<c.length;i++){
    if(![p.val[i],p.vah[i]].every(finite))continue;
    if(c[i-1].c<p.val[i]&&c[i].c>=p.val[i])sig[i]=1;
    else if(c[i-1].c>p.vah[i]&&c[i].c<=p.vah[i])sig[i]=-1;
  }
  return sig;
}

function signalsNakedPOC(c){
  const p=sessionProfiles(c),atr=rma(trueRange(c),14),sig=Array(c.length).fill(0);
  let active=NaN,day=null,touched=false;
  for(let i=0;i<c.length;i++){
    const d=utcDayKey(c[i].t);
    if(day===null||d!==day){day=d;if(finite(p.poc[i])){active=p.poc[i];touched=false;}}
    const a=atr[i];if(touched||!finite(active)||!finite(a)||a<=0)continue;
    if(c[i].l<=active&&c[i].h>=active){
      if(c[i].o>active&&c[i].c>active&&Math.min(c[i].o,c[i].c)-c[i].l>0.15*a)sig[i]=1;
      else if(c[i].o<active&&c[i].c<active&&c[i].h-Math.max(c[i].o,c[i].c)>0.15*a)sig[i]=-1;
      touched=true;
    }
  }
  return sig;
}

function signalsSwingAnchoredVWAP(c){
  const piv=confirmedPivots(c,4,4),atr=rma(trueRange(c),14),sig=Array(c.length).fill(0);
  let hp=0,lp=0,anchor=-1,anchorDir=0,sumPV=0,sumV=0,prevVwap=NaN;
  for(let i=0;i<c.length;i++){
    let reset=false;
    while(hp<piv.highs.length&&piv.highs[hp].confirmedIndex===i){anchor=piv.highs[hp].pivotIndex;anchorDir=-1;hp++;reset=true;}
    while(lp<piv.lows.length&&piv.lows[lp].confirmedIndex===i){anchor=piv.lows[lp].pivotIndex;anchorDir=1;lp++;reset=true;}
    if(reset){sumPV=0;sumV=0;prevVwap=NaN;}
    if(anchor<0)continue;
    const tp=(c[i].h+c[i].l+c[i].c)/3,v=Math.max(0,c[i].v);sumPV+=tp*v;sumV+=v;
    const vw=sumV>0?sumPV/sumV:NaN,a=atr[i];
    if(!finite(vw)||!finite(a)||a<=0){prevVwap=vw;continue;}
    if(anchorDir===1&&c[i].l<=vw+0.15*a&&c[i].c>vw&&c[i].c>c[i].o)sig[i]=1;
    else if(anchorDir===-1&&c[i].h>=vw-0.15*a&&c[i].c<vw&&c[i].c<c[i].o)sig[i]=-1;
    else if(finite(prevVwap)&&c[i-1].c<=prevVwap&&c[i].c>vw+0.08*a)sig[i]=1;
    else if(finite(prevVwap)&&c[i-1].c>=prevVwap&&c[i].c<vw-0.08*a)sig[i]=-1;
    prevVwap=vw;
  }
  return sig;
}

function signalsTrendlineBreakout(c){
  const piv=confirmedPivots(c,3,3),atr=rma(trueRange(c),14),sig=Array(c.length).fill(0);
  const hs=[],ls=[];let hp=0,lp=0;
  for(let i=0;i<c.length;i++){
    while(hp<piv.highs.length&&piv.highs[hp].confirmedIndex===i){hs.push(piv.highs[hp++]);if(hs.length>4)hs.shift();}
    while(lp<piv.lows.length&&piv.lows[lp].confirmedIndex===i){ls.push(piv.lows[lp++]);if(ls.length>4)ls.shift();}
    const a=atr[i];if(!finite(a)||a<=0||i<2)continue;
    const test=(arr,dir)=>{
      if(arr.length<3)return false;
      const [a1,a2,a3]=arr.slice(-3),dx=a2.pivotIndex-a1.pivotIndex;if(dx<=0)return false;
      const slope=(a2.price-a1.price)/dx;
      const expected3=a1.price+slope*(a3.pivotIndex-a1.pivotIndex);
      if(Math.abs(a3.price-expected3)>0.35*a)return false;
      const linePrev=a1.price+slope*((i-1)-a1.pivotIndex),lineNow=a1.price+slope*(i-a1.pivotIndex);
      return dir===1?c[i-1].c<=linePrev&&c[i].c>lineNow+0.08*a:c[i-1].c>=linePrev&&c[i].c<lineNow-0.08*a;
    };
    if(test(hs,1))sig[i]=1;
    else if(test(ls,-1))sig[i]=-1;
  }
  return sig;
}

function signalsDonchian(c){
  const {high,low}=previousRange(c,20),sig=Array(c.length).fill(0);
  for(let i=20;i<c.length;i++){
    if(c[i].c>high[i])sig[i]=1;
    else if(c[i].c<low[i])sig[i]=-1;
  }
  return sig;
}

export const SR25_STRATEGIES = [
  {id:'sr25_fractal_cluster_rejection',name:'SR25 Fractal Cluster Zone Rejection',family:'support_resistance',version:'sr25-v1',mode:'REVERSAL',signal:signalsFractalClusterZone},
  {id:'sr25_confirmed_pivot_breakout',name:'SR25 Confirmed Pivot Breakout',family:'support_resistance',version:'sr25-v1',mode:'REVERSAL',signal:signalsConfirmedPivotBreakout},
  {id:'sr25_breakout_retest',name:'SR25 Breakout + Retest',family:'support_resistance',version:'sr25-v1',mode:'REVERSAL',signal:signalsBreakoutRetest},
  {id:'sr25_role_reversal_flip',name:'SR25 S/R Role-Reversal Level Flip',family:'support_resistance',version:'sr25-v1',mode:'REVERSAL',signal:signalsRoleReversal},
  {id:'sr25_wick_confirmed_zone',name:'SR25 Wick Rejection at Confirmed Zone',family:'support_resistance',version:'sr25-v1',mode:'REVERSAL',signal:signalsWickConfirmedZone},
  {id:'sr25_liquidity_sweep_reclaim',name:'SR25 Liquidity Sweep + Reclaim',family:'support_resistance',version:'sr25-v1',mode:'REVERSAL',signal:signalsLiquiditySweep},
  {id:'sr25_liquidity_absorption',name:'SR25 Liquidity Sweep + Volume Absorption',family:'support_resistance',version:'sr25-v1',mode:'REVERSAL',signal:signalsLiquidityAbsorption},
  {id:'sr25_previous_day_sweep',name:'SR25 Previous-Day High/Low Sweep',family:'support_resistance',version:'sr25-v1',mode:'REVERSAL',signal:signalsPreviousDaySweep},
  {id:'sr25_week_month_sweep',name:'SR25 Previous-Week / Month Extreme Sweep',family:'support_resistance',version:'sr25-v1',mode:'REVERSAL',signal:signalsPrevWeekMonthSweep},
  {id:'sr25_lsob',name:'SR25 Liquidity Sweep + Order Block',family:'support_resistance',version:'sr25-v1',mode:'REVERSAL',signal:signalsLSOB},
  {id:'sr25_impulse_ob_retest',name:'SR25 Impulse Order Block Retest',family:'support_resistance',version:'sr25-v1',mode:'REVERSAL',signal:signalsImpulseOB},
  {id:'sr25_fvg_first_touch',name:'SR25 Fair Value Gap First-Touch Rejection',family:'support_resistance',version:'sr25-v1',mode:'REVERSAL',signal:signalsFVGFirstTouch},
  {id:'sr25_inverse_fvg',name:'SR25 Inverse Fair Value Gap',family:'support_resistance',version:'sr25-v1',mode:'REVERSAL',signal:signalsInverseFVG},
  {id:'sr25_pdh_fvg_mss',name:'SR25 PDH/PDL Sweep + FVG/MSS',family:'support_resistance',version:'sr25-v1',mode:'REVERSAL',signal:signalsPDHSweepFVG},
  {id:'sr25_supply_demand_retest',name:'SR25 RBD/DBR Supply-Demand Retest',family:'support_resistance',version:'sr25-v1',mode:'REVERSAL',signal:signalsSupplyDemandRetest},
  {id:'sr25_kernel_supply_demand',name:'SR25 Kernel/Volume-Scored Supply-Demand',family:'support_resistance',version:'sr25-v1',mode:'REVERSAL',signal:signalsKernelSupplyDemand},
  {id:'sr25_camarilla_h3_l3',name:'SR25 Camarilla H3/L3 Mean Reversion',family:'support_resistance',version:'sr25-v1',mode:'REVERSAL',signal:signalsCamarillaMean},
  {id:'sr25_camarilla_h4_l4',name:'SR25 Camarilla H4/L4 Breakout',family:'support_resistance',version:'sr25-v1',mode:'REVERSAL',signal:signalsCamarillaBreak},
  {id:'sr25_narrow_cpr_breakout',name:'SR25 Narrow CPR Breakout',family:'support_resistance',version:'sr25-v1',mode:'REVERSAL',signal:signalsNarrowCPR},
  {id:'sr25_poc_mean_reversion',name:'SR25 Volume Profile POC Mean Reversion',family:'support_resistance',version:'sr25-v1',mode:'REVERSAL',signal:signalsPOCMean},
  {id:'sr25_value_area_80',name:'SR25 Value-Area Edge / 80% Rule',family:'support_resistance',version:'sr25-v1',mode:'REVERSAL',signal:signalsValueArea80},
  {id:'sr25_naked_poc_revisit',name:'SR25 Naked POC Revisit',family:'support_resistance',version:'sr25-v1',mode:'REVERSAL',signal:signalsNakedPOC},
  {id:'sr25_swing_anchored_vwap',name:'SR25 Swing-Anchored VWAP Rejection / Flip',family:'support_resistance',version:'sr25-v1',mode:'REVERSAL',signal:signalsSwingAnchoredVWAP},
  {id:'sr25_trendline_breakout',name:'SR25 Multi-Touch Trendline Breakout',family:'support_resistance',version:'sr25-v1',mode:'REVERSAL',signal:signalsTrendlineBreakout},
  {id:'sr25_donchian_breakout',name:'SR25 Donchian Dynamic S/R Breakout',family:'support_resistance',version:'sr25-v1',mode:'REVERSAL',signal:signalsDonchian},
];

export const SR25_STRATEGY_IDS = SR25_STRATEGIES.map(x=>x.id);
