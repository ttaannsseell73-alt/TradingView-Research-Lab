import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import {
  deterministicClientOrderId,
  InFlightRegistry,
  qCanonicalManifest,
  RateLimitGovernor,
  resolveRange48ExecutionAction,
} from '../live/CanonicalLive';
import { BinanceUsdmAdapter } from '../live/BinanceUsdmAdapter';
import { QShadowRuntime } from '../live/QShadowRuntime';
import {
  AccountContractVerifier,
  CanonicalExecutionWriter,
  CanonicalReconciler,
  normalizeOrderToRules,
  parseSymbolRules,
  ProtectionManager,
} from '../live/ExecutionSafety';
import { PgEventJournal, PgLeaderLock } from '../live/PostgresSafety';

dotenv.config();

const SYMBOL = 'QUSDT' as const;
const DEMO_CATASTROPHIC_STOP_FRACTION = 0.20;
const MAX_IOC_DEVIATION_BPS = 30;

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

function positionRow(raw: any): any {
  const rows = Array.isArray(raw) ? raw : [raw];
  return rows.find((x: any) => x?.symbol === SYMBOL) ?? rows[0] ?? {};
}

function algoId(row: any): string {
  return String(row?.clientAlgoId ?? row?.algoId ?? '');
}

async function recordOrderFill(
  journal: PgEventJournal,
  order: any,
  side: 'BUY' | 'SELL',
  intentId: string | null
): Promise<number> {
  const quantity = Number(order?.executedQty ?? 0);
  const fillPrice = Number(order?.avgPrice ?? order?.price ?? 0);
  if (!(quantity > 0) || !(fillPrice > 0)) return 0;
  const fillId = [
    SYMBOL,
    String(order?.orderId ?? ''),
    String(order?.updateTime ?? order?.time ?? Date.now()),
    side,
  ].join('|');
  await journal.recordFill({
    fillId,
    intentId,
    symbol: SYMBOL,
    side,
    expectedPrice: null,
    fillPrice,
    quantity,
    eventTime: Number(order?.updateTime ?? order?.time ?? Date.now()),
    payload: order ?? {},
  });
  return quantity;
}

async function cancelKnownProtection(
  adapter: BinanceUsdmAdapter,
  journal: PgEventJournal
): Promise<void> {
  const known = new Set(await journal.knownProtectionIds());
  const open = await adapter.getOpenAlgoOrders(SYMBOL);
  for (const row of Array.isArray(open) ? open : []) {
    const id = algoId(row);
    if (!id || !known.has(id)) continue;
    try {
      await adapter.cancelAlgoOrder(id);
      await journal.appendEvent('PROTECTION_CANCELLED', id, { symbol: SYMBOL });
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
  positionAmt: number,
  candleOpenTime: number,
  reason: string
): Promise<void> {
  if (Math.abs(positionAmt) < 1e-12) return;
  const side: 'BUY' | 'SELL' = positionAmt > 0 ? 'SELL' : 'BUY';
  const quantity = String(Math.abs(positionAmt));
  const clientOrderId = deterministicClientOrderId({
    deploymentId: 'q-demo-risk-exit',
    symbol: SYMBOL,
    candleOpenTime,
    action: side === 'SELL' ? 'EXIT_LONG' : 'EXIT_SHORT',
    generation: leader.assertHeld(),
  });
  const result = await adapter.closePositionMarket({
    symbol: SYMBOL,
    side,
    quantity,
    clientOrderId,
  });
  await journal.appendEvent('RISK_REDUCING_EXIT_ACK', clientOrderId, {
    reason,
    response: result,
  });
  await recordOrderFill(journal, result, side, null);
  await sleep(400);
  await cancelKnownProtection(adapter, journal);
}

async function ensureProtection(
  adapter: BinanceUsdmAdapter,
  journal: PgEventJournal,
  leader: PgLeaderLock,
  direction: 1 | -1,
  entryPrice: number,
  tickSize: number,
  priceDecimals: number,
  positionIdentity: string
): Promise<void> {
  const raw =
    direction === 1
      ? entryPrice * (1 - DEMO_CATASTROPHIC_STOP_FRACTION)
      : entryPrice * (1 + DEMO_CATASTROPHIC_STOP_FRACTION);
  const trigger =
    direction === 1 ? floorToStep(raw, tickSize) : ceilToStep(raw, tickSize);
  if (!(trigger > 0)) throw new Error('INVALID_CATASTROPHIC_TRIGGER');

  const manager = new ProtectionManager(adapter, journal, leader);
  await manager.ensureCatastrophicStop({
    symbol: SYMBOL,
    positionSide: direction === 1 ? 'LONG' : 'SHORT',
    triggerPrice: trigger.toFixed(priceDecimals),
    positionIdentity,
  });

  const known = new Set(await journal.knownProtectionIds());
  const open = await adapter.getOpenAlgoOrders(SYMBOL);
  const protectedNow = (Array.isArray(open) ? open : []).some((x: any) =>
    known.has(algoId(x))
  );
  if (!protectedNow) throw new Error('PROTECTION_NOT_VERIFIED_ON_EXCHANGE');
}

async function writeReport(report: Record<string, unknown>): Promise<void> {
  const dir = path.join(process.cwd(), 'artifacts');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'q-demo-forward-latest.json'),
    JSON.stringify(report, null, 2) + '\n',
    'utf8'
  );
  fs.appendFileSync(
    path.join(dir, 'q-demo-forward.jsonl'),
    JSON.stringify(report) + '\n',
    'utf8'
  );
}

