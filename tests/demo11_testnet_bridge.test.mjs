import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDemo11TestnetBridge } from '../scripts/build-demo11-testnet-bridge.mjs';

function baseReport(){
  return {
    mode:'READ_ONLY_SHADOW',
    exchangeWrites:false,
    generatedAt:'2026-09-30T10:00:00Z',
    policyVersion:'demo11-v2',
    counts:{evaluated:2},
    hypotheticalIntents:[{
      intent_id:'int_1',
      client_order_id:'d11_1',
      symbol:'GUAUSDT',
      candle_close_ts:1000,
      side:'LONG',
      action:'ENTER_LONG',
      support_count:2,
      lead_signal_event_id:'sig_a',
      supporting_signal_event_ids:['sig_a','sig_b'],
      notional:100,
    }],
    rows:[
      {
        underlying:'GUA',symbol:'GUAUSDT',strategy:'a',timeframe:'15m',state_hash:'ha',
        signal:{direction:'LONG',transitionAgeBars:0},
        event:{event_id:'sig_a',side:'LONG',candle_close_ts:1000},
        execution_decision:{execution_decision_id:'dec_a',verdict:'ALLOW',reason:null}
      },
      {
        underlying:'GUA',symbol:'GUAUSDT',strategy:'b',timeframe:'15m',state_hash:'hb',
        signal:{direction:'LONG',transitionAgeBars:0},
        event:{event_id:'sig_b',side:'LONG',candle_close_ts:1000},
        execution_decision:{execution_decision_id:'dec_b',verdict:'ALLOW',reason:null}
      }
    ]
  };
}

test('only merged intent lead becomes executable fresh action',()=>{
  const out=buildDemo11TestnetBridge(baseReport());
  assert.equal(out.cohortId,'demo-11-canonical-v1');
  assert.equal(out.rows[0].status,'FRESH_ENTRY');
  assert.equal(out.rows[0].fresh,true);
  assert.equal(out.rows[0].action,'ENTER_LONG');
  assert.equal(out.rows[0].canonicalIntent.intent_id,'int_1');
  assert.equal(out.rows[1].status,'SUPPORTING_SIGNAL');
  assert.equal(out.rows[1].fresh,false);
});

test('DEFER never erases canonical direction and never becomes an order action',()=>{
  const r=baseReport();
  r.hypotheticalIntents=[];
  r.rows=[{
    underlying:'GUA',symbol:'GUAUSDT',strategy:'a',timeframe:'15m',
    signal:{direction:'LONG',transitionAgeBars:0},
    event:{event_id:'sig_a',side:'LONG',candle_close_ts:1000},
    execution_decision:{execution_decision_id:'dec_a',verdict:'DEFER',reason:'INFRA_STALE_MARKET_SNAPSHOT'}
  }];
  const out=buildDemo11TestnetBridge(r);
  assert.equal(out.rows[0].direction,'LONG');
  assert.equal(out.rows[0].status,'EXECUTION_DEFER');
  assert.equal(out.rows[0].fresh,false);
  assert.equal(out.rows[0].action,'HOLD_LONG');
  assert.equal(out.rows[0].executionStatus,'BLOCK');
});

test('flat ALLOW transition becomes explicit exit authority',()=>{
  const r=baseReport();
  r.hypotheticalIntents=[{
    intent_id:'int_exit',client_order_id:'d11_exit',symbol:'XUSDT',candle_close_ts:2000,
    side:'FLAT',action:'EXIT_TO_FLAT',support_count:1,lead_signal_event_id:'sig_exit',
    supporting_signal_event_ids:['sig_exit'],notional:null
  }];
  r.rows=[{
    underlying:'X',symbol:'XUSDT',strategy:'x',timeframe:'5m',
    signal:{direction:'FLAT',transitionAgeBars:0},
    event:{event_id:'sig_exit',side:'FLAT',candle_close_ts:2000},
    execution_decision:{execution_decision_id:'dec_exit',verdict:'ALLOW',reason:'STRATEGY_EXIT'}
  }];
  const out=buildDemo11TestnetBridge(r);
  assert.equal(out.rows[0].fresh,true);
  assert.equal(out.rows[0].status,'FRESH_EXIT');
  assert.equal(out.rows[0].action,'EXIT_TO_FLAT');
});
