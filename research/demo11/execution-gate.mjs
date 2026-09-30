import { executionDecisionId } from './contracts.mjs';

function n(x,fallback=NaN){
  const v=Number(x);
  return Number.isFinite(v)?v:fallback;
}

function decision({event,policy,snapshotTs,verdict,reason,warnings=[],maxNotional=null,entryDepth=null,exitDepth=null}){
  const payload={
    signal_event_id:event.event_id,
    policy_version:policy.policyVersion,
    snapshot_ts:snapshotTs??null,
    verdict,
    reason:reason??null,
    warnings:Object.freeze([...warnings]),
    max_notional:maxNotional,
    entry_depth_10bps:entryDepth,
    exit_depth_10bps:exitDepth,
  };
  return Object.freeze({
    execution_decision_id:executionDecisionId({
      signalEventId:event.event_id,
      policyVersion:policy.policyVersion,
      snapshotTs:payload.snapshot_ts,
      verdict,
      reason:payload.reason,
    }),
    ...payload,
  });
}

export function evaluateExecutionGate({event,armingResult,snapshot,orderNotional,policy,nowMs}){
  if(!event?.event_id) throw new Error('SIGNAL_EVENT_REQUIRED');
  if(!policy?.policyVersion) throw new Error('POLICY_VERSION_REQUIRED');

  if(armingResult?.status==='SUPPRESSED'){
    return decision({event,policy,snapshotTs:snapshot?.snapshotAtMs,verdict:'SUPPRESSED',reason:armingResult.reason});
  }
  if(armingResult?.status==='MISSED'){
    return decision({event,policy,snapshotTs:snapshot?.snapshotAtMs,verdict:'MISSED',reason:armingResult.reason});
  }
  if(armingResult?.status!=='ELIGIBLE'){
    return decision({event,policy,snapshotTs:snapshot?.snapshotAtMs,verdict:'DEFER',reason:'INFRA_ARMING_UNKNOWN'});
  }

  if(!snapshot){
    return decision({event,policy,snapshotTs:null,verdict:'DEFER',reason:'INFRA_NO_MARKET_SNAPSHOT'});
  }
  const snapshotTs=n(snapshot.snapshotAtMs);
  if(!Number.isFinite(snapshotTs)){
    return decision({event,policy,snapshotTs:null,verdict:'DEFER',reason:'INFRA_INVALID_SNAPSHOT_TIME'});
  }
  if(n(nowMs)-snapshotTs>n(policy.entry?.maxSnapshotAgeMs,5000)){
    return decision({event,policy,snapshotTs,verdict:'DEFER',reason:'INFRA_STALE_MARKET_SNAPSHOT'});
  }

  if(snapshot.symbolStatus&&snapshot.symbolStatus!=='TRADING'){
    return decision({event,policy,snapshotTs,verdict:'REJECT',reason:'SYMBOL_NOT_TRADING'});
  }

  const spread=n(snapshot.spreadBps,Infinity);
  if(spread>n(policy.entry?.maxSpreadBps,Infinity)){
    return decision({event,policy,snapshotTs,verdict:'REJECT',reason:'SPREAD_HARD'});
  }

  // Strategy exits must not be vetoed by an entry-quality gate.
  if(event.side==='FLAT'){
    return decision({event,policy,snapshotTs,verdict:'ALLOW',reason:'STRATEGY_EXIT'});
  }

  if(!['LONG','SHORT'].includes(event.side)){
    return decision({event,policy,snapshotTs,verdict:'REJECT',reason:'INVALID_DIRECTION'});
  }

  const requested=n(orderNotional);
  if(!(requested>0)){
    return decision({event,policy,snapshotTs,verdict:'REJECT',reason:'INVALID_ORDER_NOTIONAL'});
  }

  const entryDepth=event.side==='LONG'?n(snapshot.askDepth10bps,0):n(snapshot.bidDepth10bps,0);
  const exitDepth=event.side==='LONG'?n(snapshot.bidDepth10bps,0):n(snapshot.askDepth10bps,0);
  const minEntryDepth=requested*n(policy.entry?.depth10bpsMinMultipleOfOrderNotional,1);
  if(entryDepth<minEntryDepth){
    return decision({event,policy,snapshotTs,verdict:'REJECT',reason:'ENTRY_DEPTH_HARD',entryDepth,exitDepth});
  }

  const exitDivisor=Math.max(1e-9,n(policy.sizing?.exitDepthDivisor,1));
  const maxNotional=Math.max(0,exitDepth/exitDivisor);
  if(maxNotional<n(policy.entry?.minOrderNotional,0)){
    return decision({event,policy,snapshotTs,verdict:'REJECT',reason:'SIZE_BELOW_MIN',maxNotional,entryDepth,exitDepth});
  }

  const warnings=[];
  const exitWarnMultiple=n(policy.sizing?.exitDepthWarningMultipleOfOrderNotional,2);
  if(exitDepth<requested*exitWarnMultiple) warnings.push('EXIT_LIQUIDITY_WARNING');
  if(n(snapshot.quoteVolume24h,Infinity)<n(policy.universeEligibility?.minQuoteVolume24h,0)) warnings.push('COHORT_VOLUME_WARNING');
  if(n(snapshot.openInterestNotional,Infinity)<n(policy.universeEligibility?.minOpenInterestNotional,0)) warnings.push('COHORT_OI_WARNING');

  return decision({
    event,policy,snapshotTs,verdict:'ALLOW',reason:null,warnings,
    maxNotional:Math.min(requested,maxNotional),entryDepth,exitDepth
  });
}
