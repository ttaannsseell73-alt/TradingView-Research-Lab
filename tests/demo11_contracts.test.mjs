import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalJson,
  signalEventId,
  makeSignalEvent,
  executionDecisionId,
  intentIdForSignal,
  clientOrderIdForIntent,
  fillId,
  validateLineage,
} from '../research/demo11/contracts.mjs';

test('canonical json is key-order independent',()=>{
  assert.equal(canonicalJson({b:2,a:{d:4,c:3}}),canonicalJson({a:{c:3,d:4},b:2}));
});

test('signal event id is deterministic and execution-independent',()=>{
  const base={
    symbol:'GUAUSDT',timeframe:'15m',strategyId:'sr25_trendline_breakout',
    strategyVersion:'sr25-v1',candleCloseTs:1000,transition:'FLAT→LONG'
  };
  const a=signalEventId(base);
  const b=signalEventId({...base,spreadBps:999,executionStatus:'BLOCK'});
  assert.equal(a,b);
});

test('signal event is immutable',()=>{
  const e=makeSignalEvent({
    symbol:'GUAUSDT',timeframe:'15m',strategyId:'sr25_trendline_breakout',
    strategyVersion:'sr25-v1',candleCloseTs:1000,transition:'FLAT→LONG',
    side:'LONG',stateBefore:0,stateAfter:1,inputsHash:'abc'
  });
  assert.equal(Object.isFrozen(e),true);
  assert.throws(()=>{e.side='SHORT';},TypeError);
});

test('lineage ids are deterministic and client order id stays within Binance bound',()=>{
  const sid='sig_example';
  const did=executionDecisionId({signalEventId:sid,policyVersion:'d11-v1',snapshotTs:2000,verdict:'ALLOW',reason:null});
  const iid=intentIdForSignal(sid);
  const cid=clientOrderIdForIntent(iid);
  const fid=fillId({symbol:'GUAUSDT',exchangeOrderId:'123',tradeId:'7',eventTime:3000});
  assert.equal(did,executionDecisionId({signalEventId:sid,policyVersion:'d11-v1',snapshotTs:2000,verdict:'ALLOW',reason:null}));
  assert.equal(iid,intentIdForSignal(sid));
  assert.ok(cid.length<=36);
  assert.match(fid,/^fill_/);
});

test('orphan or incomplete fill lineage is critical',()=>{
  const bad=validateLineage({fill_id:'fill_x',exchange_order_id:'1'});
  assert.equal(bad.ok,false);
  assert.ok(bad.errors.includes('MISSING_SIGNAL_EVENT_ID'));
  assert.ok(bad.errors.includes('ORPHAN_FILL'));

  const good=validateLineage({
    signal_event_id:'sig_x',
    execution_verdict:'ALLOW',
    execution_decision_id:'dec_x',
    intent_id:'int_x',
    client_order_id:'d11_x',
    exchange_order_id:'1',
    fill_id:'fill_x'
  });
  assert.equal(good.ok,true);
});
