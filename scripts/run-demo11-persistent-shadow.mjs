import fs from 'node:fs';
import path from 'node:path';
import { replayStrategy, signalSnapshot } from '../research/demo11/strategy-core.mjs';
import { evaluateExecutionGate } from '../research/demo11/execution-gate.mjs';
import { createIntentLedger, arbitrateIntentBatch } from '../research/demo11/intent-arbiter.mjs';
import {
  createEvidenceState,streamKey,selectEventsSinceCursor,classifyEventFreshness,
  applyEvidenceCycle,validatePersistentCycle
} from '../research/demo11/evidence-state.mjs';

const cohortPath=process.argv[2]??'research/demo_cohort_10.json';
const executionPath=process.argv[3]??'artifacts/demo11/execution/EXECUTION_WATCHLIST.json';
const candleDir=process.argv[4]??'artifacts/demo11/candles';
const outDir=process.argv[5]??'artifacts/demo11/persistent-shadow';
const policyPath=process.argv[6]??'research/tradability_policy_v2.json';
const statePath=process.argv[7]??path.join(outDir,'DEMO11_EVIDENCE_STATE.json');
const referenceNotional=Number(process.env.DEMO11_SHADOW_REFERENCE_NOTIONAL??100);
const intervalMs={'1m':60000,'5m':300000,'15m':900000,'1h':3600000,'4h':14400000,'1d':86400000};

const cohort=JSON.parse(fs.readFileSync(cohortPath,'utf8'));
const execution=JSON.parse(fs.readFileSync(executionPath,'utf8'));
const policy=JSON.parse(fs.readFileSync(policyPath,'utf8'));
const state=fs.existsSync(statePath)
  ? JSON.parse(fs.readFileSync(statePath,'utf8'))
  : createEvidenceState();

const byUnderlying=new Map((execution.candidates??[]).map(x=>[x.underlying,x]));
let marketSnapshotMs=Date.parse(execution.marketSnapshotAt??'');
if(!Number.isFinite(marketSnapshotMs)) marketSnapshotMs=null;

const nowMs=Date.now();
const rows=[];
const events=[];
const allowItems=[];
const cursors={};
let expected=0,evaluated=0,notEvaluated=0,rawFreshObservations=0;
let transitions=0,allow=0,defer=0,reject=0,suppressed=0,missed=0;

