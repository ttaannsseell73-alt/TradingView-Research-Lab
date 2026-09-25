import test from 'node:test';
import assert from 'node:assert/strict';
import { updateShadowState } from '../scripts/build-shadow-journal.mjs';

const market={mid:105,last:105};
const baseCurrent=(intent,rows=[])=>({
  snapshotAtMs:2000,
  paperIntents:intent?[intent]:[],
  rows
});
const intent=(direction,price=100,time=1000)=>({
  underlying:'TEST',
  executionContract:'TESTUSDT',
  direction,
  executionStatus:'STRONG',
  supportCount:2,
  leadStrategy:'ott',
  leadTimeframe:'4h',
  signalTime:900,
  entryPrice:price,
  entryTime:time,
  entryReady:true,
  supportingSignals:[{strategy:'ott',timeframe:'4h'}],
  market
});

test('shadow journal opens one normalized position from a fresh paper intent',()=>{
  const s=updateShadowState(baseCurrent(intent('LONG')),null);
  assert.equal(s.positions.length,1);
  assert.equal(s.positions[0].direction,'LONG');
  assert.equal(s.positions[0].entryPrice,100);
  assert.equal(s.summary.closedTrades,0);
  assert.equal(s.positions[0].supportCount,2);
});

test('same-direction repeat updates support without duplicating the position',()=>{
  const first=updateShadowState(baseCurrent(intent('LONG')),null);
  const secondIntent={...intent('LONG'),supportCount:3,entryTime:3000,entryPrice:106,market:{mid:107,last:107}};
  const second=updateShadowState({
    snapshotAtMs:4000,
    paperIntents:[secondIntent],
    rows:[{underlying:'TEST',executionStatus:'STRONG',market:{mid:107,last:107}}]
  },first);
  assert.equal(second.positions.length,1);
  assert.equal(second.positions[0].entryPrice,100);
  assert.equal(second.positions[0].supportCount,3);
  assert.equal(second.summary.closedTrades,0);
});

test('opposite fresh intent closes and reverses exactly once',()=>{
  const first=updateShadowState(baseCurrent(intent('LONG')),null);
  const short={...intent('SHORT',110,5000),market:{mid:109,last:109}};
  const second=updateShadowState({
    snapshotAtMs:6000,
    paperIntents:[short],
    rows:[{underlying:'TEST',executionStatus:'STRONG',market:{mid:109,last:109}}]
  },first);
  assert.equal(second.positions.length,1);
  assert.equal(second.positions[0].direction,'SHORT');
  assert.equal(second.positions[0].entryPrice,110);
  assert.equal(second.closedTrades.length,1);
  assert.equal(second.closedTrades[0].direction,'LONG');
  assert.equal(second.closedTrades[0].exitReason,'REVERSE_SIGNAL');
  assert.equal(second.closedTrades[0].exitPrice,110);
});

test('hard tradability block force-closes at current mark',()=>{
  const first=updateShadowState(baseCurrent(intent('LONG')),null);
  const second=updateShadowState({
    snapshotAtMs:7000,
    paperIntents:[],
    rows:[{underlying:'TEST',executionStatus:'BLOCK',market:{mid:90,last:90}}]
  },first);
  assert.equal(second.positions.length,0);
  assert.equal(second.closedTrades.length,1);
  assert.equal(second.closedTrades[0].exitReason,'TRADABILITY_BLOCK');
  assert.equal(second.closedTrades[0].exitPrice,90);
});
