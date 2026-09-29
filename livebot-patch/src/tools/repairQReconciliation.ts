import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { BinanceUsdmAdapter } from '../live/BinanceUsdmAdapter';
import { CanonicalReconciler } from '../live/ExecutionSafety';
import { InFlightRegistry, RateLimitGovernor } from '../live/CanonicalLive';
import { PgEventJournal } from '../live/PostgresSafety';

dotenv.config();

const SYMBOL = 'QUSDT' as const;
const TOLERANCE = 1e-9;

function positionRow(raw: any): any {
  const rows = Array.isArray(raw) ? raw : [raw];
  return rows.find((x: any) => x?.symbol === SYMBOL) ?? rows[0] ?? {};
}

function algoId(row: any): string {
  return String(row?.clientAlgoId ?? row?.algoId ?? '');
}

async function main(): Promise<void> {
  const baseUrl = process.env.BINANCE_FUTURES_URL?.trim() ?? '';
  const apiKey = process.env.BINANCE_API_KEY?.trim() ?? '';
  const apiSecret = process.env.BINANCE_API_SECRET?.trim() ?? '';
  const pgUrl = process.env.LIVEBOT_PG_URL?.trim() ?? '';

  if (!baseUrl || new URL(baseUrl).hostname.toLowerCase() !== 'testnet.binancefuture.com') {
    throw new Error('REPAIR_REQUIRES_BINANCE_TESTNET');
  }
  if (!apiKey || !apiSecret) throw new Error('BINANCE_DEMO_CREDENTIALS_MISSING');
  if (!pgUrl) throw new Error('LIVEBOT_PG_URL_MISSING');

  const journal = new PgEventJournal(pgUrl);
  const adapter = new BinanceUsdmAdapter({
    baseUrl,
    apiKey,
    apiSecret,
    mode: 'SHADOW',
    governor: new RateLimitGovernor(),
  });

  const report: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    symbol: SYMBOL,
    mode: 'CONTROLLED_RECONCILIATION_REPAIR',
  };

  try {
    await journal.init();
    await journal.healthcheck();
    await adapter.serverTime();

    const unresolved = await journal.unresolvedOutbox();
    const [openOrders, openAlgoOrders, rawPosition, knownIntentIds, knownProtectionIds] =
      await Promise.all([
        adapter.getOpenOrders(SYMBOL),
        adapter.getOpenAlgoOrders(SYMBOL),
        adapter.getPositionRisk(SYMBOL),
        journal.knownIntentIds(),
        journal.knownProtectionIds(),
      ]);

    const knownOrders = new Set(knownIntentIds);
    const knownAlgo = new Set(knownProtectionIds);
    const foreignOrders = (Array.isArray(openOrders) ? openOrders : []).filter(
      (o: any) => o?.clientOrderId && !knownOrders.has(String(o.clientOrderId))
    );
    const foreignAlgo = (Array.isArray(openAlgoOrders) ? openAlgoOrders : []).filter((o: any) => {
      const id = algoId(o);
      return id && !knownAlgo.has(id);
    });

    const row = positionRow(rawPosition);
    const exchangePosition = Number(row.positionAmt ?? 0);
    const exchangeEntryPrice = Number(row.entryPrice ?? 0);
    const exchangeMarkPrice = Number(row.markPrice ?? 0);
    const expectedBefore = await journal.expectedNetPosition(SYMBOL);

    const latestRecon = await journal.pool.query(
      `SELECT id::text AS id, created_at, payload
         FROM live_events
        WHERE event_type='RECONCILIATION_ERROR' AND entity_id=$1
        ORDER BY id DESC
        LIMIT 1`,
      [SYMBOL]
    );
    if (!latestRecon.rows.length) throw new Error('NO_RECONCILIATION_ERROR_TO_REPAIR');

    const evidence = latestRecon.rows[0];
    const payload = evidence.payload ?? {};
    const evidenceExchangePosition = Number(payload.exchangePosition);
    const evidenceExpectedPosition = Number(payload.expectedPosition);
    const evidenceForeignOrders = Array.isArray(payload.foreignClientOrderIds)
      ? payload.foreignClientOrderIds
      : [];
    const evidenceForeignAlgo = Array.isArray(payload.foreignAlgoIds)
      ? payload.foreignAlgoIds
      : [];

    const recentBotExecution = await journal.pool.query(
      `SELECT event_type, entity_id, created_at
         FROM live_events
        WHERE created_at >= NOW() - INTERVAL '6 hours'
          AND event_type IN ('RISK_REDUCING_EXIT_ACK','ORDER_ACK','PROTECTION_ACK')
        ORDER BY id DESC
        LIMIT 50`
    );
    const hasRiskExit = recentBotExecution.rows.some((x: any) => x.event_type === 'RISK_REDUCING_EXIT_ACK');
    const hasOrderAck = recentBotExecution.rows.some((x: any) => x.event_type === 'ORDER_ACK');

    report.precheck = {
      expectedBefore,
      exchangePosition,
      exchangeEntryPrice,
      exchangeMarkPrice,
      unresolvedOutbox: unresolved.map(x => ({ intentId: x.intentId, status: x.status })),
      foreignClientOrderIds: foreignOrders.map((x: any) => String(x.clientOrderId)),
      foreignAlgoIds: foreignAlgo.map((x: any) => algoId(x)),
      latestReconciliationError: {
        id: evidence.id,
        createdAt: evidence.created_at,
        expectedPosition: evidenceExpectedPosition,
        exchangePosition: evidenceExchangePosition,
        positionMismatch: Boolean(payload.positionMismatch),
        unresolvedUnknown: Boolean(payload.unresolvedUnknown),
        foreignClientOrderIds: evidenceForeignOrders,
        foreignAlgoIds: evidenceForeignAlgo,
      },
      recentBotExecution: { hasRiskExit, hasOrderAck },
    };

    if (!Number.isFinite(exchangePosition)) throw new Error('INVALID_EXCHANGE_POSITION');
    if (unresolved.length) throw new Error('REPAIR_BLOCKED_UNRESOLVED_OUTBOX');
    if (foreignOrders.length) throw new Error('REPAIR_BLOCKED_FOREIGN_ORDER');
    if (foreignAlgo.length) throw new Error('REPAIR_BLOCKED_FOREIGN_ALGO');
    if (!Boolean(payload.positionMismatch)) throw new Error('REPAIR_REQUIRES_POSITION_MISMATCH');
    if (Boolean(payload.unresolvedUnknown)) throw new Error('REPAIR_BLOCKED_UNKNOWN_ORDER');
    if (evidenceForeignOrders.length || evidenceForeignAlgo.length) {
      throw new Error('REPAIR_BLOCKED_BY_RECON_EVIDENCE');
    }
    if (!Number.isFinite(evidenceExchangePosition) ||
        Math.abs(evidenceExchangePosition - exchangePosition) > TOLERANCE) {
      throw new Error('REPAIR_BLOCKED_EXCHANGE_POSITION_CHANGED');
    }
    if (!hasRiskExit || !hasOrderAck) throw new Error('REPAIR_BLOCKED_NO_RECENT_BOT_REVERSAL_EVIDENCE');

    const delta = exchangePosition - expectedBefore;
    if (Math.abs(delta) <= TOLERANCE) {
      report.result = 'NO_ADJUSTMENT_NEEDED';
    } else {
      const adjustmentId = await journal.applyPositionAdjustment({
        symbol: SYMBOL,
        quantityDelta: delta,
        reason: 'CONTROLLED_RECONCILIATION_REPAIR',
        payload: {
          reconciliationEventId: evidence.id,
          evidenceCreatedAt: evidence.created_at,
          expectedBefore,
          exchangePosition,
          exchangeEntryPrice,
          exchangeMarkPrice,
          evidenceExpectedPosition,
          evidenceExchangePosition,
        },
      });
      report.adjustment = { adjustmentId, quantityDelta: delta };
      report.result = 'ADJUSTMENT_APPLIED';
    }

    const expectedAfter = await journal.expectedNetPosition(SYMBOL);
    report.expectedAfter = expectedAfter;
    if (Math.abs(expectedAfter - exchangePosition) > TOLERANCE) {
      throw new Error('POSITION_LEDGER_REPAIR_DID_NOT_CONVERGE');
    }

    const reconciler = new CanonicalReconciler(adapter, journal, new InFlightRegistry(), 0);
    const finalRecon = await reconciler.reconcile(SYMBOL);
    report.finalReconcile = {
      ok: finalRecon.ok,
      halt: finalRecon.halt,
      diagnostics: finalRecon.diagnostics,
    };
    if (finalRecon.halt) throw new Error('REPAIR_FINAL_RECONCILIATION_HALTED');

    const outDir = path.join(process.cwd(), 'artifacts');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(
      path.join(outDir, 'q-reconciliation-repair.json'),
      JSON.stringify(report, null, 2) + '\n',
      'utf8'
    );
    console.log(JSON.stringify(report));
  } finally {
    await journal.close().catch(() => undefined);
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
