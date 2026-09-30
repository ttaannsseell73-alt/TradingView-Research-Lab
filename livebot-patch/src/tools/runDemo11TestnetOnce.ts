import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import {
  deterministicClientOrderId,
  InFlightRegistry,
  RateLimitGovernor,
} from '../live/CanonicalLive';
import { BinanceUsdmAdapter } from '../live/BinanceUsdmAdapter';
import {
  AccountContractVerifier,
  CanonicalReconciler,
  normalizeOrderToRules,
  parseSymbolRules,
  ProtectionManager,
} from '../live/ExecutionSafety';
import { PgEventJournal, PgLeaderLock } from '../live/PostgresSafety';

dotenv.config();

const DEFAULT_NOTIONAL = 100;
const DEFAULT_MAX_OPEN = 10;
const DEFAULT_MAX_GROSS = 1000;
const DEFAULT_STOP_FRACTION = 0.20;
const MAX_IOC_DEVIATION_BPS = 30;
const MIN_LIVE_DEPTH_MULTIPLE = 1.5;
const DEMO11_VALID_METRICS_EPOCH_MS = Date.parse('2026-09-30T00:00:00Z');
const TIMEFRAME_MS: Record<string, number> = {
  '1m': 60_000,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  '4h': 4 * 60 * 60_000,
};

type Direction = 'LONG' | 'SHORT';

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function decimalsFromStep(step: number): number {
  const s = step.toFixed(12).replace(/0+$/, '');
  const dot = s.indexOf('.');
  return dot === -1 ? 0 : s.length - dot - 1;
}

function ceilToStep(value: number, step: number): number {
  if (!(step > 0)) return value;
  return Number((Math.ceil((value - Number.EPSILON) / step) * step).toFixed(12));
}

function floorToStep(value: number, step: number): number {
  if (!(step > 0)) return value;
  return Number((Math.floor((value + Number.EPSILON) / step) * step).toFixed(12));
}

function positionRow(raw: any, symbol: string): any {
  const rows = Array.isArray(raw) ? raw : [raw];
  return rows.find((x: any) => x?.symbol === symbol) ?? rows[0] ?? {};
}

function algoId(row: any): string {
  return String(row?.clientAlgoId ?? row?.algoId ?? '');
}

function finite(x: unknown): boolean {
  return Number.isFinite(Number(x));
}

async function recordOrderFill(
  adapter: BinanceUsdmAdapter,
  journal: PgEventJournal,
  symbol: string,
  order: any,
  side: 'BUY' | 'SELL',
  intentId: string | null,
  clientOrderId?: string
): Promise<number> {
  let resolved = order;
  let quantity = Number(resolved?.executedQty ?? 0);
  let fillPrice = Number(resolved?.avgPrice ?? resolved?.price ?? 0);

  if ((!(quantity > 0) || !(fillPrice > 0)) && clientOrderId) {
    await sleep(250);
    const refreshed = await adapter.getOrderByClientId(symbol, clientOrderId);
    if (refreshed) {
      resolved = refreshed;
      quantity = Number(resolved?.executedQty ?? 0);
      fillPrice = Number(resolved?.avgPrice ?? resolved?.price ?? 0);
    }
  }

  if (!(quantity > 0) || !(fillPrice > 0)) return 0;
  const fillId = [
    symbol,
    String(resolved?.orderId ?? ''),
    String(resolved?.updateTime ?? resolved?.time ?? Date.now()),
    side,
  ].join('|');

  await journal.recordFill({
    fillId,
    intentId,
    symbol,
    side,
    expectedPrice: null,
    fillPrice,
    quantity,
    eventTime: Number(resolved?.updateTime ?? resolved?.time ?? Date.now()),
    payload: resolved ?? {},
  });
  return quantity;
}

async function cancelKnownProtection(
  adapter: BinanceUsdmAdapter,
  journal: PgEventJournal,
  symbol: string
): Promise<void> {
  const known = new Set(await journal.knownProtectionIds());
  const open = await adapter.getOpenAlgoOrders(symbol);
  for (const row of Array.isArray(open) ? open : []) {
    const id = algoId(row);
    if (!id || !known.has(id)) continue;
    try {
      await adapter.cancelAlgoOrder(id);
      await journal.appendEvent('PROTECTION_CANCELLED', id, { symbol });
    } catch (error: any) {
      const code = Number(error?.response?.data?.code);
      if (code !== -2011 && code !== -2013) throw error;
    }
  }
}

async function closePosition(
  adapter: BinanceUsdmAdapter,
  journal: PgEventJournal,
  leader: PgLeaderLock,
  symbol: string,
  positionAmt: number,
  candleOpenTime: number,
  reason: string
): Promise<any> {
  if (Math.abs(positionAmt) < 1e-12) return null;

  const side: 'BUY' | 'SELL' = positionAmt > 0 ? 'SELL' : 'BUY';
  const clientOrderId = deterministicClientOrderId({
    deploymentId: 'demo11-testnet-risk-exit-v1',
    symbol,
    candleOpenTime,
    action: side === 'SELL' ? 'EXIT_LONG' : 'EXIT_SHORT',
    generation: leader.assertHeld(),
  });

  const result = await adapter.closePositionMarket({
    symbol,
    side,
    quantity: String(Math.abs(positionAmt)),
    clientOrderId,
  });

  await journal.appendEvent('DEMO11_RISK_REDUCING_EXIT_ACK', clientOrderId, {
    symbol,
    reason,
    response: result,
  });
  await recordOrderFill(adapter, journal, symbol, result, side, null, clientOrderId);
  await sleep(300);
  await cancelKnownProtection(adapter, journal, symbol);
  return result;
}

