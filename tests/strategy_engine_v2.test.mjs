import test from 'node:test';
import assert from 'node:assert/strict';
import { STRATEGIES, evaluateStrategies, evaluateCurrentSignals } from '../research/strategy_engine_v2.mjs';

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
    ['pmax','alphatrend','ott','tott','mavilimw','ssl_hybrid_flip','ssl_hybrid_qqe_flip','ut_bot_quantnomad','chandelier_zlsma','squeeze_momentum','qqe_ssl_wae','turtle_trade_channels','isolated_peak_bottom','volume_coloured_bars','follow_line','squeeze_momentum_v2','progressive_trend_tracker','turtle_vhf_filtered']
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

test('SSL Hybrid QQE adapter is present and deterministic',()=>{
  const candles=synthetic();
  const start=candles[0].t;
  const end=candles.at(-1).t+3600000;
  const a=evaluateStrategies(candles,{start,end}).find(x=>x.id==='ssl_hybrid_qqe_flip');
  const b=evaluateStrategies(candles,{start,end}).find(x=>x.id==='ssl_hybrid_qqe_flip');
  assert.ok(a);
  assert.deepEqual(a,b);
  for(const k of ['net','dd','exp','sh','net15','net6']) assert.ok(Number.isFinite(a[k]),k);
});

test('UT Bot QuantNomad adapter is deterministic and active',()=>{
  const candles=synthetic(1200);
  const start=candles[0].t;
  const end=candles.at(-1).t+3600000;
  const a=evaluateStrategies(candles,{start,end}).find(x=>x.id==='ut_bot_quantnomad');
  const b=evaluateStrategies(candles,{start,end}).find(x=>x.id==='ut_bot_quantnomad');
  assert.ok(a);
  assert.deepEqual(a,b);
  assert.ok(a.n>0);
  for(const k of ['net','dd','exp','sh','net15','net6']) assert.ok(Number.isFinite(a[k]),k);
});

test('Chandelier ZLSMA uses target-position execution and remains finite',()=>{
  const candles=synthetic(1800);
  const start=candles[0].t;
  const end=candles.at(-1).t+3600000;
  const r=evaluateStrategies(candles,{start,end}).find(x=>x.id==='chandelier_zlsma');
  assert.ok(r);
  assert.equal(r.mode,'TARGET_POSITION');
  for(const k of ['net','dd','exp','sh','net15','net6']) assert.ok(Number.isFinite(r[k]),k);
});


test('current signal state is deterministic and closed-candle only',()=>{
  const candles=synthetic(900);
  const intervalMs=3600000;
  const last=candles.at(-1);
  const asOf=last.t+Math.floor(intervalMs/2); // final candle is still open
  const a=evaluateCurrentSignals(candles,{asOf,intervalMs});
  const b=evaluateCurrentSignals(candles.slice(0,-1),{asOf,intervalMs});
  assert.deepEqual(a,b);
  assert.equal(a.length,STRATEGIES.length);
  for(const r of a){
    assert.ok(['LONG','SHORT','FLAT'].includes(r.direction));
    assert.ok(['ENTER_LONG','ENTER_SHORT','HOLD_LONG','HOLD_SHORT','EXIT_TO_FLAT','FLAT'].includes(r.action));
    assert.equal(r.lastClosedBarTime,candles.at(-2).t);
    assert.ok(r.signalAgeBars===null||Number.isInteger(r.signalAgeBars));
  }
});

test('current signal supports strategy filtering and target-position flat state',()=>{
  const candles=synthetic(1800);
  const asOf=candles.at(-1).t+3600000;
  const r=evaluateCurrentSignals(candles,{
    asOf,
    intervalMs:3600000,
    strategyIds:['chandelier_zlsma']
  });
  assert.equal(r.length,1);
  assert.equal(r[0].id,'chandelier_zlsma');
  assert.equal(r[0].mode,'TARGET_POSITION');
  assert.ok(['LONG','SHORT','FLAT'].includes(r[0].direction));
  assert.ok(Number.isInteger(r[0].barsUsed)&&r[0].barsUsed>0);
});
