import test from 'node:test';
import assert from 'node:assert/strict';
import { createStrategyState, stepStrategy } from '../research/demo11/strategy-core.mjs';

const cohort=[
  ['sr25_trendline_breakout','15m',900000],
  ['sr25_fvg_first_touch','1h',3600000],
  ['sr_liquidity_sweep','15m',900000],
  ['sr25_poc_mean_reversion','5m',300000],
  ['sr25_camarilla_h3_l3','1m',60000],
  ['sr_range_edge','5m',300000],
  ['sr25_impulse_ob_retest','15m',900000],
];

function series(n,interval){
  const out=[]; let px=100;
  for(let i=0;i<n;i++){
    const block=Math.floor(i/30)%5;
    const drift=[0.55,-0.48,0.22,-0.31,0.08][block];
    const shock=i%41===0?(block%2? -2.7:2.9):0;
    const wave=Math.sin(i/2.7)*0.8+Math.cos(i/9.1)*0.4;
    const o=px, c=Math.max(1,o+drift+wave+shock);
    out.push({
      t:i*interval,
      o,
      h:Math.max(o,c)+0.9+(i%13===0?1.4:0),
      l:Math.min(o,c)-0.9-(i%17===0?1.1:0),
      c,
      v:900+(i%19)*83+(i%37===0?2200:0),
    });
    px=c;
  }
  return out;
}

function run(config,candles,{restartAt=null,duplicateAt=null}={}){
  let state=createStrategyState(config);
  const trace=[];
  for(let i=0;i<candles.length;i++){
    if(i===restartAt){
      state=JSON.parse(JSON.stringify(state));
    }
    const r=stepStrategy(state,candles[i]);
    assert.equal(r.gap,null);
    state=r.state;
    trace.push({state_hash:state.state_hash,event_id:r.event?.event_id??null});
    if(i===duplicateAt){
      const d=stepStrategy(state,candles[i]);
      assert.equal(d.duplicate,true);
      assert.equal(d.state.state_hash,state.state_hash);
    }
  }
  return {state,trace};
}

for(const [strategyId,timeframe,intervalMs] of cohort){
  test(`restart parity is exact for ${strategyId}`,()=>{
    const candles=series(170,intervalMs);
    const config={symbol:'TESTUSDT',timeframe,intervalMs,strategyId};
    const baseline=run(config,candles);
    for(const point of [1,39,79,119,150]){
      const restarted=run(config,candles,{restartAt:point,duplicateAt:point});
      assert.deepEqual(restarted.trace,baseline.trace,`restart point ${point}`);
      assert.equal(restarted.state.state_hash,baseline.state.state_hash);
    }
  });
}

test('gap blocks progress until missing candle is backfilled, then parity recovers',()=>{
  const intervalMs=300000;
  const candles=series(100,intervalMs);
  const config={symbol:'QUSDT',timeframe:'5m',intervalMs,strategyId:'sr_range_edge'};

  const baseline=run(config,candles);
  let state=createStrategyState(config);
  const trace=[];

  for(let i=0;i<50;i++){
    const r=stepStrategy(state,candles[i]);
    state=r.state;
    trace.push({state_hash:state.state_hash,event_id:r.event?.event_id??null});
  }

  const blocked=stepStrategy(state,candles[51]);
  assert.ok(blocked.gap);
  assert.equal(blocked.state.state_hash,state.state_hash);

  for(const i of [50,51]){
    const r=stepStrategy(state,candles[i]);
    state=r.state;
    trace.push({state_hash:state.state_hash,event_id:r.event?.event_id??null});
  }
  for(let i=52;i<candles.length;i++){
    const r=stepStrategy(state,candles[i]);
    state=r.state;
    trace.push({state_hash:state.state_hash,event_id:r.event?.event_id??null});
  }

  assert.deepEqual(trace,baseline.trace);
  assert.equal(state.state_hash,baseline.state.state_hash);
});
