export function createEvidenceState(nowMs=Date.now()){
  return {
    schemaVersion:1,
    mode:'READ_ONLY_SHADOW',
    exchangeWrites:false,
    initializedAt:new Date(nowMs).toISOString(),
    updatedAt:new Date(nowMs).toISOString(),
    cycles:0,
    streams:{},
    totals:{
      evaluated:0,notEvaluated:0,rawFreshObservations:0,
      transitions:0,allow:0,defer:0,reject:0,suppressed:0,missed:0,
      intentsCreated:0,arbiterSuppressed:0
    },
    decisionCoverage:[],
    recentEvents:[]
  };
}

export function streamKey({symbol,timeframe,strategyId}){
  return [String(symbol),String(timeframe),String(strategyId)].join('|');
}

export function selectEventsSinceCursor({events=[],lastProcessedCloseTs=null,latestCloseTs}){
  const upper=Number(latestCloseTs);
  if(!Number.isFinite(upper)) throw new Error('LATEST_CLOSE_TS_REQUIRED');

  if(lastProcessedCloseTs===null||lastProcessedCloseTs===undefined){
    return {initialized:true,events:[]};
  }
  const lower=Number(lastProcessedCloseTs);
  if(!Number.isFinite(lower)) throw new Error('INVALID_CURSOR');

  return {
    initialized:false,
    events:events
      .filter(e=>Number(e?.candle_close_ts)>lower&&Number(e?.candle_close_ts)<=upper)
      .sort((a,b)=>Number(a.candle_close_ts)-Number(b.candle_close_ts)||String(a.event_id).localeCompare(String(b.event_id)))
  };
}

export function classifyEventFreshness({eventCloseTs,nowMs,intervalMs}){
  const close=Number(eventCloseTs), now=Number(nowMs), interval=Number(intervalMs);
  if(![close,now,interval].every(Number.isFinite)||interval<=0) throw new Error('INVALID_FRESHNESS_INPUT');
  const age=Math.max(0,now-close);
  return age<=interval
    ? {status:'FRESH',ageMs:age}
    : {status:'MISSED',reason:'OBSERVATION_LAG',ageMs:age};
}

export function applyEvidenceCycle(state,cycle){
  const next=structuredClone(state);
  next.cycles=Number(next.cycles??0)+1;
  next.updatedAt=cycle.generatedAt??new Date().toISOString();
  next.lastCycle=cycle.summary;
  const totals=next.totals??{};
  for(const k of [
    'evaluated','notEvaluated','rawFreshObservations','transitions',
    'allow','defer','reject','suppressed','missed','intentsCreated','arbiterSuppressed'
  ]){
    totals[k]=Number(totals[k]??0)+Number(cycle.summary?.[k]??0);
  }
  next.totals=totals;
  next.decisionCoverage=[...new Set([
    ...(next.decisionCoverage??[]),
    ...(cycle.decisionCoverage??[])
  ])].sort();

  for(const [key,cursor] of Object.entries(cycle.cursors??{})){
    next.streams[key]={
      ...(next.streams[key]??{}),
      ...cursor
    };
  }

  const known=new Set((next.recentEvents??[]).map(x=>x.event_id));
  for(const e of cycle.events??[]){
    if(!known.has(e.event_id)){
      next.recentEvents.push(e);
      known.add(e.event_id);
    }
  }
  if(next.recentEvents.length>500) next.recentEvents=next.recentEvents.slice(-500);
  return next;
}

export function validatePersistentCycle(summary){
  const errors=[];
  const expected=Number(summary.expected??0);
  const evaluated=Number(summary.evaluated??0);
  const notEvaluated=Number(summary.notEvaluated??0);
  if(expected!==evaluated+notEvaluated) errors.push('EVALUATION_CONSERVATION');

  const transitions=Number(summary.transitions??0);
  const decided=
    Number(summary.allow??0)+Number(summary.defer??0)+Number(summary.reject??0)+
    Number(summary.suppressed??0)+Number(summary.missed??0);
  if(transitions!==decided) errors.push('TRANSITION_DECISION_CONSERVATION');

  const allow=Number(summary.allow??0);
  const intents=Number(summary.intentsCreated??0);
  const arbiterSuppressed=Number(summary.arbiterSuppressed??0);
  if(allow!==intents+arbiterSuppressed) errors.push('ALLOW_ARBITER_CONSERVATION');

  return {ok:errors.length===0,errors};
}
