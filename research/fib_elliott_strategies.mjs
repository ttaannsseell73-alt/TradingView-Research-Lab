const finite = Number.isFinite;

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

export function confirmedPivotsCausal(c,left=3,right=3) {
  const byConfirm=Array.from({length:c.length},()=>[]);
  for(let i=left+right;i<c.length;i++){
    const p=i-right;
    let hi=true,lo=true;
    for(let j=p-left;j<=p+right;j++){
      if(j===p) continue;
      if(c[j].h>=c[p].h) hi=false;
      if(c[j].l<=c[p].l) lo=false;
    }
    if(hi) byConfirm[i].push({kind:'H',price:c[p].h,pivotIndex:p,confirmedIndex:i});
    if(lo) byConfirm[i].push({kind:'L',price:c[p].l,pivotIndex:p,confirmedIndex:i});
  }
  return byConfirm;
}

function chooseSimultaneous(events,last) {
  if(events.length<=1) return events;
  if(last){
    const opposite=events.find(e=>e.kind!==last.kind);
    if(opposite) return [opposite];
  }
  return [events[0]];
}

function updateSwings(swings,event,maxKeep=8) {
  const last=swings.at(-1);
  if(!last){ swings.push(event); return; }
  if(event.kind!==last.kind){
    if(event.pivotIndex>last.pivotIndex) swings.push(event);
  } else {
    const moreExtreme=event.kind==='H'?event.price>last.price:event.price<last.price;
    if(moreExtreme&&event.pivotIndex>=last.pivotIndex) swings[swings.length-1]=event;
  }
  if(swings.length>maxKeep) swings.splice(0,swings.length-maxKeep);
}

function microBreak(c,i,dir,lookback=3) {
  if(i<lookback) return false;
  if(dir===1){
    let h=-Infinity;
    for(let j=i-lookback;j<i;j++) h=Math.max(h,c[j].h);
    return c[i].c>h;
  }
  let l=Infinity;
  for(let j=i-lookback;j<i;j++) l=Math.min(l,c[j].l);
  return c[i].c<l;
}

function timedTarget(entries,holdBars=12) {
  const out=Array(entries.length).fill(0);
  let pos=0,expiry=-1;
  for(let i=0;i<entries.length;i++){
    const e=entries[i];
    if(e&&e!==pos){ pos=e; expiry=i+holdBars; }
    if(pos&&i>=expiry){ pos=0; expiry=-1; }
    out[i]=pos;
  }
  return out;
}

function approxBetween(x,lo,hi){ return finite(x)&&x>=lo&&x<=hi; }

function harmonicMatch(b,c,d,cd){
  const patterns=[];
  if(approxBetween(b,0.55,0.70)&&approxBetween(c,0.382,0.886)&&approxBetween(d,0.72,0.86)&&approxBetween(cd,1.10,1.80)) patterns.push('gartley');
  if(approxBetween(b,0.30,0.55)&&approxBetween(c,0.382,0.886)&&approxBetween(d,0.82,0.95)&&approxBetween(cd,1.50,2.80)) patterns.push('bat');
  if(approxBetween(b,0.70,0.86)&&approxBetween(c,0.382,0.886)&&approxBetween(d,1.18,1.70)&&approxBetween(cd,1.50,2.50)) patterns.push('butterfly');
  if(approxBetween(b,0.30,0.70)&&approxBetween(c,0.382,0.886)&&approxBetween(d,1.45,1.80)&&approxBetween(cd,2.00,4.00)) patterns.push('crab');
  return patterns;
}

const CACHE=new WeakMap();