async function ensureProtection(
  adapter: BinanceUsdmAdapter,
  journal: PgEventJournal,
  leader: PgLeaderLock,
  symbol: string,
  direction: 1 | -1,
  entryPrice: number,
  tickSize: number,
  priceDecimals: number,
  positionIdentity: string,
  stopFraction: number
): Promise<void> {
  const known = new Set(await journal.knownProtectionIds());
  const open = await adapter.getOpenAlgoOrders(symbol);
  const alreadyProtected = (Array.isArray(open) ? open : []).some((x: any) =>
    known.has(algoId(x))
  );
  if (alreadyProtected) return;

  const raw =
    direction === 1
      ? entryPrice * (1 - stopFraction)
      : entryPrice * (1 + stopFraction);
  const trigger =
    direction === 1
      ? floorToStep(raw, tickSize)
      : ceilToStep(raw, tickSize);

  if (!(trigger > 0)) throw new Error('INVALID_CATASTROPHIC_TRIGGER');

  const manager = new ProtectionManager(adapter, journal, leader);
  await manager.ensureCatastrophicStop({
    symbol,
    positionSide: direction === 1 ? 'LONG' : 'SHORT',
    triggerPrice: trigger.toFixed(priceDecimals),
    positionIdentity,
    deploymentId: 'demo11-testnet-hard-stop-v1',
  });

  const refreshed = await adapter.getOpenAlgoOrders(symbol);
  const knownAfter = new Set(await journal.knownProtectionIds());
  const protectedNow = (Array.isArray(refreshed) ? refreshed : []).some((x: any) =>
    knownAfter.has(algoId(x))
  );
  if (!protectedNow) throw new Error('PROTECTION_NOT_VERIFIED_ON_EXCHANGE');
}

async function normalizeAccountContract(
  adapter: BinanceUsdmAdapter,
  symbol: string,
  expectedLeverage: number,
  positionAmt: number
): Promise<any> {
  let check = await new AccountContractVerifier(adapter).verify(symbol, expectedLeverage);
  if (check.ok) return check;

  const fixable = check.reasons.every((x: string) =>
    ['MARGIN_NOT_ISOLATED', 'LEVERAGE_MISMATCH'].includes(x)
  );
  if (!fixable || Math.abs(positionAmt) > 1e-12) return check;

  if (check.reasons.includes('MARGIN_NOT_ISOLATED')) {
    try {
      await adapter.setMarginType(symbol, 'ISOLATED');
    } catch (error: any) {
      const code = Number(error?.response?.data?.code);
      if (code !== -4046) throw error;
    }
  }
  if (check.reasons.includes('LEVERAGE_MISMATCH')) {
    await adapter.setLeverage(symbol, expectedLeverage);
  }
  check = await new AccountContractVerifier(adapter).verify(symbol, expectedLeverage);
  return check;
}

function rowAction(row: any): {
  kind: 'NONE' | 'ENTER' | 'EXIT_FLAT';
  direction?: Direction;
  candleTime?: number;
} {
  if (
    row?.fresh === true &&
    row?.status === 'FRESH_ENTRY' &&
    !row?.directionConflict &&
    (row?.direction === 'LONG' || row?.direction === 'SHORT') &&
    finite(row?.canonicalEntryTime)
  ) {
    return {
      kind: 'ENTER',
      direction: row.direction,
      candleTime: Number(row.canonicalEntryTime),
    };
  }

  if (
    row?.fresh === true &&
    row?.action === 'EXIT_TO_FLAT' &&
    finite(row?.canonicalEntryTime)
  ) {
    return {
      kind: 'EXIT_FLAT',
      candleTime: Number(row.canonicalEntryTime),
    };
  }

  return { kind: 'NONE' };
}

type PendingEntry = {
  underlying: string;
  symbol: string;
  strategy: string;
  timeframe: string;
  direction: Direction;
  candleTime: number;
  expiresAt: number;
};

function freshEntryCandidate(row: any): PendingEntry | null {
  if (
    row?.fresh !== true ||
    row?.directionConflict ||
    !['LONG','SHORT'].includes(String(row?.direction ?? '')) ||
    !finite(row?.canonicalEntryTime)
  ) return null;

  const timeframe = String(row?.timeframe ?? '');
  const ttl = TIMEFRAME_MS[timeframe];
  if (!(ttl > 0)) return null;

  const candleTime = Number(row.canonicalEntryTime);
  return {
    underlying: String(row?.underlying ?? ''),
    symbol: String(row?.executionContract ?? ''),
    strategy: String(row?.strategy ?? ''),
    timeframe,
    direction: row.direction as Direction,
    candleTime,
    expiresAt: candleTime + ttl,
  };
}

