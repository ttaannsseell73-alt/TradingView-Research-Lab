export function evaluateReadiness(policy,evidence={}){
  const reasons=[];
  if(evidence.ciGreen!==true) reasons.push('CI_NOT_GREEN');
  if(evidence.restartParityExact!==true) reasons.push('RESTART_PARITY_NOT_EXACT');
  if(evidence.eventParityExact!==true) reasons.push('EVENT_PARITY_NOT_EXACT');
  if(evidence.censusClean!==true) reasons.push('CENSUS_NOT_CLEAN');
  if(Number(evidence.orphanFills??Infinity)!==0) reasons.push('ORPHAN_FILL_PRESENT');
  if(Number(evidence.unexplainedDecisionDifferences??Infinity)!==0) reasons.push('UNEXPLAINED_DECISION_DIFFERENCE');
  if(evidence.rollbackRehearsed!==true) reasons.push('ROLLBACK_NOT_REHEARSED');

  const comparable=Number(evidence.comparableDecisions??0);
  if(comparable<Number(policy.minimumComparableDecisions??0)){
    reasons.push('INSUFFICIENT_COMPARABLE_DECISIONS');
  }

  const coverage=new Set((evidence.decisionCoverage??[]).map(String));
  for(const required of policy.requiredDecisionCoverage??[]){
    if(!coverage.has(required)) reasons.push(`MISSING_DECISION_COVERAGE_${required}`);
  }

  return Object.freeze({
    schema_version:1,
    policy_version:policy.policyVersion,
    status:reasons.length===0?'READY_FOR_MANUAL_REVIEW':'SHADOW_ONLY',
    reasons:Object.freeze(reasons),
    comparable_decisions:comparable,
    decision_coverage:Object.freeze([...coverage].sort()),
    can_enable_execution:false
  });
}

export function evidenceFromShadowReport(report,{ciGreen=false,restartParityExact=false,eventParityExact=false,rollbackRehearsed=false,orphanFills=0,unexplainedDecisionDifferences=0}={}){
  const counts=report?.counts??{};
  const coverage=[];
  if(Number(counts.allow??0)>0) coverage.push('ALLOW');
  if(Number(counts.defer??0)>0) coverage.push('DEFER');
  if(Number(counts.reject??0)>0) coverage.push('REJECT');
  return Object.freeze({
    ciGreen,
    restartParityExact,
    eventParityExact,
    censusClean:report?.censusValidation?.ok===true,
    orphanFills,
    unexplainedDecisionDifferences,
    rollbackRehearsed,
    comparableDecisions:Number(counts.allow??0)+Number(counts.defer??0)+Number(counts.reject??0),
    decisionCoverage:Object.freeze(coverage)
  });
}