export function buildFibElliottSuite(c,{left=3,right=3,holdBars=12}={}) {
  const cached=CACHE.get(c);
  if(cached&&cached.left===left&&cached.right===right&&cached.holdBars===holdBars) return cached.value;

  const events=confirmedPivotsCausal(c,left,right);
  const atr=rma(trueRange(c),14);
  const ids=['fib_golden_pocket','fib_retrace_382','fib_retrace_500','fib_retrace_618','fib_retrace_786','elliott_w2_w3','elliott_w4_w5','elliott_abc','harmonic_prz'];
  const entries=Object.fromEntries(ids.map(id=>[id,Array(c.length).fill(0)]));
  const fired=Object.fromEntries(ids.map(id=>[id,new Set()]));
  const swings=[];

  const fire=(id,i,dir,key)=>{
    if(fired[id].has(key)) return;
    entries[id][i]=dir;
    fired[id].add(key);
  };

  for(let i=0;i<c.length;i++){
    const evs=chooseSimultaneous(events[i],swings.at(-1));
    for(const e of evs) updateSwings(swings,e,8);
    const atrNow=atr[i];
    if(!finite(atrNow)||atrNow<=0||swings.length<2) continue;

    const p1=swings.at(-2),p2=swings.at(-1);
    const span=Math.abs(p2.price-p1.price);
    if(span>=2.5*atrNow){
      const key=[p1.pivotIndex,p2.pivotIndex].join('-');
      if(p1.kind==='L'&&p2.kind==='H'){
        const hi=p2.price,lo=p1.price,r=hi-lo;
        const gpUpper=hi-0.618*r,gpLower=hi-0.67*r;
        if(c[i].l<=gpUpper&&c[i].h>=gpLower&&c[i].c>gpUpper&&c[i].c>c[i].o) fire('fib_golden_pocket',i,1,key);
        for(const [ratio,id] of [[0.382,'fib_retrace_382'],[0.5,'fib_retrace_500'],[0.618,'fib_retrace_618'],[0.786,'fib_retrace_786']]){
          const level=hi-ratio*r;
          if(c[i].l<=level&&c[i].c>level&&c[i].c>c[i].o) fire(id,i,1,key);
        }
      } else if(p1.kind==='H'&&p2.kind==='L'){
        const hi=p1.price,lo=p2.price,r=hi-lo;
        const gpLower=lo+0.618*r,gpUpper=lo+0.67*r;
        if(c[i].h>=gpLower&&c[i].l<=gpUpper&&c[i].c<gpLower&&c[i].c<c[i].o) fire('fib_golden_pocket',i,-1,key);
        for(const [ratio,id] of [[0.382,'fib_retrace_382'],[0.5,'fib_retrace_500'],[0.618,'fib_retrace_618'],[0.786,'fib_retrace_786']]){
          const level=lo+ratio*r;
          if(c[i].h>=level&&c[i].c<level&&c[i].c<c[i].o) fire(id,i,-1,key);
        }
      }
    }

    if(swings.length>=3){
      const [a0,a1,a2]=swings.slice(-3);
      const key=[a0.pivotIndex,a1.pivotIndex,a2.pivotIndex].join('-');
      if(a0.kind==='L'&&a1.kind==='H'&&a2.kind==='L'){
        const w1=a1.price-a0.price,ret=w1>0?(a1.price-a2.price)/w1:NaN;
        if(w1>=2.5*atrNow&&a2.price>a0.price&&approxBetween(ret,0.382,0.786)&&microBreak(c,i,1,3)) fire('elliott_w2_w3',i,1,key);
      } else if(a0.kind==='H'&&a1.kind==='L'&&a2.kind==='H'){
        const w1=a0.price-a1.price,ret=w1>0?(a2.price-a1.price)/w1:NaN;
        if(w1>=2.5*atrNow&&a2.price<a0.price&&approxBetween(ret,0.382,0.786)&&microBreak(c,i,-1,3)) fire('elliott_w2_w3',i,-1,key);
      }
    }

    if(swings.length>=4){
      const [a0,a1,a2,a3]=swings.slice(-4);
      const key=[a0.pivotIndex,a1.pivotIndex,a2.pivotIndex,a3.pivotIndex].join('-');
      if(a0.kind==='H'&&a1.kind==='L'&&a2.kind==='H'&&a3.kind==='L'){
        const leg=a0.price-a1.price,b=(a2.price-a1.price)/leg,cExt=(a2.price-a3.price)/leg;
        if(leg>=2.5*atrNow&&a2.price<a0.price&&a3.price<a1.price&&approxBetween(b,0.382,0.786)&&approxBetween(cExt,0.618,1.618)&&microBreak(c,i,1,3)) fire('elliott_abc',i,1,key);
      } else if(a0.kind==='L'&&a1.kind==='H'&&a2.kind==='L'&&a3.kind==='H'){
        const leg=a1.price-a0.price,b=(a1.price-a2.price)/leg,cExt=(a3.price-a2.price)/leg;
        if(leg>=2.5*atrNow&&a2.price>a0.price&&a3.price>a1.price&&approxBetween(b,0.382,0.786)&&approxBetween(cExt,0.618,1.618)&&microBreak(c,i,-1,3)) fire('elliott_abc',i,-1,key);
      }
    }

    if(swings.length>=5){
      const [x,a1,b,c1,d]=swings.slice(-5);
      const key=[x.pivotIndex,a1.pivotIndex,b.pivotIndex,c1.pivotIndex,d.pivotIndex].join('-');
      if(x.kind==='L'&&a1.kind==='H'&&b.kind==='L'&&c1.kind==='H'&&d.kind==='L'){
        const w1=a1.price-x.price,w3=c1.price-b.price;
        const w2ret=(a1.price-b.price)/w1,w4ret=(c1.price-d.price)/w3;
        if(w1>=2.5*atrNow&&b.price>x.price&&c1.price>a1.price&&d.price>a1.price&&approxBetween(w2ret,0.382,0.786)&&approxBetween(w4ret,0.236,0.5)&&microBreak(c,i,1,3)) fire('elliott_w4_w5',i,1,key);

        const ab=a1.price-b.price,bc=c1.price-b.price,cd=c1.price-d.price;
        const br=ab/w1,cr=ab>0?bc/ab:NaN,dr=(a1.price-d.price)/w1,cdr=bc>0?cd/bc:NaN;
        if(w1>=2.5*atrNow&&harmonicMatch(br,cr,dr,cdr).length&&microBreak(c,i,1,3)) fire('harmonic_prz',i,1,key);
      } else if(x.kind==='H'&&a1.kind==='L'&&b.kind==='H'&&c1.kind==='L'&&d.kind==='H'){
        const w1=x.price-a1.price,w3=b.price-c1.price;
        const w2ret=(b.price-a1.price)/w1,w4ret=(d.price-c1.price)/w3;
        if(w1>=2.5*atrNow&&b.price<x.price&&c1.price<a1.price&&d.price<a1.price&&approxBetween(w2ret,0.382,0.786)&&approxBetween(w4ret,0.236,0.5)&&microBreak(c,i,-1,3)) fire('elliott_w4_w5',i,-1,key);

        const ab=b.price-a1.price,bc=b.price-c1.price,cd=d.price-c1.price;
        const br=ab/w1,cr=ab>0?bc/ab:NaN,dr=(d.price-a1.price)/w1,cdr=bc>0?cd/bc:NaN;
        if(w1>=2.5*atrNow&&harmonicMatch(br,cr,dr,cdr).length&&microBreak(c,i,-1,3)) fire('harmonic_prz',i,-1,key);
      }
    }
  }

  const value={entries,targets:Object.fromEntries(ids.map(id=>[id,timedTarget(entries[id],holdBars)]))};
  CACHE.set(c,{left,right,holdBars,value});
  return value;
}