async function ensurePendingSchema(journal: PgEventJournal): Promise<void> {
  await journal.pool.query(`
    CREATE TABLE IF NOT EXISTS demo11_pending_entries (
      underlying TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      strategy TEXT NOT NULL,
      timeframe TEXT NOT NULL,
      direction TEXT NOT NULL,
      candle_time BIGINT NOT NULL,
      expires_at BIGINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function upsertPendingEntry(journal: PgEventJournal, p: PendingEntry): Promise<void> {
  await journal.pool.query(
    `INSERT INTO demo11_pending_entries
       (underlying,symbol,strategy,timeframe,direction,candle_time,expires_at,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())
     ON CONFLICT (underlying) DO UPDATE SET
       symbol=EXCLUDED.symbol,
       strategy=EXCLUDED.strategy,
       timeframe=EXCLUDED.timeframe,
       direction=EXCLUDED.direction,
       candle_time=EXCLUDED.candle_time,
       expires_at=EXCLUDED.expires_at,
       updated_at=NOW()`,
    [p.underlying,p.symbol,p.strategy,p.timeframe,p.direction,p.candleTime,p.expiresAt]
  );
}

async function getPendingEntry(
  journal: PgEventJournal,
  underlying: string,
  nowMs: number
): Promise<PendingEntry | null> {
  const r = await journal.pool.query(
    `SELECT underlying,symbol,strategy,timeframe,direction,candle_time,expires_at
       FROM demo11_pending_entries
      WHERE underlying=$1 AND expires_at>$2`,
    [underlying, nowMs]
  );
  if (!r.rows.length) return null;
  const x = r.rows[0];
  return {
    underlying:String(x.underlying),
    symbol:String(x.symbol),
    strategy:String(x.strategy),
    timeframe:String(x.timeframe),
    direction:String(x.direction) as Direction,
    candleTime:Number(x.candle_time),
    expiresAt:Number(x.expires_at),
  };
}

async function clearPendingEntry(journal: PgEventJournal, underlying: string): Promise<void> {
  await journal.pool.query(
    `DELETE FROM demo11_pending_entries WHERE underlying=$1`,
    [underlying]
  );
}

async function expirePendingEntries(journal: PgEventJournal, nowMs: number): Promise<number> {
  const r = await journal.pool.query(
    `DELETE FROM demo11_pending_entries
      WHERE expires_at<=$1
      RETURNING underlying,symbol,direction,candle_time`,
    [nowMs]
  );
  for (const row of r.rows) {
    await journal.appendEvent('DEMO11_PENDING_EXPIRED', String(row.underlying), {
      symbol:String(row.symbol),
      direction:String(row.direction),
      candleTime:Number(row.candle_time),
    });
  }
  return r.rowCount ?? 0;
}

function computeLedgerPnl(fills: any[]): {
  realizedGrossPnl: number;
  realizedBySymbol: Record<string, number>;
} {
  const state = new Map<string, { qty: number; avg: number; realized: number }>();
  for (const fill of fills) {
    const symbol = String(fill.symbol ?? '');
    const side = String(fill.side ?? '');
    const qty = Number(fill.quantity ?? 0);
    const px = Number(fill.fill_price ?? fill.fillPrice ?? 0);
    if (!symbol || !(qty > 0) || !(px > 0) || !['BUY','SELL'].includes(side)) continue;
    const signed = side === 'BUY' ? qty : -qty;
    const s = state.get(symbol) ?? { qty: 0, avg: 0, realized: 0 };
    const sameDirection = Math.abs(s.qty) < 1e-12 || Math.sign(s.qty) === Math.sign(signed);
    if (sameDirection) {
      const newQty = s.qty + signed;
      const oldAbs = Math.abs(s.qty);
      const addAbs = Math.abs(signed);
      s.avg = Math.abs(newQty) > 1e-12
        ? ((s.avg * oldAbs) + (px * addAbs)) / (oldAbs + addAbs)
        : 0;
      s.qty = newQty;
    } else {
      const closing = Math.min(Math.abs(s.qty), Math.abs(signed));
      s.realized += s.qty > 0
        ? (px - s.avg) * closing
        : (s.avg - px) * closing;
      const newQty = s.qty + signed;
      if (Math.abs(newQty) < 1e-12) {
        s.qty = 0;
        s.avg = 0;
      } else if (Math.sign(newQty) === Math.sign(s.qty)) {
        s.qty = newQty;
      } else {
        s.qty = newQty;
        s.avg = px;
      }
    }
    state.set(symbol, s);
  }
  const realizedBySymbol: Record<string, number> = {};
  let realizedGrossPnl = 0;
  for (const [symbol, s] of state) {
    realizedBySymbol[symbol] = s.realized;
    realizedGrossPnl += s.realized;
  }
  return { realizedGrossPnl, realizedBySymbol };
}

async function writeReport(report: Record<string, unknown>): Promise<void> {
  const dir = path.join(process.cwd(), 'artifacts');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'demo11-testnet-latest.json'),
    JSON.stringify(report, null, 2) + '\n',
    'utf8'
  );
  fs.appendFileSync(
    path.join(dir, 'demo11-testnet.jsonl'),
    JSON.stringify(report) + '\n',
    'utf8'
  );
}

async function main(): Promise<void> {
  const testnetUrl = process.env.BINANCE_FUTURES_URL?.trim() ?? '';
  const apiKey = process.env.BINANCE_API_KEY?.trim() ?? '';
  const apiSecret = process.env.BINANCE_API_SECRET?.trim() ?? '';
  const pgUrl =
    process.env.DEMO11_TESTNET_PG_URL?.trim() ??
    process.env.LIVEBOT_PG_URL?.trim() ??
    '';
  const signalPath =
    process.env.DEMO11_SIGNAL_PATH?.trim() ??
    'C:/Users/TANSEL/Desktop/Demo11-Shadow/artifacts/demo11/testnet-bridge/DEMO11_TESTNET_SIGNAL.json';

  if (!apiKey || !apiSecret) throw new Error('DEMO11_TESTNET_CREDENTIALS_MISSING');
  if (!pgUrl) throw new Error('DEMO11_TESTNET_PG_URL_MISSING');
  if (!fs.existsSync(signalPath)) throw new Error('DEMO11_SIGNAL_FILE_MISSING');

  const host = new URL(testnetUrl).hostname.toLowerCase();
  if (host !== 'testnet.binancefuture.com') {
    throw new Error('DEMO11_EXECUTION_REQUIRES_BINANCE_TESTNET');
  }
  if (
    process.env.LIVEBOT_CANARY_APPROVED !== 'YES' ||
    process.env.DEMO11_TESTNET_APPROVED !== 'YES'
  ) {
    throw new Error('DEMO11_TESTNET_EXPLICIT_APPROVAL_MISSING');
  }

  const signalDoc = JSON.parse(fs.readFileSync(signalPath, 'utf8'));
  if (signalDoc?.cohortId !== 'demo-10-forward-v2') {
    throw new Error('DEMO11_COHORT_MISMATCH');
  }

  const rows = Array.isArray(signalDoc?.rows) ? signalDoc.rows : [];
  const targetSymbols: string[] = Array.from(new Set<string>(
    rows
      .map((x: any) => String(x?.executionContract ?? ''))
      .filter((x: string) => Boolean(x))
  )).sort();

  const targetNotional = Number(process.env.DEMO11_TESTNET_NOTIONAL ?? DEFAULT_NOTIONAL);
  const maxOpenPositions = Number(process.env.DEMO11_TESTNET_MAX_OPEN ?? DEFAULT_MAX_OPEN);
  const maxGrossNotional = Number(process.env.DEMO11_TESTNET_MAX_GROSS ?? DEFAULT_MAX_GROSS);
  const stopFraction = Number(process.env.DEMO11_TESTNET_STOP_FRACTION ?? DEFAULT_STOP_FRACTION);

  if (!(targetNotional > 0) || !(maxOpenPositions > 0) || !(maxGrossNotional > 0)) {
    throw new Error('INVALID_DEMO11_TESTNET_RISK_CONFIG');
  }
  if (!(stopFraction > 0 && stopFraction < 1)) {
    throw new Error('INVALID_DEMO11_TESTNET_STOP_FRACTION');
  }

  const governor = new RateLimitGovernor();
  const adapter = new BinanceUsdmAdapter({
    baseUrl: testnetUrl,
    apiKey,
    apiSecret,
    mode: 'CANARY',
    governor,
  });

  const journal = new PgEventJournal(pgUrl);
  const leader = new PgLeaderLock(journal, 'demo11-testnet-v1');
  const inFlight = new InFlightRegistry();

  const report: Record<string, any> = {
    generatedAt: new Date().toISOString(),
    cohortId: signalDoc.cohortId,
    execution: 'BINANCE_USDM_TESTNET',
    productionOrders: false,
    signalDataAvailable: signalDoc.dataAvailable !== false,
    leverage: 1,
    marginType: 'ISOLATED',
    targetNotional,
    maxOpenPositions,
    maxGrossNotional,
    catastrophicStopFraction: stopFraction,
    symbols: [],
  };

  try {
    await journal.init();
    await journal.healthcheck();
    await ensurePendingSchema(journal);
    report.expiredPendingEntries = await expirePendingEntries(journal, Date.now());

    const lock = await leader.acquire();
    report.leader = lock;
    if (!lock.acquired) {
      report.result = 'SKIP_NOT_LEADER';
      await writeReport(report);
      return;
    }

    await adapter.serverTime();

    const [mode, accountConfig, exchangeInfo] = await Promise.all([
      adapter.getPositionMode(),
      adapter.getAccountConfig(),
      adapter.exchangeInfo(),
    ]);

    report.accountMode = mode;
    report.multiAssetsMargin = Boolean(
      accountConfig?.multiAssetsMargin ?? accountConfig?.multiAssetsMode ?? false
    );

    if (mode !== 'ONE_WAY') throw new Error('DEMO11_TESTNET_REQUIRES_ONE_WAY');
    if (report.multiAssetsMargin) throw new Error('DEMO11_TESTNET_REQUIRES_SINGLE_ASSET_MODE');

    const testnetTradable = new Set<string>(
      (exchangeInfo?.symbols ?? [])
        .filter((x: any) => String(x?.status ?? '') === 'TRADING')
        .map((x: any) => String(x.symbol))
    );

    let openCount = 0;
    let grossNotional = 0;
    const initialPositions = new Map<string, any>();

    for (const symbol of targetSymbols) {
      if (!testnetTradable.has(symbol)) continue;
      const raw = await adapter.getPositionRisk(symbol);
      const row = positionRow(raw, symbol);
      const amt = Number(row.positionAmt ?? 0);
      const mark = Number(row.markPrice ?? 0);
      initialPositions.set(symbol, row);
      if (Math.abs(amt) > 1e-12) {
        openCount += 1;
        if (mark > 0) grossNotional += Math.abs(amt) * mark;
      }
    }

    report.portfolioBefore = { openCount, grossNotional };

    for (const row of rows) {
      const symbol = String(row?.executionContract ?? '');
      const state: Record<string, any> = {
        underlying: row?.underlying ?? null,
        symbol: symbol || null,
        strategy: row?.strategy ?? null,
        timeframe: row?.timeframe ?? null,
        signalStatus: row?.status ?? null,
        signalDirection: row?.direction ?? null,
        fresh: row?.fresh ?? false,
        result: 'NO_ACTION',
      };

      report.symbols.push(state);

      if (!symbol) {
        state.result = 'NO_EXECUTION_CONTRACT';
        continue;
      }
      if (!testnetTradable.has(symbol)) {
        state.result = 'UNAVAILABLE_ON_TESTNET';
        continue;
      }

      const freshCandidate = null; // Demo-11: no cross-cycle pending-entry authority
      if (freshCandidate) {
        await upsertPendingEntry(journal, freshCandidate);
        state.pendingCaptured = {
          direction:freshCandidate.direction,
          candleTime:freshCandidate.candleTime,
          expiresAt:freshCandidate.expiresAt,
        };
        await journal.appendEvent('DEMO11_PENDING_CAPTURED', freshCandidate.underlying, freshCandidate);
      }

      let rawPosition = await adapter.getPositionRisk(symbol);
      let posRow = positionRow(rawPosition, symbol);
      let positionAmt = Number(posRow.positionAmt ?? 0);
      if (!Number.isFinite(positionAmt)) {
        state.result = 'INVALID_POSITION_AMOUNT';
        continue;
      }

      const contract = await normalizeAccountContract(adapter, symbol, 1, positionAmt);
      state.accountContract = contract;
      if (!contract.ok) {
        state.result = 'ACCOUNT_CONTRACT_BLOCK';
        continue;
      }

      const reconciler = new CanonicalReconciler(adapter, journal, inFlight);
      const reconcile = await reconciler.reconcile(symbol);
      state.reconcileBefore = {
        ok: reconcile.ok,
        halt: reconcile.halt,
        diagnostics: reconcile.diagnostics,
      };
      if (reconcile.halt) {
        state.result = 'RECONCILIATION_HALTED';
        continue;
      }

      rawPosition = await adapter.getPositionRisk(symbol);
      posRow = positionRow(rawPosition, symbol);
      positionAmt = Number(posRow.positionAmt ?? 0);
      state.positionBefore = {
        positionAmt,
        entryPrice: Number(posRow.entryPrice ?? 0),
        markPrice: Number(posRow.markPrice ?? 0),
      };

      const rules = parseSymbolRules(exchangeInfo, symbol);
      const priceDecimals = decimalsFromStep(rules.tickSize);
      const directAction = rowAction(row);
      const pending = null;
      const action = directAction;
      state.requestedAction = action;
      state.pendingExecution = null;

      if (action.kind === 'EXIT_FLAT') {
        await clearPendingEntry(journal, String(row?.underlying ?? ''));
        if (Math.abs(positionAmt) > 1e-12) {
          await closePosition(
            adapter,
            journal,
            leader,
            symbol,
            positionAmt,
            Number(action.candleTime ?? Date.now()),
            'DEMO11_TARGET_FLAT'
          );
          openCount = Math.max(0, openCount - 1);
          state.result = 'CLOSED_TO_FLAT';
        } else {
          state.result = 'ALREADY_FLAT';
        }
        continue;
      }

      if (action.kind === 'NONE') {
        if (Math.abs(positionAmt) > 1e-12) {
          const entryPrice = Number(posRow.entryPrice ?? 0);
          if (!(entryPrice > 0)) {
            state.result = 'OPEN_POSITION_NO_ENTRY_PRICE';
            continue;
          }
          try {
            await ensureProtection(
              adapter,
              journal,
              leader,
              symbol,
              positionAmt > 0 ? 1 : -1,
              entryPrice,
              rules.tickSize,
              priceDecimals,
              'carry-' + symbol + '-' + String(entryPrice),
              stopFraction
            );
            state.protected = true;
            state.result = ['BLOCK','NO_MARKET_SNAPSHOT'].includes(String(row?.executionStatus ?? ''))
              ? 'HOLD_PROTECTED_EXECUTION_BLOCK'
              : 'HOLD_PROTECTED';
          } catch (error: any) {
            await closePosition(
              adapter,
              journal,
              leader,
              symbol,
              positionAmt,
              Date.now(),
              'DEMO11_PROTECTION_FAILURE'
            );
            openCount = Math.max(0, openCount - 1);
            state.result = 'SAFETY_FLATTENED_PROTECTION_FAILURE';
            state.error = String(error?.message ?? error);
          }
        }
        continue;
      }

      const targetDirection: 1 | -1 = action.direction === 'LONG' ? 1 : -1;
      const currentDirection = positionAmt > 1e-12 ? 1 : positionAmt < -1e-12 ? -1 : 0;

      if (currentDirection === targetDirection) {
        const entryPrice = Number(posRow.entryPrice ?? 0);
        if (entryPrice > 0) {
          await ensureProtection(
            adapter,
            journal,
            leader,
            symbol,
            targetDirection,
            entryPrice,
            rules.tickSize,
            priceDecimals,
            'matching-' + symbol + '-' + String(entryPrice),
            stopFraction
          );
        }
        await clearPendingEntry(journal, String(row?.underlying ?? ''));
        state.result = 'HOLD_MATCHING_POSITION';
        continue;
      }

      if (
        ['BLOCK','NO_MARKET_SNAPSHOT'].includes(String(row?.executionStatus ?? ''))
      ) {
        state.result = 'PENDING_EXECUTION_WAIT';
        continue;
      }

      const candleTime = Number(action.candleTime);
      if (await journal.hasIntentForCandle(symbol, candleTime)) {
        await clearPendingEntry(journal, String(row?.underlying ?? ''));
        state.result = 'DUPLICATE_CANDLE_BLOCKED';
        continue;
      }

      if (currentDirection !== 0) {
        const markBefore = Number(posRow.markPrice ?? 0);
        await closePosition(
          adapter,
          journal,
          leader,
          symbol,
          positionAmt,
          candleTime,
          'DEMO11_REVERSAL'
        );
        openCount = Math.max(0, openCount - 1);
        if (markBefore > 0) grossNotional = Math.max(
          0,
          grossNotional - Math.abs(positionAmt) * markBefore
        );

        const afterCloseRaw = await adapter.getPositionRisk(symbol);
        const afterCloseAmt = Number(positionRow(afterCloseRaw, symbol).positionAmt ?? 0);
        if (Math.abs(afterCloseAmt) > 1e-12) {
          state.result = 'REVERSAL_EXIT_NOT_FLAT';
          continue;
        }
        state.reversalExit = 'FLAT';
      }

      if (openCount >= maxOpenPositions) {
        state.result = 'MAX_OPEN_POSITIONS_BLOCK';
        continue;
      }
      if (grossNotional + targetNotional > maxGrossNotional + 1e-9) {
        state.result = 'MAX_GROSS_NOTIONAL_BLOCK';
        continue;
      }

      const book = await adapter.depth(symbol, 20);
      const bestBid = Number(book?.bids?.[0]?.[0]);
      const bestAsk = Number(book?.asks?.[0]?.[0]);
      if (!(bestBid > 0) || !(bestAsk > bestBid)) {
        state.result = 'INVALID_TESTNET_BOOK';
        continue;
      }

      const referencePrice = targetDirection === 1 ? bestAsk : bestBid;
      const maxBuyPrice = bestAsk * (1 + MAX_IOC_DEVIATION_BPS / 10_000);
      const minSellPrice = bestBid * (1 - MAX_IOC_DEVIATION_BPS / 10_000);
      const executableNotional = (
        targetDirection === 1 ? (book?.asks ?? []) : (book?.bids ?? [])
      ).reduce((sum: number, level: any) => {
        const p = Number(level?.[0]);
        const q = Number(level?.[1]);
        if (!(p > 0) || !(q > 0)) return sum;
        const inWindow =
          targetDirection === 1 ? p <= maxBuyPrice : p >= minSellPrice;
        return inWindow ? sum + p * q : sum;
      }, 0);
      const minRequiredLiveDepth = targetNotional * MIN_LIVE_DEPTH_MULTIPLE;
      state.liveDepthCheck = {
        side: targetDirection === 1 ? 'ASK' : 'BID',
        windowBps: MAX_IOC_DEVIATION_BPS,
        executableNotional,
        requiredNotional: minRequiredLiveDepth,
        multiple: MIN_LIVE_DEPTH_MULTIPLE,
      };
      if (executableNotional + 1e-9 < minRequiredLiveDepth) {
        state.result = 'INSUFFICIENT_LIVE_DEPTH_PENDING';
        continue;
      }

      const rawQty = ceilToStep(targetNotional / referencePrice, rules.stepSize);
      const rawLimit =
        targetDirection === 1
          ? bestAsk * (1 + MAX_IOC_DEVIATION_BPS / 10_000)
          : bestBid * (1 - MAX_IOC_DEVIATION_BPS / 10_000);
      const normalized = normalizeOrderToRules(rules, rawLimit, rawQty, referencePrice);
      const quantity = normalized.quantity.toFixed(decimalsFromStep(rules.stepSize));
      const price = normalized.price.toFixed(priceDecimals);

      const deploymentId = [
        'demo11-testnet-v1',
        String(row?.underlying ?? symbol),
        String(row?.strategy ?? 'unknown'),
        String(row?.timeframe ?? 'unknown'),
      ].join('-');

      const canonicalIntent = row?.canonicalIntent ?? null;
      const canonicalIntentId = String(canonicalIntent?.intent_id ?? '');
      const canonicalClientOrderId = String(canonicalIntent?.client_order_id ?? '');
      const canonicalSignalEventId = String(row?.canonicalSignalEventId ?? '');
      const canonicalExecutionDecisionId = String(row?.canonicalExecutionDecisionId ?? '');
      if (
        !canonicalIntentId ||
        !canonicalClientOrderId ||
        !canonicalSignalEventId ||
        !canonicalExecutionDecisionId
      ) {
        state.result = 'CANONICAL_LINEAGE_MISSING';
        continue;
      }
      if (
        canonicalClientOrderId.length > 36 ||
        !/^[A-Za-z0-9._-]+$/.test(canonicalClientOrderId)
      ) {
        state.result = 'INVALID_CANONICAL_CLIENT_ORDER_ID';
        continue;
      }
      if (String(canonicalIntent?.lead_signal_event_id ?? '') !== canonicalSignalEventId) {
        state.result = 'NON_LEAD_CANONICAL_SIGNAL_BLOCKED';
        continue;
      }
      const clientOrderId = canonicalClientOrderId;

      const side: 'BUY' | 'SELL' = targetDirection === 1 ? 'BUY' : 'SELL';
      const orderPackage = {
        kind: 'ENTRY_IOC',
        symbol,
        side,
        quantity,
        price,
        clientOrderId,
        reduceOnly: false,
        candleOpenTime: candleTime,
        fencingGeneration: leader.assertHeld(),
      };

      await journal.persistIntentAndOutbox(
        {
          intentId: clientOrderId,
          symbol,
          side,
          state: 'PERSISTED',
          payload: {
            cohortId: signalDoc.cohortId,
            deploymentId,
            candleOpenTime: candleTime,
            strategy: row?.strategy ?? null,
            timeframe: row?.timeframe ?? null,
            fencingGeneration: leader.assertHeld(),
            canonicalSignalEventId,
            canonicalExecutionDecisionId,
            canonicalIntentId,
            canonicalClientOrderId,
            canonicalSupportCount: Number(canonicalIntent?.support_count ?? 1),
            canonicalSupportingSignalEventIds: canonicalIntent?.supporting_signal_event_ids ?? [],
          },
        },
        orderPackage
      );

      const claimed = await journal.claimOutboxByIntent(clientOrderId);
      if (!claimed) {
        state.result = 'OUTBOX_CLAIM_FAILED';
        continue;
      }
      await clearPendingEntry(journal, String(row?.underlying ?? ''));

      state.plannedEntry = {
        direction: action.direction,
        quantity,
        price,
        targetNotional,
        maxIocDeviationBps: MAX_IOC_DEVIATION_BPS,
      };
      state.intentId = clientOrderId;

      let order: any = null;
      try {
        inFlight.markSent(clientOrderId);
        order = await adapter.placeIocLimit({
          symbol,
          side,
          quantity,
          price,
          clientOrderId,
          reduceOnly: false,
        });
        await journal.appendEvent('ORDER_ACK', clientOrderId, { response: order });
        await journal.markOutboxDone(claimed.outboxId);
        inFlight.resolve(clientOrderId);
      } catch (error: any) {
        await journal.appendEvent('ORDER_SUBMIT_UNKNOWN', clientOrderId, {
          symbol,
          message: String(error?.message ?? error),
        });
        await sleep(500);
        const recovered = await adapter.getOrderByClientId(symbol, clientOrderId);
        if (!recovered) {
          state.result = 'ORDER_ACK_UNKNOWN_HALT';
          state.error = String(error?.message ?? error);
          continue;
        }
        order = recovered;
        await journal.markOutboxUnknownResolved(
          claimed.outboxId,
          String(order.status ?? 'FOUND'),
          { order }
        );
        inFlight.resolve(clientOrderId);
      }

      const filledQty = await recordOrderFill(
        adapter,
        journal,
        symbol,
        order,
        side,
        clientOrderId,
        clientOrderId
      );
      await journal.appendEvent('DEMO11_CANONICAL_ORDER_LINEAGE', clientOrderId, {
        canonicalSignalEventId,
        canonicalExecutionDecisionId,
        canonicalIntentId,
        canonicalClientOrderId,
        exchangeOrderId: order?.orderId ?? null,
        executedQty: order?.executedQty ?? filledQty,
        avgPrice: order?.avgPrice ?? null,
      });

      await sleep(400);
      const afterRaw = await adapter.getPositionRisk(symbol);
      const afterRow = positionRow(afterRaw, symbol);
      const afterAmt = Number(afterRow.positionAmt ?? 0);
      const afterDirection = afterAmt > 1e-12 ? 1 : afterAmt < -1e-12 ? -1 : 0;

      state.entryOrder = {
        status: order?.status ?? null,
        executedQty: order?.executedQty ?? filledQty,
        avgPrice: order?.avgPrice ?? null,
        orderId: order?.orderId ?? null,
      };

      if (Math.abs(afterAmt) <= 1e-12) {
        state.result = 'IOC_NOT_FILLED_NO_CHASE';
        continue;
      }

      if (afterDirection !== targetDirection) {
        await closePosition(
          adapter,
          journal,
          leader,
          symbol,
          afterAmt,
          candleTime,
          'DEMO11_WRONG_DIRECTION_FAIL_CLOSED'
        );
        state.result = 'WRONG_DIRECTION_FAIL_CLOSED';
        continue;
      }

      const entryPrice = Number(afterRow.entryPrice ?? order?.avgPrice ?? 0);
      if (!(entryPrice > 0)) {
        await closePosition(
          adapter,
          journal,
          leader,
          symbol,
          afterAmt,
          candleTime,
          'DEMO11_NO_VALID_ENTRY_PRICE'
        );
        state.result = 'NO_VALID_ENTRY_PRICE_FAIL_CLOSED';
        continue;
      }

      try {
        await ensureProtection(
          adapter,
          journal,
          leader,
          symbol,
          targetDirection,
          entryPrice,
          rules.tickSize,
          priceDecimals,
          clientOrderId,
          stopFraction
        );
      } catch (error: any) {
        const currentRaw = await adapter.getPositionRisk(symbol);
        const currentAmt = Number(positionRow(currentRaw, symbol).positionAmt ?? 0);
        if (Math.abs(currentAmt) > 1e-12) {
          await closePosition(
            adapter,
            journal,
            leader,
            symbol,
            currentAmt,
            candleTime,
            'DEMO11_PROTECTION_FAILURE_FAIL_CLOSED'
          );
        }
        state.result = 'PROTECTION_FAILURE_FAIL_CLOSED';
        state.error = String(error?.message ?? error);
        continue;
      }

      const finalRecon = await reconciler.reconcile(symbol);
      state.reconcileAfter = {
        ok: finalRecon.ok,
        halt: finalRecon.halt,
        diagnostics: finalRecon.diagnostics,
      };
      if (finalRecon.halt) {
        state.result = 'POST_ENTRY_RECONCILIATION_HALTED';
        continue;
      }

      openCount += 1;
      const markAfter = Number(afterRow.markPrice ?? referencePrice);
      if (markAfter > 0) grossNotional += Math.abs(afterAmt) * markAfter;
      state.positionAfter = {
        positionAmt: afterAmt,
        entryPrice,
        direction: targetDirection === 1 ? 'LONG' : 'SHORT',
        protected: true,
      };
      state.result = 'OPEN_PROTECTED';
    }

    const finalPositions: any[] = [];
    for (const row of rows) {
      const symbol = String(row?.executionContract ?? '');
      if (!symbol || !testnetTradable.has(symbol)) continue;
      const raw = await adapter.getPositionRisk(symbol);
      const p = positionRow(raw, symbol);
      const amt = Number(p.positionAmt ?? 0);
      if (Math.abs(amt) <= 1e-12) continue;
      const expectedQty = await journal.expectedNetPosition(symbol);
      const tolerance = Math.max(1e-9, Math.abs(amt) * 1e-6);
      const owned = Math.abs(expectedQty) > 1e-12 && Math.abs(expectedQty - amt) <= tolerance;
      finalPositions.push({
        underlying: row?.underlying ?? null,
        symbol,
        positionAmt: amt,
        expectedJournalQty: expectedQty,
        ownership: owned ? 'DEMO11_OWNED' : 'FOREIGN_OR_LEGACY',
        direction: amt > 0 ? 'LONG' : 'SHORT',
        entryPrice: Number(p.entryPrice ?? 0),
        markPrice: Number(p.markPrice ?? 0),
        unrealizedProfit: Number(p.unRealizedProfit ?? p.unrealizedProfit ?? 0),
      });
    }

    const ownedPositions = finalPositions.filter(x => x.ownership === 'DEMO11_OWNED');
    const foreignPositions = finalPositions.filter(x => x.ownership !== 'DEMO11_OWNED');
    const fillsResult = await journal.pool.query(
      `SELECT symbol,side,fill_price,quantity,event_time,fill_id
         FROM live_fills
        ORDER BY event_time,fill_id`
    );
    const allJournalFills = fillsResult.rows;
    const validJournalFills = allJournalFills.filter(
      (x: any) => Number(x.event_time ?? 0) >= DEMO11_VALID_METRICS_EPOCH_MS
    );
    const ledgerPnl = computeLedgerPnl(validJournalFills);
    const excludedPreFixFills = allJournalFills.length - validJournalFills.length;
    const ownedUnrealizedPnl = ownedPositions.reduce(
      (sum, x) => sum + Number(x.unrealizedProfit ?? 0),
      0
    );

    report.testnetPositions = ownedPositions;
    report.foreignOrLegacyPositions = foreignPositions;
    report.pnl = {
      realizedGrossPnl: ledgerPnl.realizedGrossPnl,
      realizedGrossPnlBySymbol: ledgerPnl.realizedBySymbol,
      unrealizedPnl: ownedUnrealizedPnl,
      totalGrossPnl: ledgerPnl.realizedGrossPnl + ownedUnrealizedPnl,
      metricsEpoch: new Date(DEMO11_VALID_METRICS_EPOCH_MS).toISOString(),
      excludedPreFixFills,
      note: 'Canonical Demo-11 TESTNET performance starts after the 2026-09-29 transient-BLOCK exit bug fix. Raw journal remains immutable; pre-fix infrastructure-error fills are excluded. Foreign or legacy exchange positions are also excluded.',
    };
    report.summary = {
      targetSymbols: targetSymbols.length,
      testnetTradableSymbols: targetSymbols.filter(x => testnetTradable.has(x)).length,
      unavailableOnTestnet: report.symbols.filter((x: any) => x.result === 'UNAVAILABLE_ON_TESTNET').length,
      openPositions: ownedPositions.length,
      foreignOrLegacyOpenPositions: foreignPositions.length,
      openedProtected: report.symbols.filter((x: any) => x.result === 'OPEN_PROTECTED').length,
      closedToFlat: report.symbols.filter((x: any) => x.result === 'CLOSED_TO_FLAT').length,
      safetyFlattened: report.symbols.filter((x: any) => String(x.result).startsWith('SAFETY_FLATTENED')).length,
      reconciliationHalts: report.symbols.filter((x: any) => String(x.result).includes('RECONCILIATION_HALTED')).length,
      realizedGrossPnl: report.pnl.realizedGrossPnl,
      unrealizedPnl: report.pnl.unrealizedPnl,
      totalGrossPnl: report.pnl.totalGrossPnl,
      errors: report.symbols.filter((x: any) => x.error).length,
    };
    report.result = 'SUCCESS';

    await journal.appendEvent('DEMO11_TESTNET_CYCLE', 'demo-10-forward-v2', {
      summary: report.summary,
      generatedAt: report.generatedAt,
    });
    await writeReport(report);
  } catch (error: any) {
    report.result = 'FAIL';
    report.error = String(error?.stack ?? error?.message ?? error);
    try {
      await journal.appendEvent('DEMO11_TESTNET_FAILURE', 'demo-10-forward-v2', {
        message: String(error?.message ?? error),
      });
    } catch {}
    await writeReport(report);
    throw error;
  } finally {
    await leader.release().catch(() => undefined);
    await journal.close().catch(() => undefined);
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
