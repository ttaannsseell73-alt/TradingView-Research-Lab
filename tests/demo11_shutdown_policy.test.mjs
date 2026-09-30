import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildShutdownVerdict,
  deterministicShutdownClientOrderId,
  errorCode,
  isBenignCancelError,
  isUnavailableSymbolError,
  symbolSnapshotFromGlobal,
} from '../livebot-patch/scripts/demo11-shutdown-policy.mjs';

test('shutdown client id is deterministic and bounded', () => {
  const a = deterministicShutdownClientOrderId('TRADOORUSDT', '-12.5');
  const b = deterministicShutdownClientOrderId('TRADOORUSDT', '-12.5');
  const c = deterministicShutdownClientOrderId('TRADOORUSDT', '-10');
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.ok(a.length <= 36);
});

test('error classification includes TESTNET unavailable and benign cancel codes', () => {
  const unavailable = { response: { data: { code: -4141, msg: 'Symbol is closed' } } };
  const cancelMiss = { response: { data: { code: -2011 } } };
  assert.equal(errorCode(unavailable), -4141);
  assert.equal(isUnavailableSymbolError(unavailable), true);
  assert.equal(isBenignCancelError(cancelMiss), true);
});

test('global reconciliation extracts cohort truth independent of per-symbol endpoint availability', () => {
  const snap = symbolSnapshotFromGlobal({
    symbol: 'TLMUSDT',
    account: { positions: [{ symbol: 'OTHERUSDT', positionAmt: '1' }] },
    regularOrders: [{ symbol: 'OTHERUSDT' }],
    algoOrders: [],
  });
  assert.deepEqual(snap, { positionAmt: 0, regularOrders: 0, algoOrders: 0 });
});

test('unavailable symbol is success only after two exchange-flat proofs', () => {
  const verdict = buildShutdownVerdict({
    symbol: 'TLMUSDT',
    unavailable: true,
    passes: [
      { ok: true, positionAmt: 0, regularOrders: 0, algoOrders: 0 },
      { ok: true, positionAmt: 0, regularOrders: 0, algoOrders: 0 },
    ],
  });
  assert.equal(verdict.status, 'SKIPPED_UNAVAILABLE_VERIFIED_FLAT');
});

test('open position, open orders or failed read remains critical', () => {
  const openPosition = buildShutdownVerdict({
    symbol: 'A',
    passes: [
      { ok: true, positionAmt: 1, regularOrders: 0, algoOrders: 0 },
      { ok: true, positionAmt: 0, regularOrders: 0, algoOrders: 0 },
    ],
  });
  assert.equal(openPosition.status, 'CRITICAL_UNRESOLVED');

  const openOrder = buildShutdownVerdict({
    symbol: 'B',
    passes: [
      { ok: true, positionAmt: 0, regularOrders: 1, algoOrders: 0 },
      { ok: true, positionAmt: 0, regularOrders: 0, algoOrders: 0 },
    ],
  });
  assert.equal(openOrder.status, 'CRITICAL_UNRESOLVED');

  const readFailure = buildShutdownVerdict({
    symbol: 'C',
    passes: [
      { ok: false },
      { ok: true, positionAmt: 0, regularOrders: 0, algoOrders: 0 },
    ],
  });
  assert.equal(readFailure.status, 'CRITICAL_UNRESOLVED');
});
