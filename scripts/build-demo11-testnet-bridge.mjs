import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

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

export function buildDemo11TestnetBridge(report){
  if(report?.mode!=='READ_ONLY_SHADOW') throw new Error('DEMO11_CANONICAL_SHADOW_REQUIRED');
  if(report?.exchangeWrites!==false) throw new Error('SOURCE_MUST_BE_READ_ONLY');

  const intents=Array.isArray(report?.hypotheticalIntents)?report.hypotheticalIntents:[];
  const intentByEvent=new Map();
  for(const intent of intents){
    for(const id of intent?.supporting_signal_event_ids??[]){
      intentByEvent.set(String(id),intent);
    }
  }

  const rows=(report?.rows??[]).map(row=>{
    const event=row?.event??null;
    const decision=row?.execution_decision??null;
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
    rows,
  };
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const input=process.argv[2]??'artifacts/demo11/canonical-shadow/DEMO11_CANONICAL_SHADOW.json';
  const output=process.argv[3]??'artifacts/demo11/testnet-bridge/DEMO11_TESTNET_SIGNAL.json';
  const report=JSON.parse(fs.readFileSync(input,'utf8'));
  const out=buildDemo11TestnetBridge(report);
  fs.mkdirSync(path.dirname(output),{recursive:true});
  fs.writeFileSync(output,JSON.stringify(out,null,2)+'\n','utf8');
  console.log(JSON.stringify({
    cohortId:out.cohortId,
    rows:out.rows.length,
    freshActions:out.rows.filter(x=>x.fresh).length,
    allow:out.rows.filter(x=>x.executionVerdict==='ALLOW').length,
    defer:out.rows.filter(x=>x.executionVerdict==='DEFER').length,
    reject:out.rows.filter(x=>x.executionVerdict==='REJECT').length,
  }));
}
