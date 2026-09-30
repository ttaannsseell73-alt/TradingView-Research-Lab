import { canonicalJson, clientOrderIdForIntent, intentIdForSignals } from './contracts.mjs';

function freezeLedger(x){
  return Object.freeze({...x,intents:Object.freeze([...(x.intents??[])])});
}

export function createIntentLedger(){
  return freezeLedger({schema_version:1,intents:[]});
}

function buildIntent(group,requestedNotional){
  const entries=group.filter(x=>x.event.side!=='FLAT');
  const exits=group.filter(x=>x.event.side==='FLAT');
  const source=entries.length?entries:exits;
  const signalIds=source.map(x=>x.event.event_id).sort();
  const intentId=intentIdForSignals(signalIds);
  const side=entries.length?entries[0].event.side:'FLAT';
  const maxCaps=source
    .map(x=>Number(x.decision.max_notional))
    .filter(Number.isFinite);
  const cap=maxCaps.length?Math.min(...maxCaps):Number(requestedNotional);
  const notional=side==='FLAT'?null:Math.min(Number(requestedNotional),cap);
  return Object.freeze({
    intent_id:intentId,
    client_order_id:clientOrderIdForIntent(intentId),
    symbol:source[0].event.symbol,
    candle_close_ts:source[0].event.candle_close_ts,
    action:side==='LONG'?'ENTER_LONG':side==='SHORT'?'ENTER_SHORT':'EXIT_TO_FLAT',
    side,
    notional,
    support_count:signalIds.length,
    supporting_signal_event_ids:Object.freeze(signalIds),
    lead_signal_event_id:signalIds[0],
    status:'CREATED',
  });
}

export function arbitrateIntentBatch({ledger,items,requestedNotional,openPositions={}}){
  const eligible=(items??[]).filter(x=>{
    if(x?.decision?.signal_event_id!==x?.event?.event_id) throw new Error('DECISION_SIGNAL_MISMATCH');
    return x.decision.verdict==='ALLOW';
  });

  const groups=new Map();
  for(const x of eligible){
    const key=`${x.event.symbol}::${x.event.candle_close_ts}`;
    if(!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(x);
  }

  const outcomes=[];
  let next=ledger;
  for(const [key,group] of groups){
    const entrySides=new Set(group.filter(x=>x.event.side!=='FLAT').map(x=>x.event.side));
    if(entrySides.size>1){
      outcomes.push(Object.freeze({key,status:'DIRECTION_CONFLICT',intent:null}));
      continue;
    }

    const symbol=group[0].event.symbol;
    const onlySide=[...entrySides][0]??null;
    const open=openPositions[symbol]??null;
    if(open&&onlySide&&open.side===onlySide){
      outcomes.push(Object.freeze({key,status:'EXISTING_POSITION_SAME_SIDE',intent:null}));
      continue;
    }
    if(open&&onlySide&&open.side!==onlySide){
      outcomes.push(Object.freeze({key,status:'REVERSE_REQUIRES_POSITION_MANAGER',intent:null}));
      continue;
    }

    const intent=buildIntent(group,requestedNotional);
    const prior=(next.intents??[]).find(x=>x.intent_id===intent.intent_id);
    if(prior){
      if(canonicalJson(prior)!==canonicalJson(intent)) throw new Error('INTENT_ID_CONFLICT');
      outcomes.push(Object.freeze({key,status:'DUPLICATE',intent:prior}));
      continue;
    }
    next=freezeLedger({...next,intents:[...next.intents,intent]});
    outcomes.push(Object.freeze({key,status:'CREATED',intent}));
  }

  return Object.freeze({ledger:next,outcomes:Object.freeze(outcomes)});
}
