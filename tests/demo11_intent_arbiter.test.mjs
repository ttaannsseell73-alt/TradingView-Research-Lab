import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSignalEvent } from '../research/demo11/contracts.mjs';
import { createIntentLedger, arbitrateIntentBatch } from '../research/demo11/intent-arbiter.mjs';

function item({idSuffix='a',side='LONG',strategy='s1'}={}){
  const e=makeSignalEvent({
    symbol:'QUSDT',timeframe:'5m',strategyId:strategy, strategyVersion:'1',
    candleCloseTs:1000,transition:side==='LONG'?'FLAT→LONG':'FLAT→SHORT',
    side,stateBefore:0,stateAfter:side==='LONG'?1:-1,inputsHash:'h'+idSuffix
  });
  return {event:e,decision:{
    signal_event_id:e.event_id,execution_decision_id:'dec_'+idSuffix,
    verdict:'ALLOW',reason:null,max_notional:100
  }};
}

test('same SignalEvent cannot create a second intent',()=>{
  const x=item();
  const a=arbitrateIntentBatch({ledger:createIntentLedger(),items:[x],requestedNotional:80});
  assert.equal(a.ledger.intents.length,1);
  const b=arbitrateIntentBatch({ledger:a.ledger,items:[x],requestedNotional:80});
  assert.equal(b.ledger.intents.length,1);
  assert.equal(b.outcomes[0].status,'DUPLICATE');
});

test('same coin same direction multiple strategies collapse into one supported intent',()=>{
  const a=item({idSuffix:'a',side:'LONG',strategy:'s1'});
  const b=item({idSuffix:'b',side:'LONG',strategy:'s2'});
  const r=arbitrateIntentBatch({ledger:createIntentLedger(),items:[a,b],requestedNotional:80});
  assert.equal(r.ledger.intents.length,1);
  assert.equal(r.ledger.intents[0].support_count,2);
  assert.equal(r.ledger.intents[0].action,'ENTER_LONG');
});

test('same coin same close time opposing directions produce DIRECTION_CONFLICT and no intent',()=>{
  const r=arbitrateIntentBatch({
    ledger:createIntentLedger(),
    items:[item({idSuffix:'a',side:'LONG',strategy:'s1'}),item({idSuffix:'b',side:'SHORT',strategy:'s2'})],
    requestedNotional:80
  });
  assert.equal(r.ledger.intents.length,0);
  assert.equal(r.outcomes[0].status,'DIRECTION_CONFLICT');
});

test('existing same-side position suppresses re-entry',()=>{
  const r=arbitrateIntentBatch({
    ledger:createIntentLedger(),items:[item()],requestedNotional:80,
    openPositions:{QUSDT:{side:'LONG',quantity:1}}
  });
  assert.equal(r.ledger.intents.length,0);
  assert.equal(r.outcomes[0].status,'EXISTING_POSITION_SAME_SIDE');
});
