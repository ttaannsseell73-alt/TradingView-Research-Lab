import test from 'node:test';
import assert from 'node:assert/strict';
import { updateShadowState } from '../scripts/build-shadow-journal.mjs';

const intent=(direction,price=100,time=1500)=>({
  underlying:'TEST',
  executionContract:'TESTUSDT',
  direction,
  executionStatus:'STRONG',
  supportCount:1,
  leadStrategy:'demo11-regression',
  leadTimeframe:'5m',
  signalTime:time-100,
  entryPrice:price,
  entryTime:time,
  entryReady:true,
  supportingSignals:[{strategy:'demo11-regression',timeframe:'5m'}],
  market:{mid:105,last:105}
});

test('Demo-11 regression: invalid market marks never synthesize zero-price PnL',()=>{
  const first=updateShadowState({
    snapshotAtMs:2000,
    dataAvailable:true,
    paperIntents:[intent('LONG')],
    rows:[{underlying:'TEST',executionStatus:'STRONG',market:{mid:102,last:102}}]
  },null);
  const lastValidMark=first.positions[0].markPrice;
  assert.ok(lastValidMark>0);

  const badMarkets=[
    {mid:null,last:null,bid:null,ask:null},
    {},
    {mid:0,last:0,bid:0,ask:0},
    {mid:NaN,last:NaN,bid:NaN,ask:NaN}
  ];

  for(let i=0;i<badMarkets.length;i++){
    const next=updateShadowState({
      snapshotAtMs:3000+i,
      dataAvailable:true,
      paperIntents:[],
      rows:[{underlying:'TEST',executionStatus:'STRONG',market:badMarkets[i]}]
    },first);
    assert.equal(next.positions.length,1);
    assert.equal(next.positions[0].markPrice,lastValidMark);
    assert.ok(next.positions[0].unrealizedNetIfClosed>-1);
    assert.equal(next.closedTrades.length,0);
  }
});
