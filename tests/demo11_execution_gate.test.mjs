import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSignalEvent } from '../research/demo11/contracts.mjs';
import { evaluateExecutionGate } from '../research/demo11/execution-gate.mjs';

const policy=JSON.parse(fs.readFileSync(new URL('../research/tradability_policy_v2.json',import.meta.url),'utf8'));

function event(side='LONG'){
  return makeSignalEvent({
    symbol:'GUAUSDT',timeframe:'15m',strategyId:'sr25_trendline_breakout',strategyVersion:'sr25-v1',
    candleCloseTs:1000,transition:side==='LONG'?'FLAT→LONG':'FLAT→SHORT',side,
    stateBefore:0,stateAfter:side==='LONG'?1:-1,inputsHash:'h'
  });
}
const armed={status:'ELIGIBLE'};
const gua={
  snapshotAtMs:1100,symbolStatus:'TRADING',spreadBps:5.79,
  bidDepth10bps:173,askDepth10bps:590,quoteVolume24h:695000,openInterestNotional:4040000
};

test('GUA directional depth allows LONG and rejects SHORT on the same snapshot',()=>{
  const long=evaluateExecutionGate({event:event('LONG'),armingResult:armed,snapshot:gua,orderNotional:100,policy,nowMs:1200});
  const short=evaluateExecutionGate({event:event('SHORT'),armingResult:armed,snapshot:gua,orderNotional:100,policy,nowMs:1200});
  assert.equal(long.verdict,'ALLOW');
  assert.ok(long.warnings.includes('EXIT_LIQUIDITY_WARNING'));
  assert.equal(short.verdict,'REJECT');
  assert.equal(short.reason,'ENTRY_DEPTH_HARD');
});

test('missing and stale snapshots DEFER as infrastructure faults',()=>{
  const missing=evaluateExecutionGate({event:event(),armingResult:armed,snapshot:null,orderNotional:100,policy,nowMs:1200});
  assert.equal(missing.verdict,'DEFER');
  assert.match(missing.reason,/^INFRA_/);

  const stale=evaluateExecutionGate({event:event(),armingResult:armed,snapshot:{...gua,snapshotAtMs:0},orderNotional:100,policy,nowMs:6000});
  assert.equal(stale.verdict,'DEFER');
  assert.equal(stale.reason,'INFRA_STALE_MARKET_SNAPSHOT');
});

test('low volume or OI warns but does not erase or hard-block a valid signal',()=>{
  const e=event('LONG');
  const before=JSON.stringify(e);
  const d=evaluateExecutionGate({
    event:e,armingResult:armed,snapshot:{...gua,quoteVolume24h:1,openInterestNotional:1},
    orderNotional:100,policy,nowMs:1200
  });
  assert.equal(d.verdict,'ALLOW');
  assert.ok(d.warnings.includes('COHORT_VOLUME_WARNING'));
  assert.ok(d.warnings.includes('COHORT_OI_WARNING'));
  assert.equal(JSON.stringify(e),before);
});

test('strategy FLAT exit bypasses entry-quality depth gate',()=>{
  const e=makeSignalEvent({
    symbol:'GUAUSDT',timeframe:'15m',strategyId:'x',strategyVersion:'1',
    candleCloseTs:1000,transition:'LONG→FLAT',side:'FLAT',stateBefore:1,stateAfter:0,inputsHash:'h'
  });
  const d=evaluateExecutionGate({event:e,armingResult:armed,snapshot:{...gua,bidDepth10bps:0,askDepth10bps:0},orderNotional:100,policy,nowMs:1200});
  assert.equal(d.verdict,'ALLOW');
  assert.equal(d.reason,'STRATEGY_EXIT');
});