async function main(): Promise<void> {
  const testnetUrl = process.env.BINANCE_FUTURES_URL?.trim() ?? '';
  const publicUrl =
    process.env.BINANCE_PUBLIC_FUTURES_URL?.trim() ?? 'https://fapi.binance.com';
  const apiKey = process.env.BINANCE_API_KEY?.trim() ?? '';
  const apiSecret = process.env.BINANCE_API_SECRET?.trim() ?? '';
  const pgUrl = process.env.LIVEBOT_PG_URL?.trim() ?? '';

  if (!apiKey || !apiSecret) throw new Error('BINANCE_DEMO_CREDENTIALS_MISSING');
  if (!pgUrl) throw new Error('LIVEBOT_PG_URL_MISSING');
  const host = new URL(testnetUrl).hostname.toLowerCase();
  if (host !== 'testnet.binancefuture.com') {
    throw new Error('DEMO_FORWARD_REQUIRES_BINANCE_TESTNET');
  }
  if (process.env.LIVEBOT_CANARY_APPROVED !== 'YES') {
    throw new Error('DEMO_FORWARD_CANARY_APPROVAL_MISSING');
  }

  const journal = new PgEventJournal(pgUrl);
  const leader = new PgLeaderLock(journal, 'q-demo-forward-v1');
  const report: Record<string, any> = {
    generatedAt: new Date().toISOString(),
    symbol: SYMBOL,
    strategy: 'swp_range48_reclaim',
    strategyVersion: 'sweep-v1',
    execution: 'BINANCE_USDM_TESTNET',
    leverage: 1,
    marginType: 'ISOLATED',
    catastrophicProtection: {
      safetyOnly: true,
      fraction: DEMO_CATASTROPHIC_STOP_FRACTION,
    },
  };

  try {
    await journal.init();
    await journal.healthcheck();
    const lock = await leader.acquire();
    report.leader = lock;
    if (!lock.acquired) {
      report.result = 'SKIP_NOT_LEADER';
      await writeReport(report);
      return;
    }

    const publicGovernor = new RateLimitGovernor();
    const publicAdapter = new BinanceUsdmAdapter({
      baseUrl: publicUrl,
      mode: 'SHADOW',
      governor: publicGovernor,
    });

    const execGovernor = new RateLimitGovernor();
    const execAdapter = new BinanceUsdmAdapter({
      baseUrl: testnetUrl,
      apiKey,
      apiSecret,
      mode: 'CANARY',
      governor: execGovernor,
    });
    await execAdapter.serverTime();

    const contract = await new AccountContractVerifier(execAdapter).verify(SYMBOL, 1);
    report.accountContract = contract;
    if (!contract.ok) throw new Error('ACCOUNT_CONTRACT_FAIL_' + contract.reasons.join(','));

    const inFlight = new InFlightRegistry();
    const reconciler = new CanonicalReconciler(execAdapter, journal, inFlight);
    const reconcile = await reconciler.reconcile(SYMBOL);
    report.reconcileBefore = { ok: reconcile.ok, halt: reconcile.halt };
    if (reconcile.halt) throw new Error('RECONCILIATION_HALTED');

    const shadow = await new QShadowRuntime(publicAdapter, publicGovernor).runOnce();
    report.market = {
      generatedAt: shadow.generatedAt,
      barrier: shadow.dataBarrier.reason,
      signal: shadow.signal,
      proximity: shadow.proximity,
      intent: shadow.intent,
      spreadBps: shadow.spreadBps,
      bidDepth5Notional: shadow.bidDepth5Notional,
      askDepth5Notional: shadow.askDepth5Notional,
      lastBarOpenTime: shadow.lastBarOpenTime,
    };

    const rawPosition = await execAdapter.getPositionRisk(SYMBOL);
    let row = positionRow(rawPosition);
    let positionAmt = Number(row.positionAmt ?? 0);
    if (!Number.isFinite(positionAmt)) throw new Error('INVALID_POSITION_AMOUNT');

    const action = resolveRange48ExecutionAction(shadow.signal, positionAmt);
    report.positionBefore = {
      positionAmt,
      entryPrice: Number(row.entryPrice ?? 0),
      markPrice: Number(row.markPrice ?? 0),
    };
    report.action = action;

    if (!shadow.signal.fresh || action === 'HOLD') {
      if (Math.abs(positionAmt) > 1e-12) {
        const known = new Set(await journal.knownProtectionIds());
        const openAlgo = await execAdapter.getOpenAlgoOrders(SYMBOL);
        const protectedNow = (Array.isArray(openAlgo) ? openAlgo : []).some((x: any) =>
          known.has(algoId(x))
        );
        report.protected = protectedNow;
        if (!protectedNow) {
          await closePosition(
            execAdapter,
            journal,
            leader,
            positionAmt,
            shadow.lastBarOpenTime,
            'OPEN_POSITION_WITHOUT_VERIFIED_PROTECTION'
          );
          report.result = 'SAFETY_FLATTENED_UNPROTECTED';
          await journal.appendEvent('Q_FORWARD_CYCLE', SYMBOL, report);
          await writeReport(report);
          return;
        }
      }
      report.result = shadow.signal.fresh ? 'HOLD_MATCHING_POSITION' : 'NO_FRESH_SIGNAL';
      await journal.appendEvent('Q_FORWARD_CYCLE', SYMBOL, report);
      await writeReport(report);
      return;
    }

    const candleOpenTime = Number(shadow.signal.barOpenTime ?? shadow.lastBarOpenTime);
    if (await journal.hasIntentForCandle(SYMBOL, candleOpenTime)) {
      report.result = 'DUPLICATE_CANDLE_BLOCKED';
      await journal.appendEvent('Q_FORWARD_CYCLE', SYMBOL, report);
      await writeReport(report);
      return;
    }

    if (action === 'HALT_UNKNOWN_POSITION') {
      throw new Error('HALT_UNKNOWN_POSITION');
    }

    const targetDirection: 1 | -1 =
      action === 'ENTER_LONG' || action === 'REVERSE_TO_LONG' ? 1 : -1;

    if (action === 'REVERSE_TO_LONG' || action === 'REVERSE_TO_SHORT') {
      await closePosition(
        execAdapter,
        journal,
        leader,
        positionAmt,
        candleOpenTime,
        'RANGE48_REVERSAL'
      );
      const afterCloseRaw = await execAdapter.getPositionRisk(SYMBOL);
      const afterClose = Number(positionRow(afterCloseRaw).positionAmt ?? 0);
      if (Math.abs(afterClose) > 1e-12) throw new Error('REVERSAL_EXIT_NOT_FLAT');
      positionAmt = 0;
      report.reversalExit = 'FLAT';
    }

    const info = await execAdapter.exchangeInfo();
    const rules = parseSymbolRules(info, SYMBOL);
    const book = await execAdapter.depth(SYMBOL, 20);
    const bestBid = Number(book?.bids?.[0]?.[0]);
    const bestAsk = Number(book?.asks?.[0]?.[0]);
    if (!(bestBid > 0) || !(bestAsk > bestBid)) throw new Error('INVALID_TESTNET_BOOK');

    const referencePrice = targetDirection === 1 ? bestAsk : bestBid;
    const targetNotional = 100;
    const rawQty = ceilToStep(targetNotional / referencePrice, rules.stepSize);
    const rawLimit =
      targetDirection === 1
        ? bestAsk * (1 + MAX_IOC_DEVIATION_BPS / 10_000)
        : bestBid * (1 - MAX_IOC_DEVIATION_BPS / 10_000);
    const normalized = normalizeOrderToRules(rules, rawLimit, rawQty, referencePrice);
    const priceDecimals = decimalsFromStep(rules.tickSize);
    const qtyDecimals = decimalsFromStep(rules.stepSize);
    const price = normalized.price.toFixed(priceDecimals);
    const quantity = normalized.quantity.toFixed(qtyDecimals);

    report.plannedEntry = {
      direction: targetDirection,
      quantity,
      price,
      targetNotional,
      maxIocDeviationBps: MAX_IOC_DEVIATION_BPS,
    };

    const writer = new CanonicalExecutionWriter(
      execAdapter,
      journal,
      leader,
      execGovernor,
      inFlight
    );
    const manifest = qCanonicalManifest('CANARY');
    const persisted = await writer.persistEntry({
      deploymentId: manifest.deploymentId,
      candleOpenTime,
      action: targetDirection === 1 ? 'LONG' : 'SHORT',
      quantity,
      price,
      systemMode: 'RUNNING',
    });
    report.intentId = persisted.clientOrderId;
    await writer.dispatchPending(1);

    await sleep(500);
    const order = await execAdapter.getOrderByClientId(SYMBOL, persisted.clientOrderId);
    report.entryOrder = order
      ? {
          status: order.status,
          executedQty: order.executedQty,
          avgPrice: order.avgPrice,
          orderId: order.orderId,
        }
      : null;

    const afterEntryRaw = await execAdapter.getPositionRisk(SYMBOL);
    row = positionRow(afterEntryRaw);
    positionAmt = Number(row.positionAmt ?? 0);

    if (!order && Math.abs(positionAmt) > 1e-12) {
      await journal.appendEvent('ENTRY_ACK_UNKNOWN_POSITION_FOUND', persisted.clientOrderId, {
        positionRisk: afterEntryRaw,
      });
      await closePosition(
        execAdapter,
        journal,
        leader,
        positionAmt,
        candleOpenTime,
        'UNKNOWN_ENTRY_ACK_FAIL_CLOSED'
      );
      throw new Error('UNKNOWN_ENTRY_ACK_FAIL_CLOSED');
    }

    if (order) {
      await recordOrderFill(
        journal,
        order,
        targetDirection === 1 ? 'BUY' : 'SELL',
        persisted.clientOrderId
      );
    }

    if (Math.abs(positionAmt) <= 1e-12) {
      report.result = 'IOC_NOT_FILLED_NO_CHASE';
      await journal.appendEvent('Q_FORWARD_CYCLE', SYMBOL, report);
      await writeReport(report);
      return;
    }

    const actualDirection: 1 | -1 = positionAmt > 0 ? 1 : -1;
    if (actualDirection !== targetDirection) {
      await closePosition(
        execAdapter,
        journal,
        leader,
        positionAmt,
        candleOpenTime,
        'WRONG_DIRECTION_FAIL_CLOSED'
      );
      throw new Error('WRONG_DIRECTION_AFTER_ENTRY');
    }

    const entryPrice = Number(row.entryPrice ?? order?.avgPrice ?? 0);
    if (!(entryPrice > 0)) {
      await closePosition(
        execAdapter,
        journal,
        leader,
        positionAmt,
        candleOpenTime,
        'NO_VALID_ENTRY_PRICE'
      );
      throw new Error('NO_VALID_ENTRY_PRICE');
    }

    try {
      await ensureProtection(
        execAdapter,
        journal,
        leader,
        targetDirection,
        entryPrice,
        rules.tickSize,
        priceDecimals,
        persisted.clientOrderId
      );
    } catch (error) {
      const currentRaw = await execAdapter.getPositionRisk(SYMBOL);
      const currentAmt = Number(positionRow(currentRaw).positionAmt ?? 0);
      if (Math.abs(currentAmt) > 1e-12) {
        await closePosition(
          execAdapter,
          journal,
          leader,
          currentAmt,
          candleOpenTime,
          'PROTECTION_FAILURE_FAIL_CLOSED'
        );
      }
      throw error;
    }

    const finalRecon = await reconciler.reconcile(SYMBOL);
    report.reconcileAfter = { ok: finalRecon.ok, halt: finalRecon.halt };
    if (finalRecon.halt) throw new Error('POST_ENTRY_RECONCILIATION_HALTED');

    report.positionAfter = {
      positionAmt,
      entryPrice,
      direction: targetDirection,
      protected: true,
    };
    report.result = 'OPEN_PROTECTED';
    await journal.appendEvent('Q_FORWARD_CYCLE', SYMBOL, report);
    await writeReport(report);
  } catch (error: any) {
    report.result = 'FAIL';
    report.error = String(error?.stack ?? error?.message ?? error);
    try {
      await journal.appendEvent('Q_FORWARD_FAILURE', SYMBOL, {
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
