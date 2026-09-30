export function cleanupReadiness({manifest,readiness}){
  const reasons=[];
  if(manifest?.deletionAllowed!==true) reasons.push('MANIFEST_DELETION_DISABLED');
  if(readiness?.status!=='READY_FOR_MANUAL_REVIEW') reasons.push('READINESS_NOT_APPROVED_FOR_REVIEW');
  if(readiness?.can_enable_execution!==false) reasons.push('INVALID_READINESS_CONTRACT');
  return Object.freeze({
    allowed:false,
    reasons:Object.freeze(reasons.length?reasons:['MANUAL_REVIEW_REQUIRED'])
  });
}
