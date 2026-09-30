import test from 'node:test';
import assert from 'node:assert/strict';
import { positionManagementDecision } from '../research/demo11/position-policy.mjs';
import { createFillLedger, recordCanonicalFill } from '../research/demo11/fill-ledger.mjs';

test('execution DEFER or REJECT cannot flatten a protected open position',()=>{
  for(const verdict of ['DEFER','REJECT','SUPPRESSED','MISSED']){
    const d=positionManagementDecision({
      hasOpenPosition:true,isProtected:true,executionVerdict:verdict
    });
    assert.equal(d.action,'HOLD_PROTECTED');
  }
});

test('only explicit exit authorities can close an open position',()=>{
  for(const authority of ['STRATEGY_EXIT','PROTECTION_TRIGGER','EMERGENCY_STOP','PROTECTION_INSTALL_FAILED']){
    const d=positionManagementDecision({
      hasOpenPosition:true,isProtected:true,closeAuthority:authority,executionVerdict:'REJECT'
    });
    assert.equal(d.action,'CLOSE');
    assert.equal(d.reason,authority);
  }
});

test('unprotected open position halts and requests protection instead of accepting entry-gate semantics',()=>{
  const d=positionManagementDecision({hasOpenPosition:true,isProtected:false,executionVerdict:'ALLOW'});
  assert.equal(d.action,'HALT_AND_PROTECT');
});

test('orphan fill is critical and halts new entries for its symbol',()=>{
  const r=recordCanonicalFill(createFillLedger(),{
    symbol:'TRADOORUSDT',fill_id:'fill_x',exchange_order_id:'123'
  });
  assert.equal(r.status,'ORPHAN_FILL');
  assert.ok(r.ledger.halted_symbols.includes('TRADOORUSDT'));
  assert.equal(r.ledger.incidents[0].type,'ORPHAN_FILL');
});

test('valid fill is recorded once and duplicate delivery is idempotent',()=>{
  const fill={
    symbol:'GUAUSDT',
    signal_event_id:'sig_x',
    execution_verdict:'ALLOW',
    execution_decision_id:'dec_x',
    intent_id:'int_x',
    client_order_id:'d11_x',
    exchange_order_id:'123',
    fill_id:'fill_x'
  };
  const a=recordCanonicalFill(createFillLedger(),fill);
  assert.equal(a.status,'RECORDED');
  const b=recordCanonicalFill(a.ledger,fill);
  assert.equal(b.status,'DUPLICATE');
  assert.equal(b.ledger.fills.length,1);
});
