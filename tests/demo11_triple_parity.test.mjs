import test from 'node:test';
import assert from 'node:assert/strict';
import { runTripleEventParity } from '../research/demo11/parity-harness.mjs';

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
  const out=[];let px=100;
  for(let i=0;i<n;i++){
    const drift=[0.5,-0.42,0.2,-0.28][Math.floor(i/32)%4];
    const o=px,c=Math.max(1,o+drift+Math.sin(i/3)*0.9+(i%47===0?2.2:0));
    out.push({t:i*interval,o,h:Math.max(o,c)+1,l:Math.min(o,c)-1,c,v:1000+(i%23)*90});
    px=c;
  }
  return out;
}

for(const [strategyId,timeframe,intervalMs] of cohort){
  test(`research shadow runtime SignalEvent hashes match for ${strategyId}`,()=>{
    const r=runTripleEventParity({
      config:{symbol:'TESTUSDT',timeframe,intervalMs,strategyId},
      candles:candles(180,intervalMs)
    });
    assert.deepEqual(r.shadow,r.research);
    assert.deepEqual(r.runtime,r.research);
    assert.equal(r.runtime_state_hash,r.research_state_hash);
  });
}
