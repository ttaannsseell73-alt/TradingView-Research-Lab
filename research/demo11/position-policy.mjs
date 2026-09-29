export const POSITION_CLOSE_AUTHORITIES=Object.freeze(new Set([
  'STRATEGY_EXIT',
  'PROTECTION_TRIGGER',
  'EMERGENCY_STOP',
  'PROTECTION_INSTALL_FAILED',
]));

export function positionManagementDecision({
  hasOpenPosition,
  isProtected,
  closeAuthority=null,
  executionVerdict=null,
}){
  if(!hasOpenPosition){
    return Object.freeze({action:'NO_POSITION',reason:null});
  }

  if(closeAuthority&&POSITION_CLOSE_AUTHORITIES.has(closeAuthority)){
    return Object.freeze({action:'CLOSE',reason:closeAuthority});
  }

  if(!isProtected){
    return Object.freeze({action:'HALT_AND_PROTECT',reason:'OPEN_POSITION_UNPROTECTED'});
  }

  // Execution-quality decisions control new entry only. They never own exits.
  if(['DEFER','REJECT','SUPPRESSED','MISSED'].includes(String(executionVerdict??''))){
    return Object.freeze({action:'HOLD_PROTECTED',reason:'ENTRY_GATE_NOT_EXIT_AUTHORITY'});
  }

  return Object.freeze({action:'HOLD_PROTECTED',reason:null});
}
