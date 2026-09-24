import test from 'node:test';
import assert from 'node:assert/strict';
import { STRATEGIES, evaluateStrategies } from '../research/strategy_engine_v2.mjs';

function synthetic(count=720) {
  const out=[];
  const start=Date.parse('2026-06-24T00:00:00Z');
  let px=100;
  for(let i=0;i<count;i++){
    const regime=i<240?0.10:i<480?-0.08:0.06;
    const wave=Math.sin(i/13)*0.12+Math.sin(i/29)*0.08;
    const o=px;
    const c=Math.max(1,o*(1+(regime+wave)/100));
    const h=Math.max(o,c)*1.0035;
    const l=Math.min(o,c)*0.9965;
    out.push({t:start+i*3600000,o,h,l,c,v:1000+Math.sin(i/9)*120});
    px=c;
  }
  return out;
}

test('generic strategy engine exposes implemented catalog',()=>{
  assert.deepEqual(
    STRATEGIES.map(x=>x.id),
    ['pmax','alphatrend','ott','tott','mavilimw','ssl_hybrid_flip']
  );
  assert.equal(new Set(STRATEGIES.map(x=>x.id)).size,STRATEGIES.length);
});

test('strategy engine is deterministic and finite on closed OHLCV',()=>{
  const candles=synthetic();
  const start=candles[0].t;
  const end=candles.at(-1).t+3600000;
  const a=evaluateStrategies(candles,{start,end});
  const b=evaluateStrategies(candles,{start,end});
  assert.deepEqual(a,b);
  assert.equal(a.length,STRATEGIES.length);
  for(const r of a){
    assert.ok(Number.isInteger(r.n)&&r.n>=0);
    for(const k of ['net','dd','exp','sh','net15','net6']) assert.ok(Number.isFinite(r[k]),`${r.id} ${k}`);
    assert.ok(r.dd>=0&&r.dd<=1);
    assert.ok(r.posseg>=0&&r.posseg<=3);
  }
});

test('SSL Hybrid flip adapter generates both directions on regime changes',()=>{
  const candles=synthetic();
  const start=candles[0].t;
  const end=candles.at(-1).t+3600000;
  const ssl=evaluateStrategies(candles,{start,end}).find(x=>x.id==='ssl_hybrid_flip');
  assert.ok(ssl);
  assert.ok(ssl.n>=2);
});
