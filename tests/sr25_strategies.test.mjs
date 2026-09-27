import test from 'node:test';
import assert from 'node:assert/strict';
import { SR25_STRATEGIES, SR25_STRATEGY_IDS } from '../research/sr25_strategies.mjs';
import { evaluateStrategies } from '../research/strategy_engine_v2.mjs';

function synthetic(count=1100){
  const out=[];
  const start=Date.parse('2026-01-01T00:00:00Z');
  let px=100;
  for(let i=0;i<count;i++){
    const cycle=Math.sin(i/17)*0.45+Math.sin(i/53)*0.30;
    const regime=i<350?0.05:i<700?-0.035:0.025;
    const o=px;
    const c=Math.max(1,o*(1+(regime+cycle)/100));
    const range=0.0035+0.0015*Math.abs(Math.sin(i/11));
    const h=Math.max(o,c)*(1+range);
    const l=Math.min(o,c)*(1-range);
    const v=1000+350*Math.abs(Math.sin(i/7))+120*Math.cos(i/31);
    out.push({t:start+i*15*60_000,o,h,l,c,v});
    px=c;
  }
  return out;
}

test('SR25 catalog has exactly 25 unique executable adapters',()=>{
  assert.equal(SR25_STRATEGIES.length,25);
  assert.equal(SR25_STRATEGY_IDS.length,25);
  assert.equal(new Set(SR25_STRATEGY_IDS).size,25);
  for(const s of SR25_STRATEGIES){
    assert.equal(s.version,'sr25-v1');
    assert.equal(s.family,'support_resistance');
    assert.equal(s.mode,'REVERSAL');
    assert.equal(typeof s.signal,'function');
  }
});

test('every SR25 signal is deterministic, finite-state and prefix invariant',()=>{
  const candles=synthetic();
  for(const s of SR25_STRATEGIES){
    const fullA=s.signal(candles);
    const fullB=s.signal(candles);
    assert.deepEqual(fullA,fullB,s.id);
    assert.equal(fullA.length,candles.length,s.id);
    for(const x of fullA) assert.ok(x===-1||x===0||x===1,`${s.id}: invalid signal ${x}`);

    for(const n of [260,520,780,1000]){
      const prefix=s.signal(candles.slice(0,n));
      assert.deepEqual(prefix,fullA.slice(0,n),`${s.id}: look-ahead/prefix mutation at ${n}`);
    }
  }
});

test('SR25 can be evaluated as an isolated 25-strategy research batch',()=>{
  const candles=synthetic(1400);
  const start=candles[0].t;
  const end=candles.at(-1).t+15*60_000;
  const rows=evaluateStrategies(candles,{
    start,
    end,
    minTrades:1,
    strategyIds:SR25_STRATEGY_IDS,
  });
  assert.equal(rows.length,25);
  assert.deepEqual(rows.map(x=>x.id).sort(),[...SR25_STRATEGY_IDS].sort());
  for(const r of rows){
    assert.equal(r.version,'sr25-v1');
    assert.ok(Number.isInteger(r.n)&&r.n>=0,r.id);
    for(const k of ['net','pf','dd','exp','net15','net6','longNet','shortNet']) {
      assert.ok(Number.isFinite(r[k]),`${r.id} ${k}`);
    }
  }
});

test('strategyIds filter prevents unrelated strategies from executing',()=>{
  const candles=synthetic(700);
  const start=candles[0].t;
  const end=candles.at(-1).t+15*60_000;
  const ids=[SR25_STRATEGY_IDS[0],SR25_STRATEGY_IDS[24]];
  const rows=evaluateStrategies(candles,{start,end,minTrades:1,strategyIds:ids});
  assert.deepEqual(rows.map(x=>x.id),ids);
});
