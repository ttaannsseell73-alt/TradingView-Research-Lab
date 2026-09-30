import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanupReadiness } from '../research/demo11/cleanup-guard.mjs';

const manifest=JSON.parse(fs.readFileSync(new URL('../research/demo11/legacy_cleanup_manifest.json',import.meta.url),'utf8'));

test('legacy cleanup is blocked while shadow evidence is incomplete',()=>{
  const r=cleanupReadiness({
    manifest,
    readiness:{status:'SHADOW_ONLY',can_enable_execution:false}
  });
  assert.equal(r.allowed,false);
  assert.ok(r.reasons.includes('MANIFEST_DELETION_DISABLED'));
});

test('even review-ready evidence still requires explicit human cleanup decision',()=>{
  const r=cleanupReadiness({
    manifest:{...manifest,deletionAllowed:true},
    readiness:{status:'READY_FOR_MANUAL_REVIEW',can_enable_execution:false}
  });
  assert.equal(r.allowed,false);
  assert.deepEqual(r.reasons,['MANUAL_REVIEW_REQUIRED']);
});
