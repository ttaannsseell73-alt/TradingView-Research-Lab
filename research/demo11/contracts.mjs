import { createHash } from 'node:crypto';

function stable(value){
  if(Array.isArray(value)) return value.map(stable);
  if(value&&typeof value==='object'){
    return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));
  }
  return value;
}

export function canonicalJson(value){
  return JSON.stringify(stable(value));
}

export function sha256(value){
  return createHash('sha256').update(typeof value==='string'?value:canonicalJson(value)).digest('hex');
}

export function signalEventId({symbol,timeframe,strategyId,strategyVersion,candleCloseTs,transition}){
  return 'sig_'+sha256({symbol,timeframe,strategyId,strategyVersion,candleCloseTs,transition}).slice(0,32);
}

export function makeSignalEvent(input){
  const event={
    event_id:signalEventId(input),
    symbol:String(input.symbol),
    timeframe:String(input.timeframe),
    strategy_id:String(input.strategyId),
    strategy_version:String(input.strategyVersion),
    candle_close_ts:Number(input.candleCloseTs),
    transition:String(input.transition),
    side:String(input.side),
    signal_age_bars:0,
    state_before:Number(input.stateBefore),
    state_after:Number(input.stateAfter),
    inputs_hash:String(input.inputsHash),
  };
  return Object.freeze(event);
}

export function executionDecisionId({signalEventId:signalId,policyVersion,snapshotTs,verdict,reason}){
  return 'dec_'+sha256({signalId,policyVersion,snapshotTs,verdict,reason:reason??null}).slice(0,32);
}

export function intentIdForSignals(signalIds){
  const ids=[...new Set((signalIds??[]).map(String))].sort();
  if(!ids.length) throw new Error('SIGNAL_IDS_REQUIRED');
  return 'int_'+sha256({signalIds:ids}).slice(0,32);
}

export function intentIdForSignal(signalId){
  return intentIdForSignals([signalId]);
}

export function clientOrderIdForIntent(intentId){
  return ('d11-'+sha256({intentId}).slice(0,28)).slice(0,36);
}

export function fillId({symbol,exchangeOrderId,tradeId,eventTime}){
  return 'fill_'+sha256({symbol,exchangeOrderId,tradeId,eventTime}).slice(0,32);
}

export function validateLineage(record){
  const errors=[];
  if(!record?.signal_event_id) errors.push('MISSING_SIGNAL_EVENT_ID');
  if(record?.execution_verdict==='ALLOW'&&!record?.execution_decision_id) errors.push('MISSING_EXECUTION_DECISION_ID');
  if(record?.execution_verdict==='ALLOW'&&!record?.intent_id) errors.push('MISSING_INTENT_ID');
  if(record?.intent_id&&!record?.client_order_id) errors.push('MISSING_CLIENT_ORDER_ID');
  if(record?.fill_id&&!record?.exchange_order_id) errors.push('FILL_MISSING_EXCHANGE_ORDER_ID');
  if(record?.fill_id&&!record?.signal_event_id) errors.push('ORPHAN_FILL');
  return {ok:errors.length===0,errors};
}
