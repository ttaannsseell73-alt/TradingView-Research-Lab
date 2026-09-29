export const CENSUS_FIELDS=Object.freeze([
  'expected_evaluations','evaluated','not_evaluated',
  'raw_signal_observations','transition_events','no_transition',
  'execution_allow','execution_defer','execution_reject','execution_suppressed','execution_missed',
  'intents_created','arbiter_suppressed',
  'intent_open','intent_filled','intent_cancelled','intent_expired','intent_rejected'
]);

export function createCensus(seed={}){
  const out={schema_version:1};
  for(const k of CENSUS_FIELDS) out[k]=Number(seed[k]??0);
  return Object.freeze(out);
}

export function validateCensus(input){
  const c=createCensus(input);
  const violations=[];
  const check=(name,left,right)=>{
    if(left!==right) violations.push(Object.freeze({name,left,right,delta:left-right}));
  };

  check('EXPECTED_EVALUATION_CONSERVATION',
    c.expected_evaluations,
    c.evaluated+c.not_evaluated
  );
  check('EVALUATION_TO_TRANSITION_CONSERVATION',
    c.evaluated,
    c.transition_events+c.no_transition
  );
  check('TRANSITION_TO_EXECUTION_CONSERVATION',
    c.transition_events,
    c.execution_allow+c.execution_defer+c.execution_reject+c.execution_suppressed+c.execution_missed
  );
  check('ALLOW_TO_ARBITER_CONSERVATION',
    c.execution_allow,
    c.intents_created+c.arbiter_suppressed
  );
  check('INTENT_TERMINAL_CONSERVATION',
    c.intents_created,
    c.intent_open+c.intent_filled+c.intent_cancelled+c.intent_expired+c.intent_rejected
  );

  return Object.freeze({
    ok:violations.length===0,
    violations:Object.freeze(violations),
    census:c,
  });
}

export function explainCensusFailure(result){
  if(result.ok) return 'CENSUS_OK';
  return result.violations
    .map(v=>`${v.name}: left=${v.left} right=${v.right} delta=${v.delta}`)
    .join('; ');
}
