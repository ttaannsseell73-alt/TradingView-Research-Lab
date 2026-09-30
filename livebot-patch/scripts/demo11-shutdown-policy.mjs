import { createHash } from 'node:crypto';

export const BENIGN_CANCEL_CODES = new Set([-2011, -2013]);
export const UNAVAILABLE_SYMBOL_CODES = new Set([-1121, -4108, -4141]);

export function errorCode(error) {
  const raw = error?.response?.data?.code ?? error?.code ?? null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function errorMessage(error) {
  return String(
    error?.response?.data?.msg ??
    error?.message ??
    error ??
    'UNKNOWN_ERROR'
  );
}

export function isBenignCancelError(error) {
  const code = errorCode(error);
  return code !== null && BENIGN_CANCEL_CODES.has(code);
}

export function isUnavailableSymbolError(error) {
  const code = errorCode(error);
  return code !== null && UNAVAILABLE_SYMBOL_CODES.has(code);
}

export function deterministicShutdownClientOrderId(symbol, positionAmt) {
  const cleanSymbol = String(symbol).replace(/[^A-Za-z0-9]/g, '').slice(0, 12);
  const identity = `${cleanSymbol}|${String(positionAmt)}`;
  const digest = createHash('sha256').update(identity).digest('hex').slice(0, 14);
  return `d11stop-${cleanSymbol}-${digest}`.slice(0, 36);
}

export function symbolSnapshotFromGlobal({ symbol, account, regularOrders, algoOrders }) {
  const positions = Array.isArray(account?.positions) ? account.positions : [];
  const position = positions.find(x => String(x?.symbol ?? '') === symbol);
  const positionAmt = position ? Number(position.positionAmt ?? 0) : 0;
  const regular = (Array.isArray(regularOrders) ? regularOrders : [])
    .filter(x => String(x?.symbol ?? '') === symbol);
  const algo = (Array.isArray(algoOrders) ? algoOrders : [])
    .filter(x => String(x?.symbol ?? '') === symbol);
  return {
    positionAmt,
    regularOrders: regular.length,
    algoOrders: algo.length,
  };
}

export function buildShutdownVerdict({ symbol, unavailable = false, passes = [] }) {
  if (!Array.isArray(passes) || passes.length < 2) {
    return {
      symbol,
      status: 'CRITICAL_UNRESOLVED',
      reason: 'INSUFFICIENT_RECONCILIATION_PASSES',
    };
  }

  for (const pass of passes) {
    if (!pass?.ok) {
      return {
        symbol,
        status: 'CRITICAL_UNRESOLVED',
        reason: 'RECONCILIATION_READ_FAILED',
      };
    }
    const amount = Number(pass.positionAmt ?? NaN);
    if (!Number.isFinite(amount)) {
      return {
        symbol,
        status: 'CRITICAL_UNRESOLVED',
        reason: 'POSITION_NOT_NUMERIC',
      };
    }
    if (Math.abs(amount) > 1e-12) {
      return {
        symbol,
        status: 'CRITICAL_UNRESOLVED',
        reason: 'POSITION_REMAINS_OPEN',
        positionAmt: amount,
      };
    }
    if (Number(pass.regularOrders ?? 0) > 0 || Number(pass.algoOrders ?? 0) > 0) {
      return {
        symbol,
        status: 'CRITICAL_UNRESOLVED',
        reason: 'OPEN_ORDERS_REMAIN',
        regularOrders: Number(pass.regularOrders ?? 0),
        algoOrders: Number(pass.algoOrders ?? 0),
      };
    }
  }

  return {
    symbol,
    status: unavailable ? 'SKIPPED_UNAVAILABLE_VERIFIED_FLAT' : 'FLAT',
    reason: unavailable ? 'UNAVAILABLE_BUT_EXCHANGE_FLAT_PROVEN' : 'EXCHANGE_FLAT_PROVEN',
  };
}
