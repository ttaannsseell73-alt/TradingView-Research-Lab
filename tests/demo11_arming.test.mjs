import test from 'node:test';
import assert from 'node:assert/strict';
import { createArmingState, setArmingMode, armingEligibility } from '../research/demo11/arming.mjs';

function event(closeTs=2000){
  return {event_id:'sig_x',candle_close_ts:closeTs,transition:'FLAT→LONG',side:'LONG'};
}

test('historical events are journalable but suppressed before arming point',()=>{
  let a=createArmingState({liveArmingPoint:2000});
  a=setArmingMode(a,{mode:'ARMED'});
  const d=armingEligibility({arming:a,event:event(2000),nowMs:2100,intervalMs:1000});
  assert.deepEqual(d,{status:'SUPPRESSED',reason:'PRE_ARMING'});
});

test('first post-arming transition is eligible while fresh',()=>{
  let a=createArmingState({liveArmingPoint:2000});
  a=setArmingMode(a,{mode:'ARMED'});
  const d=armingEligibility({arming:a,event:event(2500),nowMs:2600,intervalMs:1000});
  assert.equal(d.status,'ELIGIBLE');
});

test('warm restart keeps arming point and stale downtime event becomes MISSED',()=>{
  const a=createArmingState({liveArmingPoint:2000,mode:'ARMED'});
  const restored=JSON.parse(JSON.stringify(a));
  const d=armingEligibility({arming:restored,event:event(2500),nowMs:4001,intervalMs:1000});
  assert.equal(restored.live_arming_point,2000);
  assert.deepEqual(d,{status:'MISSED',reason:'DOWNTIME',age_ms:1501});
});

test('state hash mismatch fails closed into DISARMED',()=>{
  let a=createArmingState({liveArmingPoint:2000});
  a=setArmingMode(a,{mode:'ARMED',expectedStateHash:'a',actualStateHash:'b'});
  assert.equal(a.mode,'DISARMED');
  assert.equal(a.reason,'STATE_HASH_MISMATCH');
  const d=armingEligibility({arming:a,event:event(3000),nowMs:3100,intervalMs:1000});
  assert.equal(d.status,'SUPPRESSED');
  assert.equal(d.reason,'STATE_HASH_MISMATCH');
});
