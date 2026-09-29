import fs from 'node:fs';
import path from 'node:path';
import { replayStrategy, signalSnapshot } from '../research/demo11/strategy-core.mjs';
import { evaluateExecutionGate } from '../research/demo11/execution-gate.mjs';
import { createIntentLedger, arbitrateIntentBatch } from '../research/demo11/intent-arbiter.mjs';
import { createCensus, validateCensus } from '../research/demo11/census.mjs';

const cohortPath=process.argv[2]??'research/demo_cohort_10.json';
const executionPath=process.argv[3]??'artifacts/demo11/execution/EXECUTION_WATCHLIST.json';
const candleDir=process.argv[4]??'artifacts/demo11/candles';
const outDir=process.argv[5]??'artifacts/demo11/canonical-shadow';
const policyPath=process.argv[6]??'research/tradability_policy_v2.json';
const referenceNotional=Number(process.env.DEMO11_SHADOW_REFERENCE_NOTIONAL??100);

const intervalMs={ '1m':60000,'5m':300000,'15m':900000,'1h':3600000,'4h':14400000,'1d':86400000 };

const cohort=JSON.parse(fs.readFileSync(cohortPath,'utf8'));
const execution=JSON.parse(fs.readFileSync(executionPath,'utf8'));
const policy=JSON.parse(fs.readFileSync(policyPath,'utf8'));
const byUnderlying=new Map((execution.candidates??[]).map(x=>[x.underlying,x]));

let marketSnapshotMs=Date.parse(execution.marketSnapshotAt??'');
if(!Number.isFinite(marketSnapshotMs)) marketSnapshotMs=null;

const rows=[];
const allowItems=[];
let expected=0,evaluated=0,notEvaluated=0,rawSignals=0,transitions=0;
let allow=0,defer=0,reject=0,suppressed=0,missed=0;

for(const candidate of cohort.deploymentCandidates??[]){
  const execRow=byUnderlying.get(candidate.underlying)??null;
  const symbol=execRow?.executionContract??candidate.contracts?.[0]??null;
  for(const combo of candidate.bestClean??[]){
    expected++;
    const timeframe=combo.timeframe;
    const strategyId=combo.strategy;
    const ms=intervalMs[timeframe];
    const row={
      underlying:candidate.underlying,
      symbol,
      timeframe,
      strategy:strategyId,
      status:'NOT_EVALUATED',
      reason:null,
      signal:null,
      event:null,
      execution_decision:null,
      legacy_execution_status:execRow?.executionStatus??null,
    };
    rows.push(row);

    if(!symbol||!ms){
      notEvaluated++;
      row.reason='MISSING_SYMBOL_OR_INTERVAL';
      continue;
    }
    const candlePath=path.join(candleDir,`${symbol}__${timeframe}.json`);
    if(!fs.existsSync(candlePath)){
      notEvaluated++;
      row.reason='MISSING_CANDLES';
      continue;
    }
    const doc=JSON.parse(fs.readFileSync(candlePath,'utf8'));
    const candles=doc.candles??[];
    if(!candles.length){
      notEvaluated++;
      row.reason='EMPTY_CANDLES';
      continue;
    }

    try{
      const replay=replayStrategy({symbol,timeframe,intervalMs:ms,strategyId},candles);
      const snap=signalSnapshot(replay.state);
      evaluated++;
      row.status='EVALUATED';
      row.state_hash=replay.state.state_hash;
      row.signal=snap;
      if(snap.rawFresh) rawSignals++;

      const lastCandle=candles.at(-1);
      const lastClose=Number(lastCandle.t)+ms;
      const event=replay.events.at(-1)??null;
      const freshEvent=event&&Number(event.candle_close_ts)===lastClose?event:null;
      if(!freshEvent) continue;

      transitions++;
      row.event=freshEvent;
      const nowMs=Number(doc.snapshotAtMs??lastClose);
      const market=execRow?.market??null;
      const snapshot=market?{
        ...market,
        snapshotAtMs:marketSnapshotMs??nowMs,
        symbolStatus:'TRADING',
      }:null;
      const d=evaluateExecutionGate({
        event:freshEvent,
        armingResult:{status:'ELIGIBLE'},
        snapshot,
        orderNotional:referenceNotional,
        policy,
        nowMs,
      });
      row.execution_decision=d;
      if(d.verdict==='ALLOW'){ allow++; allowItems.push({event:freshEvent,decision:d}); }
      else if(d.verdict==='DEFER') defer++;
      else if(d.verdict==='REJECT') reject++;
      else if(d.verdict==='SUPPRESSED') suppressed++;
      else if(d.verdict==='MISSED') missed++;
    }catch(error){
      notEvaluated++;
      evaluated=Math.max(0,evaluated-1);
      row.status='NOT_EVALUATED';
      row.reason=String(error?.message??error);
    }
  }
}

const arbitrated=arbitrateIntentBatch({
  ledger:createIntentLedger(),
  items:allowItems,
  requestedNotional:referenceNotional,
});
const intentsCreated=arbitrated.ledger.intents.length;
const arbiterSuppressed=Math.max(0,allow-intentsCreated);

const census=createCensus({
  expected_evaluations:expected,
  evaluated,
  not_evaluated:notEvaluated,
  raw_signal_observations:rawSignals,
  transition_events:transitions,
  no_transition:evaluated-transitions,
  execution_allow:allow,
  execution_defer:defer,
  execution_reject:reject,
  execution_suppressed:suppressed,
  execution_missed:missed,
  intents_created:intentsCreated,
  arbiter_suppressed:arbiterSuppressed,
  intent_open:intentsCreated,
});
const censusValidation=validateCensus(census);

const out={
  schemaVersion:1,
  generatedAt:new Date().toISOString(),
  mode:'READ_ONLY_SHADOW',
  exchangeWrites:false,
  cohortId:cohort.cohortId??null,
  policyVersion:policy.policyVersion,
  referenceNotional,
  counts:{
    expected,evaluated,notEvaluated,rawSignals,transitions,
    allow,defer,reject,suppressed,missed,intentsCreated,arbiterSuppressed
  },
  census,
  censusValidation,
  hypotheticalIntents:arbitrated.ledger.intents,
  arbiterOutcomes:arbitrated.outcomes,
  rows,
};
fs.mkdirSync(outDir,{recursive:true});
fs.writeFileSync(path.join(outDir,'DEMO11_CANONICAL_SHADOW.json'),JSON.stringify(out,null,2)+'\n');
console.log(JSON.stringify({
  mode:out.mode,
  exchangeWrites:false,
  counts:out.counts,
  censusOk:censusValidation.ok,
},null,2));
if(!censusValidation.ok) process.exit(3);