for(const candidate of cohort.deploymentCandidates??[]){
  const execRow=byUnderlying.get(candidate.underlying)??null;
  const symbol=execRow?.executionContract??candidate.contracts?.[0]??null;
  for(const combo of candidate.bestClean??[]){
    expected++;
    const timeframe=combo.timeframe;
    const strategyId=combo.strategy;
    const ms=intervalMs[timeframe];
    const row={
      underlying:candidate.underlying,symbol,timeframe,strategy:strategyId,
      status:'NOT_EVALUATED',reason:null,signal:null,newEvents:[]
    };
    rows.push(row);

    if(!symbol||!ms){
      notEvaluated++; row.reason='MISSING_SYMBOL_OR_INTERVAL'; continue;
    }
    const candlePath=path.join(candleDir,`${symbol}__${timeframe}.json`);
    if(!fs.existsSync(candlePath)){
      notEvaluated++; row.reason='MISSING_CANDLES'; continue;
    }

    const doc=JSON.parse(fs.readFileSync(candlePath,'utf8'));
    const candles=doc.candles??[];
    if(!candles.length){
      notEvaluated++; row.reason='EMPTY_CANDLES'; continue;
    }

    try{
      const replay=replayStrategy({symbol,timeframe,intervalMs:ms,strategyId},candles);
      const snap=signalSnapshot(replay.state);
      evaluated++;
      row.status='EVALUATED';
      row.signal=snap;
      row.state_hash=replay.state.state_hash;
      if(snap.rawFresh) rawFreshObservations++;

      const latestCloseTs=Number(candles.at(-1).t)+ms;
      const key=streamKey({symbol,timeframe,strategyId});
      const previousCursor=state.streams?.[key]?.lastProcessedCloseTs??null;
      const selected=selectEventsSinceCursor({
        events:replay.events,
        lastProcessedCloseTs:previousCursor,
        latestCloseTs
      });

      cursors[key]={
        symbol,timeframe,strategyId,
        initialized:previousCursor!==null,
        lastProcessedCloseTs:latestCloseTs,
        latestStateHash:replay.state.state_hash
      };

      if(selected.initialized){
        row.reason='ARMING_CURSOR_INITIALIZED';
        continue;
      }

      for(const event of selected.events){
        transitions++;
        const freshness=classifyEventFreshness({
          eventCloseTs:event.candle_close_ts,
          nowMs:Number(doc.snapshotAtMs??nowMs),
          intervalMs:ms
        });
        let decision;
        if(freshness.status==='MISSED'){
          missed++;
          decision={
            signal_event_id:event.event_id,
            verdict:'MISSED',
            reason:freshness.reason,
            age_ms:freshness.ageMs
          };
        }else{
          const market=execRow?.market??null;
          const snapshot=market?{
            ...market,
            snapshotAtMs:marketSnapshotMs??Number(doc.snapshotAtMs??nowMs),
            symbolStatus:'TRADING'
          }:null;
          decision=evaluateExecutionGate({
            event,
            armingResult:{status:'ELIGIBLE'},
            snapshot,
            orderNotional:referenceNotional,
            policy,
            nowMs:Number(doc.snapshotAtMs??nowMs)
          });
          if(decision.verdict==='ALLOW'){allow++;allowItems.push({event,decision});}
          else if(decision.verdict==='DEFER') defer++;
          else if(decision.verdict==='REJECT') reject++;
          else if(decision.verdict==='SUPPRESSED') suppressed++;
          else if(decision.verdict==='MISSED') missed++;
        }

        const ev={
          event_id:event.event_id,
          candle_close_ts:event.candle_close_ts,
          underlying:candidate.underlying,
          symbol,timeframe,strategy:strategyId,
          side:event.side,transition:event.transition,
          decision
        };
        events.push(ev);
        row.newEvents.push(ev);
      }
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
  requestedNotional:referenceNotional
});
const intentsCreated=arbitrated.ledger.intents.length;
const arbiterSuppressed=Math.max(0,allow-intentsCreated);

const summary={
  expected,evaluated,notEvaluated,rawFreshObservations,transitions,
  allow,defer,reject,suppressed,missed,intentsCreated,arbiterSuppressed
};
const validation=validatePersistentCycle(summary);
const decisionCoverage=[
  allow>0?'ALLOW':null,defer>0?'DEFER':null,reject>0?'REJECT':null
].filter(Boolean);

const cycle={
  schemaVersion:1,
  generatedAt:new Date(nowMs).toISOString(),
  mode:'READ_ONLY_SHADOW',
  exchangeWrites:false,
  summary,
  decisionCoverage,
  validation,
  cursors,
  events,
  hypotheticalIntents:arbitrated.ledger.intents,
  rows
};

const nextState=applyEvidenceCycle(state,cycle);
fs.mkdirSync(outDir,{recursive:true});
fs.writeFileSync(path.join(outDir,'DEMO11_PERSISTENT_CYCLE.json'),JSON.stringify(cycle,null,2)+'\n');
fs.writeFileSync(statePath,JSON.stringify(nextState,null,2)+'\n');
fs.appendFileSync(path.join(outDir,'DEMO11_CYCLES.jsonl'),JSON.stringify({
  generatedAt:cycle.generatedAt,summary:cycle.summary,decisionCoverage:cycle.decisionCoverage,
  validation:cycle.validation,totals:nextState.totals
})+'\n');

console.log(JSON.stringify({
  mode:cycle.mode,exchangeWrites:false,
  cycle:summary,cycleValidation:validation,
  totals:nextState.totals,decisionCoverage:nextState.decisionCoverage
},null,2));

if(!validation.ok) process.exit(3);
