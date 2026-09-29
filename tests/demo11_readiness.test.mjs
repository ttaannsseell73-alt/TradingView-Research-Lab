import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateReadiness, evidenceFromShadowReport } from '../research/demo11/readiness.mjs';

const policy=JSON.parse(fs.readFileSync(new URL('../research/demo11/readiness_policy.json',import.meta.url),'utf8'));

test('a clean but transition-free shadow observation remains SHADOW_ONLY',()=>{
  const report={
    counts:{allow:0,defer:0,reject:0},
    censusValidation:{ok:true}
  };
  const evidence=evidenceFromShadowReport(report,{
    ciGreen:true,restartParityExact:true,eventParityExact:true,
    rollbackRehearsed:false,orphanFills:0,unexplainedDecisionDifferences:0
  });
  const r=evaluateReadiness(policy,evidence);
  assert.equal(r.status,'SHADOW_ONLY');
  assert.equal(r.can_enable_execution,false);
  assert.ok(r.reasons.includes('INSUFFICIENT_COMPARABLE_DECISIONS'));
  assert.ok(r.reasons.includes('MISSING_DECISION_COVERAGE_ALLOW'));
  assert.ok(r.reasons.includes('MISSING_DECISION_COVERAGE_DEFER'));
  assert.ok(r.reasons.includes('MISSING_DECISION_COVERAGE_REJECT'));
});

test('sufficient evidence can only become READY_FOR_MANUAL_REVIEW',()=>{
  const r=evaluateReadiness(policy,{
    ciGreen:true,restartParityExact:true,eventParityExact:true,censusClean:true,
    orphanFills:0,unexplainedDecisionDifferences:0,rollbackRehearsed:true,
    comparableDecisions:35,decisionCoverage:['ALLOW','DEFER','REJECT']
  });
  assert.equal(r.status,'READY_FOR_MANUAL_REVIEW');
  assert.equal(r.can_enable_execution,false);
  assert.deepEqual(r.reasons,[]);
});

test('orphan fill or unexplained difference always blocks review readiness',()=>{
  const r=evaluateReadiness(policy,{
    ciGreen:true,restartParityExact:true,eventParityExact:true,censusClean:true,
    orphanFills:1,unexplainedDecisionDifferences:2,rollbackRehearsed:true,
    comparableDecisions:100,decisionCoverage:['ALLOW','DEFER','REJECT']
  });
  assert.equal(r.status,'SHADOW_ONLY');
  assert.ok(r.reasons.includes('ORPHAN_FILL_PRESENT'));
  assert.ok(r.reasons.includes('UNEXPLAINED_DECISION_DIFFERENCE'));
});
