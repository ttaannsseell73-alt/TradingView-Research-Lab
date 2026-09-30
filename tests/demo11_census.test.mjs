import test from 'node:test';
import assert from 'node:assert/strict';
import { createCensus, validateCensus, explainCensusFailure } from '../research/demo11/census.mjs';

test('balanced census satisfies every conservation equation',()=>{
  const c=createCensus({
    expected_evaluations:10,
    evaluated:10,not_evaluated:0,
    raw_signal_observations:4,
    transition_events:3,no_transition:7,
    execution_allow:1,execution_defer:1,execution_reject:1,execution_suppressed:0,execution_missed:0,
    intents_created:1,arbiter_suppressed:0,
    intent_open:0,intent_filled:1,intent_cancelled:0,intent_expired:0,intent_rejected:0
  });
  const r=validateCensus(c);
  assert.equal(r.ok,true);
});

test('dropped event identifies the exact conservation layer',()=>{
  const r=validateCensus({
    expected_evaluations:10,evaluated:10,not_evaluated:0,
    transition_events:3,no_transition:7,
    execution_allow:1,execution_defer:0,execution_reject:1,execution_suppressed:0,execution_missed:0,
    intents_created:1,arbiter_suppressed:0,
    intent_filled:1
  });
  assert.equal(r.ok,false);
  assert.deepEqual(r.violations.map(x=>x.name),['TRANSITION_TO_EXECUTION_CONSERVATION']);
  assert.match(explainCensusFailure(r),/TRANSITION_TO_EXECUTION_CONSERVATION/);
});

test('missing intent after ALLOW is observable at arbiter layer',()=>{
  const r=validateCensus({
    expected_evaluations:1,evaluated:1,not_evaluated:0,
    transition_events:1,no_transition:0,
    execution_allow:1,execution_defer:0,execution_reject:0,execution_suppressed:0,execution_missed:0,
    intents_created:0,arbiter_suppressed:0
  });
  assert.equal(r.ok,false);
  assert.ok(r.violations.some(x=>x.name==='ALLOW_TO_ARBITER_CONSERVATION'));
});
