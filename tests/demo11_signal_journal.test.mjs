import test from 'node:test';
import assert from 'node:assert/strict';
import { createStrategyState, stepStrategy } from '../research/demo11/strategy-core.mjs';
import {
  createSignalJournal,
  makeAtomicStrategyCommit,
  applyAtomicStrategyCommit,
} from '../research/demo11/signal-journal.mjs';

function candle(t,o=100,c=101){
  return {t,o,h:Math.max(o,c)+1,l:Math.min(o,c)-1,c,v:1000};
}

test('state event and cursor advance through one atomic journal commit',()=>{
  const initial=createStrategyState({symbol:'QUSDT',timeframe:'5m',intervalMs:300000,strategyId:'sr_range_edge'});
  const stepped=stepStrategy(initial,candle(0));
  const journal=createSignalJournal(initial);
  const envelope=makeAtomicStrategyCommit({previousState:initial,nextState:stepped.state,event:stepped.event});
  const next=applyAtomicStrategyCommit(journal,envelope);

  assert.equal(journal.head_state.state_hash,initial.state_hash);
  assert.equal(next.head_state.state_hash,stepped.state.state_hash);
  assert.equal(next.head_state.cursor_open_ts,0);
  assert.equal(next.commits.length,1);
});

test('re-applying the exact atomic commit is idempotent',()=>{
  const initial=createStrategyState({symbol:'QUSDT',timeframe:'5m',intervalMs:300000,strategyId:'sr_range_edge'});
  const stepped=stepStrategy(initial,candle(0));
  const env=makeAtomicStrategyCommit({previousState:initial,nextState:stepped.state,event:stepped.event});
  const once=applyAtomicStrategyCommit(createSignalJournal(initial),env);
  const twice=applyAtomicStrategyCommit(once,env);
  assert.equal(twice,once);
});

test('head mismatch cannot partially append state or event',()=>{
  const initial=createStrategyState({symbol:'QUSDT',timeframe:'5m',intervalMs:300000,strategyId:'sr_range_edge'});
  const s1=stepStrategy(initial,candle(0)).state;
  const s2=stepStrategy(s1,candle(300000,101,102)).state;
  const journal=createSignalJournal(initial);
  const bad=makeAtomicStrategyCommit({previousState:s1,nextState:s2,event:null});

  assert.throws(()=>applyAtomicStrategyCommit(journal,bad),/JOURNAL_HEAD_MISMATCH/);
  assert.equal(journal.head_state.state_hash,initial.state_hash);
  assert.equal(journal.events.length,0);
  assert.equal(journal.commits.length,0);
});
