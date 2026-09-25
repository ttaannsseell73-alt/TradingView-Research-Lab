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
  assert.equal(second.positions[0].markPrice,109);
  assert.ok(Number.isFinite(second.positions[0].unrealizedNetIfClosed));
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


test('recent signal after previous snapshot is catch-up entered once',()=>{
  const previous={
    schemaVersion:1,
    createdAt:new Date(1000).toISOString(),
    updatedAt:new Date(1000).toISOString(),
    snapshotAtMs:1000,
    referenceNotional:1000,
    modeledRoundTripCost:0.0014,
    positions:[],
    closedTrades:[],
    events:[]
  };
  const current={
    snapshotAtMs:5000,
    paperIntents:[],
    recentSignalCandidates:[{
      underlying:'TEST',
      executionContract:'TESTUSDT',
      executionStatus:'STRONG',
      strategy:'ott',
      timeframe:'5m',
      direction:'LONG',
      canonicalEntryPrice:101,
      canonicalEntryTime:2000,
      lastSignalTime:1500,
      evidenceFlags:[],
      directionConflict:false,
      evidence:{trades:30,net:0.2,pf:1.4,dd:0.1},
      market:{mid:103,last:103}
    }],
    rows:[{underlying:'TEST',executionStatus:'STRONG',market:{mid:103,last:103}}]
  };
  const s=updateShadowState(current,previous);
  assert.equal(s.positions.length,1);
  assert.equal(s.positions[0].entryPrice,101);
  assert.equal(s.positions[0].intentSource,'CATCHUP_RECENT');
  const again=updateShadowState({...current,snapshotAtMs:6000},s);
  assert.equal(again.positions.length,1);
  assert.equal(again.summary.closedTrades,0);
});


test('data outage carries state forward without advancing snapshot',()=>{
  const first=updateShadowState({
    snapshotAtMs:2000,
    dataAvailable:true,
    paperIntents:[intent('LONG',100,1500)],
    rows:[{underlying:'TEST',executionStatus:'STRONG',market:{mid:102,last:102}}]
  },null);
  const second=updateShadowState({
    snapshotAtMs:9000,
    dataAvailable:false,
    paperIntents:[],
    rows:[]
  },first);
  assert.equal(second.positions.length,1);
  assert.equal(second.positions[0].entryPrice,100);
  assert.equal(second.snapshotAtMs,first.snapshotAtMs);
  assert.equal(second.lastAttemptStatus,'MARKET_DATA_UNAVAILABLE');
  assert.equal(second.summary.closedTrades,0);
});


test('long outage recovers latest post-snapshot reversal from current rows',()=>{
  const first=updateShadowState({
    snapshotAtMs:1000,
    dataAvailable:true,
    paperIntents:[intent('LONG',100,900)],
    rows:[{underlying:'TEST',executionStatus:'STRONG',market:{mid:101,last:101}}]
  },null);
  const current={
    snapshotAtMs:10000,
    dataAvailable:true,
    paperIntents:[],
    recentSignalCandidates:[],
    rows:[{
      underlying:'TEST',
      executionContract:'TESTUSDT',
      executionStatus:'STRONG',
      strategy:'ott',
      timeframe:'1h',
      direction:'SHORT',
      status:'ACTIVE_TREND',
      canonicalEntryPrice:95,
      canonicalEntryTime:4000,
      lastSignalTime:3000,
      evidenceFlags:[],
      directionConflict:false,
      evidence:{trades:30,net:0.2,pf:1.4,dd:0.1},
      market:{mid:94,last:94}
    }]
  };
  const second=updateShadowState(current,first);
  assert.equal(second.closedTrades.length,1);
  assert.equal(second.closedTrades[0].exitReason,'REVERSE_SIGNAL');
  assert.equal(second.closedTrades[0].exitPrice,95);
  assert.equal(second.positions.length,1);
  assert.equal(second.positions[0].direction,'SHORT');
  assert.equal(second.positions[0].entryPrice,95);
  assert.equal(second.positions[0].intentSource,'CATCHUP_RECENT');
});