function targetFor(id){ return c=>buildFibElliottSuite(c).targets[id]; }

export const FIB_EW_STRATEGIES = [
  {id:'fib_golden_pocket',name:'Fibonacci Golden Pocket 0.618-0.670',family:'fibonacci',version:'fib-ew-causal-v1',mode:'TARGET_POSITION',signal:targetFor('fib_golden_pocket')},
  {id:'fib_retrace_382',name:'Fibonacci Retracement 0.382 Reclaim',family:'fibonacci',version:'fib-ew-causal-v1',mode:'TARGET_POSITION',signal:targetFor('fib_retrace_382')},
  {id:'fib_retrace_500',name:'Fibonacci Retracement 0.500 Reclaim',family:'fibonacci',version:'fib-ew-causal-v1',mode:'TARGET_POSITION',signal:targetFor('fib_retrace_500')},
  {id:'fib_retrace_618',name:'Fibonacci Retracement 0.618 Reclaim',family:'fibonacci',version:'fib-ew-causal-v1',mode:'TARGET_POSITION',signal:targetFor('fib_retrace_618')},
  {id:'fib_retrace_786',name:'Fibonacci Retracement 0.786 Reclaim',family:'fibonacci',version:'fib-ew-causal-v1',mode:'TARGET_POSITION',signal:targetFor('fib_retrace_786')},
  {id:'elliott_w2_w3',name:'Elliott Wave 2 to Wave 3',family:'elliott_wave',version:'fib-ew-causal-v1',mode:'TARGET_POSITION',signal:targetFor('elliott_w2_w3')},
  {id:'elliott_w4_w5',name:'Elliott Wave 4 to Wave 5',family:'elliott_wave',version:'fib-ew-causal-v1',mode:'TARGET_POSITION',signal:targetFor('elliott_w4_w5')},
  {id:'elliott_abc',name:'Elliott ABC Completion Reversal',family:'elliott_wave',version:'fib-ew-causal-v1',mode:'TARGET_POSITION',signal:targetFor('elliott_abc')},
  {id:'harmonic_prz',name:'Harmonic XABCD PRZ (Gartley/Bat/Butterfly/Crab)',family:'harmonic_fibonacci',version:'fib-ew-causal-v1',mode:'TARGET_POSITION',signal:targetFor('harmonic_prz')},
];

export const FIB_EW_STRATEGY_IDS = FIB_EW_STRATEGIES.map(x=>x.id);
