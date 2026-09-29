import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCurrentSignals } from '../research/strategy_engine_v2.mjs';
import { createStrategyState, stepStrategy, signalSnapshot } from '../research/demo11/strategy-core.mjs';
import { DEMO11_STRATEGY_METADATA } from '../research/demo11/strategy-metadata.mjs';

const cohort=[
  ['sr25_trendline_breakout','15m',900000],
  ['sr25_fvg_first_touch','1h',3600000],
  ['sr_liquidity_sweep','15m',900000],
  ['sr25_poc_mean_reversion','5m',300000],
  ['sr25_camarilla_h3_l3','1m',60000],
  ['sr_range_edge','5m',300000],
  ['sr25_impulse_ob_retest','15m',900000],
];

function candles(n,interval){
  const out=[];
  let px=100;
  for(let i=0;i<n;i++){
    const regime=Math.floor(i/35)%4;
    const drift=[0.45,-0.38,0.18,-0.22][regime];
    const wave=Math.sin(i/3)*0.7+Math.cos(i/11)*0.35;
    const o=px;
    const c=Math.max(1,o+drift+wave);
    const h=Math.max(o,c)+0.8+(i%7===0?1.2:0);
    const l=Math.min(o,c)-0.8-(i%11===0?1.0:0);
    const v=1000+(i%17)*70+(i%29===0?1800:0);
    out.push({t:i*interval,o,h,l,c,v});
    px=c;
  }
  return out;
}

test('Demo-11 convergence metadata covers every selected cohort strategy',()=>{
  for(const [id] of cohort){
    assert.ok(DEMO11_STRATEGY_METADATA[id],id);
    assert.ok(DEMO11_STRATEGY_METADATA[id].warmup_bars>0);
    assert.ok(['BOUNDED_WINDOW','ANCHORED'].includes(DEMO11_STRATEGY_METADATA[id].convergence));
  }
});

for(const [strategyId,timeframe,intervalMs] of cohort){
  test(`StrategyCore preserves legacy closed-candle direction for ${strategyId}`,()=>{
    const series=candles(180,intervalMs);
    let state=createStrategyState({symbol:'TESTUSDT',timeframe,intervalMs,strategyId});
    let previousDirection='FLAT';

    for(let i=0;i<series.length;i++){
      const before=state;
      const result=stepStrategy(state,series[i]);
      assert.equal(result.gap,null);
      assert.equal(before.cursor_open_ts,i===0?null:series[i-1].t);
      state=result.state;

      const legacy=evaluateCurrentSignals(series.slice(0,i+1),{strategyIds:[strategyId]})[0];
      const snap=signalSnapshot(state);
      assert.equal(snap.direction,legacy.direction,`bar ${i}`);

      const directionChanged=legacy.direction!==previousDirection;
      assert.equal(Boolean(result.event),directionChanged,`transition parity at bar ${i}`);
      previousDirection=legacy.direction;
    }
  });
}

test('duplicate candle is idempotent and a time gap does not advance strategy state',()=>{
  const intervalMs=300000;
  const series=candles(3,intervalMs);
  let state=createStrategyState({symbol:'QUSDT',timeframe:'5m',intervalMs,strategyId:'sr_range_edge'});
  const first=stepStrategy(state,series[0]);
  state=first.state;
  const duplicate=stepStrategy(state,series[0]);
  assert.equal(duplicate.duplicate,true);
  assert.equal(duplicate.state.state_hash,state.state_hash);

  const gap=stepStrategy(state,series[2]);
  assert.ok(gap.gap);
  assert.equal(gap.state.state_hash,state.state_hash);
  assert.equal(gap.state.cursor_open_ts,series[0].t);
});
