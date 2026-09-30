import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEvidenceState,selectEventsSinceCursor,classifyEventFreshness,
  applyEvidenceCycle,validatePersistentCycle
} from '../research/demo11/evidence-state.mjs';

test('first observation arms cursor without backfilling historical events',()=>{
  const selected=selectEventsSinceCursor({
    events:[
      {event_id:'a',candle_close_ts:1000},
      {event_id:'b',candle_close_ts:2000}
    ],
    lastProcessedCloseTs:null,
    latestCloseTs:2000
  });
  assert.equal(selected.initialized,true);
  assert.deepEqual(selected.events,[]);
});

test('subsequent observation catches every unseen event in cursor range',()=>{
  const selected=selectEventsSinceCursor({
    events:[
      {event_id:'a',candle_close_ts:1000},
      {event_id:'b',candle_close_ts:2000},
      {event_id:'c',candle_close_ts:3000}
    ],
    lastProcessedCloseTs:1000,
    latestCloseTs:3000
  });
  assert.equal(selected.initialized,false);
  assert.deepEqual(selected.events.map(x=>x.event_id),['b','c']);
});

test('late event is MISSED rather than retroactively allowed or rejected',()=>{
  assert.deepEqual(
    classifyEventFreshness({eventCloseTs:1000,nowMs:2501,intervalMs:1000}),
    {status:'MISSED',reason:'OBSERVATION_LAG',ageMs:1501}
  );
  assert.deepEqual(
    classifyEventFreshness({eventCloseTs:2000,nowMs:2500,intervalMs:1000}),
    {status:'FRESH',ageMs:500}
  );
});

test('persistent totals accumulate without duplicating recent event ids',()=>{
  const initial=createEvidenceState(0);
  const cycle={
    generatedAt:new Date(1000).toISOString(),
    summary:{evaluated:10,notEvaluated:0,rawFreshObservations:1,transitions:1,allow:1,defer:0,reject:0,suppressed:0,missed:0,intentsCreated:1,arbiterSuppressed:0},
    decisionCoverage:['ALLOW'],
    cursors:{x:{lastProcessedCloseTs:1000}},
    events:[{event_id:'sig_x'}]
  };
  const a=applyEvidenceCycle(initial,cycle);
  const b=applyEvidenceCycle(a,cycle);
  assert.equal(b.totals.evaluated,20);
  assert.equal(b.recentEvents.length,1);
  assert.deepEqual(b.decisionCoverage,['ALLOW']);
});

test('persistent cycle conservation detects dropped decisions',()=>{
  const ok=validatePersistentCycle({
    expected:10,evaluated:10,notEvaluated:0,transitions:2,
    allow:1,defer:0,reject:0,suppressed:0,missed:1,
    intentsCreated:1,arbiterSuppressed:0
  });
  assert.equal(ok.ok,true);

  const bad=validatePersistentCycle({
    expected:10,evaluated:10,notEvaluated:0,transitions:2,
    allow:1,defer:0,reject:0,suppressed:0,missed:0,
    intentsCreated:1,arbiterSuppressed:0
  });
  assert.equal(bad.ok,false);
  assert.ok(bad.errors.includes('TRANSITION_DECISION_CONSERVATION'));
});
