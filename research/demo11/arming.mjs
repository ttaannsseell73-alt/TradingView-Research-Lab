export function createArmingState({liveArmingPoint,mode='RECONSTRUCTING'}){
  if(!Number.isFinite(Number(liveArmingPoint))) throw new Error('LIVE_ARMING_POINT_REQUIRED');
  if(!['RECONSTRUCTING','ARMED','DISARMED'].includes(mode)) throw new Error('INVALID_ARMING_MODE');
  return Object.freeze({
    schema_version:1,
    live_arming_point:Number(liveArmingPoint),
    mode,
    reason:null,
  });
}

export function setArmingMode(state,{mode,expectedStateHash=null,actualStateHash=null,reason=null}){
  if(!['RECONSTRUCTING','ARMED','DISARMED'].includes(mode)) throw new Error('INVALID_ARMING_MODE');
  if(mode==='ARMED'&&expectedStateHash!==null&&actualStateHash!==null&&expectedStateHash!==actualStateHash){
    return Object.freeze({...state,mode:'DISARMED',reason:'STATE_HASH_MISMATCH'});
  }
  return Object.freeze({...state,mode,reason});
}

export function armingEligibility({arming,event,nowMs,intervalMs}){
  if(!event?.event_id) throw new Error('SIGNAL_EVENT_REQUIRED');
  if(!Number.isFinite(Number(nowMs))||!Number.isFinite(Number(intervalMs))||Number(intervalMs)<=0) throw new Error('INVALID_CLOCK_INPUT');

  if(arming.mode!=='ARMED'){
    return Object.freeze({
      status:'SUPPRESSED',
      reason:arming.mode==='DISARMED'?(arming.reason??'DISARMED'):'RECONSTRUCTING',
    });
  }

  if(Number(event.candle_close_ts)<=Number(arming.live_arming_point)){
    return Object.freeze({status:'SUPPRESSED',reason:'PRE_ARMING'});
  }

  const ageMs=Number(nowMs)-Number(event.candle_close_ts);
  if(ageMs>Number(intervalMs)){
    return Object.freeze({status:'MISSED',reason:'DOWNTIME',age_ms:ageMs});
  }

  return Object.freeze({status:'ELIGIBLE',reason:null,age_ms:Math.max(0,ageMs)});
}
