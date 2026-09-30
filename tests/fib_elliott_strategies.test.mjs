import test from 'node:test';
import assert from 'node:assert/strict';
import { FIB_EW_STRATEGIES, FIB_EW_STRATEGY_IDS, buildFibElliottSuite } from '../research/fib_elliott_strategies.mjs';
import { evaluateStrategies } from '../research/strategy_engine_v2.mjs';

function synthetic(count=1500){
  const out=[];
  const start=Date.parse('2025-09-20T00:00:00Z');
  let px=100;
  for(let i=0;i<count;i++){
    const cycle=Math.sin(i/13)*0.75+Math.sin(i/47)*0.50;
    const regime=i<500?0.035:i<1000?-0.025:0.02;
    const o=px;
    const cc=Math.max(1,o*(1+(regime+cycle)/100));
    const wick=0.004+0.002*Math.abs(Math.sin(i/9));
    const h=Math.max(o,cc)*(1+wick);
    const l=Math.min(o,cc)*(1-wick);
    const v=1000+200*Math.abs(Math.sin(i/5));
    out.push({t:start+i*15*60_000,o,h,l,c:cc,v});
    px=cc;
  }
  return out;
}

test('Fib/Elliott catalog has 9 unique causal adapters',()=>{
  assert.equal(FIB_EW_STRATEGIES.length,9);
  assert.equal(FIB_EW_STRATEGY_IDS.length,9);
  assert.equal(new Set(FIB_EW_STRATEGY_IDS).size,9);
  for(const s of FIB_EW_STRATEGIES){
    assert.equal(s.version,'fib-ew-causal-v1');
    assert.equal(s.mode,'TARGET_POSITION');
    assert.equal(typeof s.signal,'function');
  }
});

test('Fib/Elliott signals are deterministic and prefix invariant',()=>{
  const candles=synthetic();
  for(const s of FIB_EW_STRATEGIES){
    const fullA=s.signal(candles);
    const fullB=s.signal(candles);
    assert.deepEqual(fullA,fullB,s.id);
    assert.equal(fullA.length,candles.length,s.id);
    for(const x of fullA) assert.ok(x===-1||x===0||x===1,s.id+' invalid target '+x);
    for(const n of [260,520,780,1000,1300]){
      const prefix=s.signal(candles.slice(0,n));
      assert.deepEqual(prefix,fullA.slice(0,n),s.id+' look-ahead/prefix mutation at '+n);
    }
  }
});

test('future candle perturbation cannot rewrite past Fib/Elliott targets',()=>{
  const base=synthetic(1200);
  const changed=base.map((x,i)=>i<700?{...x}:{...x,o:x.o*1.4,h:x.h*1.6,l:x.l*0.6,c:x.c*1.3,v:x.v*3});
  for(const s of FIB_EW_STRATEGIES){
    const a=s.signal(base);
    const b=s.signal(changed);
    assert.deepEqual(a.slice(0,700),b.slice(0,700),s.id+' future-data leakage');
  }
});

test('suite computes all nine strategies in one shared causal pass',()=>{
  const candles=synthetic(900);
  const suite=buildFibElliottSuite(candles);
  assert.deepEqual(Object.keys(suite.targets).sort(),[...FIB_EW_STRATEGY_IDS].sort());
  for(const id of FIB_EW_STRATEGY_IDS){
    assert.equal(suite.entries[id].length,candles.length,id);
    assert.equal(suite.targets[id].length,candles.length,id);
  }
});

test('Fib/Elliott adapters are isolated by strategyIds in common evaluator',()=>{
  const candles=synthetic(1500);
  const start=candles[0].t;
  const end=candles.at(-1).t+15*60_000;
  const rows=evaluateStrategies(candles,{start,end,minTrades:1,strategyIds:FIB_EW_STRATEGY_IDS});
  assert.equal(rows.length,9);
  assert.deepEqual(rows.map(x=>x.id).sort(),[...FIB_EW_STRATEGY_IDS].sort());
  for(const r of rows){
    assert.equal(r.version,'fib-ew-causal-v1');
    for(const k of ['net','pf','dd','exp','net15','net6','longNet','shortNet']) assert.ok(Number.isFinite(r[k]),r.id+' '+k);
  }
});
