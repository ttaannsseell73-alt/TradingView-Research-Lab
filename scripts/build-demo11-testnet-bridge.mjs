import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createIntentLedger, arbitrateIntentBatch } from '../research/demo11/intent-arbiter.mjs';

function marketReferencePrice(market){
  const mid=Number(market?.mid);
  if(Number.isFinite(mid)&&mid>0) return mid;
  const last=Number(market?.last);
  if(Number.isFinite(last)&&last>0) return last;
  const bid=Number(market?.bid);
  const ask=Number(market?.ask);
  if(Number.isFinite(bid)&&bid>0&&Number.isFinite(ask)&&ask>0) return (bid+ask)/2;
  return null;
}

const timeframeMs={ '1m':60000,'5m':300000,'15m':900000,'1h':3600000,'4h':14400000,'1d':86400000 };

export function buildDemo11TestnetBridge(report,evidenceState=null,nowMs=Date.now()){
  if(report?.mode!=='READ_ONLY_SHADOW') throw new Error('DEMO11_CANONICAL_SHADOW_REQUIRED');
  if(report?.exchangeWrites!==false) throw new Error('SOURCE_MUST_BE_READ_ONLY');

  const canonicalIntents=Array.isArray(report?.hypotheticalIntents)?report.hypotheticalIntents:[];
  const currentEventIds=new Set((report?.rows??[]).map(x=>x?.event?.event_id).filter(Boolean).map(String));
  const rowByStream=new Map((report?.rows??[]).map(row=>[
    [row?.underlying,row?.symbol,row?.timeframe,row?.strategy].map(x=>String(x??'')).join('|'),
    row
  ]));
  const latestCatchupByStream=new Map();
  for(const x of evidenceState?.recentEvents??[]){
    const interval=Number(timeframeMs[String(x?.timeframe??'')]??0);
    const close=Number(x?.candle_close_ts);
    const age=Number(nowMs)-close;
    if(!(interval>0)||!Number.isFinite(close)||age<0||age>interval) continue;
    if(x?.decision?.verdict!=='ALLOW'||currentEventIds.has(String(x?.event_id??''))) continue;
    const key=[x?.underlying,x?.symbol,x?.timeframe,x?.strategy].map(v=>String(v??'')).join('|');
    const row=rowByStream.get(key);
    if(!row||String(row?.signal?.direction??'')!==String(x?.side??'')) continue;
    const prior=latestCatchupByStream.get(key);
    if(!prior||Number(x.candle_close_ts)>Number(prior.candle_close_ts)) latestCatchupByStream.set(key,x);
  }

  const catchupItems=[...latestCatchupByStream.values()].map(x=>({
    event:{
      event_id:String(x.event_id),
      symbol:String(x.symbol),
      candle_close_ts:Number(x.candle_close_ts),
      side:String(x.side),
    },
    decision:x.decision,
  }));
  const catchupArbitrated=arbitrateIntentBatch({
    ledger:createIntentLedger(),
    items:catchupItems,
    requestedNotional:Number(report?.referenceNotional??100),
  });
  const allIntents=[...canonicalIntents,...catchupArbitrated.ledger.intents];
  const intents=[...new Map(allIntents.map(x=>[String(x.intent_id),x])).values()];
  const intentByEvent=new Map();
  for(const intent of intents){
    for(const id of intent?.supporting_signal_event_ids??[]){
      intentByEvent.set(String(id),intent);
    }
  }

  const catchupByStream=new Map([...latestCatchupByStream.entries()]);
  const rows=(report?.rows??[]).map(row=>{
    const streamKey=[row?.underlying,row?.symbol,row?.timeframe,row?.strategy].map(x=>String(x??'')).join('|');
    const catchup=catchupByStream.get(streamKey)??null;
    const event=row?.event??(catchup?{
      event_id:String(catchup.event_id),
      symbol:String(catchup.symbol),
      candle_close_ts:Number(catchup.candle_close_ts),
      side:String(catchup.side),
    }:null);
    const decision=row?.execution_decision??catchup?.decision??null;
    const eventId=event?.event_id?String(event.event_id):null;
    const intent=eventId?intentByEvent.get(eventId)??null:null;
    const isLead=Boolean(intent&&eventId===String(intent.lead_signal_event_id));
    const allowed=decision?.verdict==='ALLOW';
    const executable=Boolean(event&&allowed&&intent&&isLead);
    const side=event?.side??row?.signal?.direction??'FLAT';

    let status='ACTIVE_TREND';
    if(!event) status=side==='FLAT'?'FLAT':'ACTIVE_TREND';
    else if(decision?.verdict==='DEFER') status='EXECUTION_DEFER';
    else if(decision?.verdict==='REJECT') status='EXECUTION_REJECT';
    else if(decision?.verdict==='SUPPRESSED') status='SUPPRESSED';
    else if(decision?.verdict==='MISSED') status='MISSED';
    else if(allowed&&!intent) status='ARBITER_SUPPRESSED';
    else if(allowed&&intent&&!isLead) status='SUPPORTING_SIGNAL';
    else if(executable) status=side==='FLAT'?'FRESH_EXIT':'FRESH_ENTRY';

    const action=executable
      ? side==='LONG'?'ENTER_LONG':side==='SHORT'?'ENTER_SHORT':'EXIT_TO_FLAT'
      : side==='LONG'?'HOLD_LONG':side==='SHORT'?'HOLD_SHORT':'FLAT';

    return {
      underlying:row?.underlying??null,
      executionContract:row?.symbol??null,
      strategy:row?.strategy??null,
      timeframe:row?.timeframe??null,
      status,
      direction:side,
      action,
      fresh:executable,
      directionConflict:false,
      canonicalEntryTime:event?.candle_close_ts??null,
      signalAgeBars:event?0:(row?.signal?.transitionAgeBars??null),
      executionStatus:allowed?'STRONG':'BLOCK',
      canonicalSignalEventId:eventId,
      canonicalExecutionDecisionId:decision?.execution_decision_id??null,
      executionVerdict:decision?.verdict??null,
      executionReason:decision?.reason??null,
      canonicalIntent:intent??null,
      canonicalStateHash:row?.state_hash??null,
      referencePrice:marketReferencePrice(row?.market),
      catchup:Boolean(catchup&&!row?.event),
      source:catchup&&!row?.event?'RECENT_EVENT_CATCHUP':'CURRENT_CANDLE',
    };
  });

  return {
    schemaVersion:1,
    cohortId:'demo-11-canonical-v1',
    generatedAt:new Date().toISOString(),
    sourceGeneratedAt:report?.generatedAt??null,
    mode:'BINANCE_USDM_TESTNET_BRIDGE',
    productionOrders:false,
    dataAvailable:Number(report?.counts?.evaluated??0)>0,
    canonicalPolicyVersion:report?.policyVersion??null,
    catchupActions:rows.filter(x=>x.catchup&&x.fresh).length,
    rows,
  };
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const input=process.argv[2]??'artifacts/demo11/canonical-shadow/DEMO11_CANONICAL_SHADOW.json';
  const output=process.argv[3]??'artifacts/demo11/testnet-bridge/DEMO11_TESTNET_SIGNAL.json';
  const evidencePath=process.argv[4]??'artifacts/demo11/persistent-shadow/DEMO11_EVIDENCE_STATE.json';
  const report=JSON.parse(fs.readFileSync(input,'utf8'));
  const evidence=fs.existsSync(evidencePath)?JSON.parse(fs.readFileSync(evidencePath,'utf8')):null;
  const out=buildDemo11TestnetBridge(report,evidence);
  fs.mkdirSync(path.dirname(output),{recursive:true});
  fs.writeFileSync(output,JSON.stringify(out,null,2)+'\n','utf8');
  console.log(JSON.stringify({
    cohortId:out.cohortId,
    rows:out.rows.length,
    freshActions:out.rows.filter(x=>x.fresh).length,
    catchupActions:out.catchupActions,
    allow:out.rows.filter(x=>x.executionVerdict==='ALLOW').length,
    defer:out.rows.filter(x=>x.executionVerdict==='DEFER').length,
    reject:out.rows.filter(x=>x.executionVerdict==='REJECT').length,
  }));
}
