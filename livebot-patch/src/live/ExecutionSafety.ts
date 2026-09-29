import {
  deterministicClientOrderId,
  InFlightRegistry,
  RateLimitGovernor,
  SystemMode,
} from './CanonicalLive';
import { BinanceUsdmAdapter } from './BinanceUsdmAdapter';
import { PgEventJournal, PgLeaderLock } from './PostgresSafety';

export interface SymbolRules {
  symbol: string;
  status: string;
  tickSize: number;
  minPrice: number;
  maxPrice: number;
  stepSize: number;
  minQty: number;
  maxQty: number;
  minNotional: number;
  percentMultiplierUp: number;
  percentMultiplierDown: number;
}

function findFilter(symbolInfo: any, type: string): any {
  return (symbolInfo?.filters ?? []).find((f: any) => f.filterType === type) ?? {};
}

export function parseSymbolRules(exchangeInfo: any, symbol: string): SymbolRules {
  const s = exchangeInfo?.symbols?.find((x: any) => x.symbol === symbol);
  if (!s) throw new Error('SYMBOL_NOT_FOUND_' + symbol);
  const price = findFilter(s, 'PRICE_FILTER');
  const lot = findFilter(s, 'LOT_SIZE');
  const marketLot = findFilter(s, 'MARKET_LOT_SIZE');
  const minNotional = findFilter(s, 'MIN_NOTIONAL');
  const percent = findFilter(s, 'PERCENT_PRICE');
  return {
    symbol,
    status: String(s.status ?? ''),
    tickSize: Number(price.tickSize ?? 0),
    minPrice: Number(price.minPrice ?? 0),
    maxPrice: Number(price.maxPrice ?? 0),
    stepSize: Number(lot.stepSize ?? marketLot.stepSize ?? 0),
    minQty: Number(lot.minQty ?? marketLot.minQty ?? 0),
    maxQty: Number(lot.maxQty ?? marketLot.maxQty ?? Number.MAX_VALUE),
    minNotional: Number(minNotional.notional ?? minNotional.minNotional ?? 0),
    percentMultiplierUp: Number(percent.multiplierUp ?? 0),
    percentMultiplierDown: Number(percent.multiplierDown ?? 0),
  };
}

function floorToStep(value: number, step: number): number {
  if (!(step > 0)) return value;
  const units = Math.floor((value + Number.EPSILON) / step);
  return Number((units * step).toFixed(12));
}

export function normalizeOrderToRules(
  rules: SymbolRules,
  price: number,
  quantity: number,
  referencePrice?: number
): { price: number; quantity: number; notional: number } {
  if (rules.status !== 'TRADING') throw new Error('SYMBOL_NOT_TRADING');
  const p = floorToStep(price, rules.tickSize);
  const q = floorToStep(quantity, rules.stepSize);
  if (!(p > 0) || !(q > 0)) throw new Error('INVALID_NORMALIZED_ORDER');
  if (rules.minPrice > 0 && p < rules.minPrice) throw new Error('PRICE_BELOW_MIN');
  if (rules.maxPrice > 0 && p > rules.maxPrice) throw new Error('PRICE_ABOVE_MAX');
  if (
    referencePrice !== undefined &&
    referencePrice > 0 &&
    rules.percentMultiplierUp > 0 &&
    p > referencePrice * rules.percentMultiplierUp
  ) throw new Error('PRICE_ABOVE_PERCENT_BAND');
  if (
    referencePrice !== undefined &&
    referencePrice > 0 &&
    rules.percentMultiplierDown > 0 &&
    p < referencePrice * rules.percentMultiplierDown
  ) throw new Error('PRICE_BELOW_PERCENT_BAND');
  if (rules.minQty > 0 && q < rules.minQty) throw new Error('QTY_BELOW_MIN');
  if (rules.maxQty > 0 && q > rules.maxQty) throw new Error('QTY_ABOVE_MAX');
  const notional = p * q;
  if (rules.minNotional > 0 && notional < rules.minNotional) throw new Error('NOTIONAL_BELOW_MIN');
  return { price: p, quantity: q, notional };
}

export interface AccountContract {
  positionMode: 'ONE_WAY';
  marginType: 'ISOLATED';
  multiAssetsMode: false;
  symbolStatus: 'TRADING';
  leverage?: number;
}

export interface AccountContractResult {
  ok: boolean;
  reasons: string[];
  observed: Record<string, unknown>;
}

export class AccountContractVerifier {
  constructor(private adapter: BinanceUsdmAdapter) {}

  async verify(symbol: string, expectedLeverage?: number): Promise<AccountContractResult> {
    const reasons: string[] = [];
    const [mode, account, rawSymbolConfig, info] = await Promise.all([
      this.adapter.getPositionMode(),
      this.adapter.getAccountConfig(),
      this.adapter.getSymbolConfig(symbol),
      this.adapter.exchangeInfo(),
    ]);

    const symbolConfig = Array.isArray(rawSymbolConfig)
      ? rawSymbolConfig.find((x: any) => x.symbol === symbol)
      : rawSymbolConfig;
    const symbolInfo = info?.symbols?.find((x: any) => x.symbol === symbol);

    const marginType = String(symbolConfig?.marginType ?? '').toUpperCase();
    const leverage = Number(symbolConfig?.leverage);
    const multiAssets = Boolean(
      account?.multiAssetsMargin ?? account?.multiAssetsMode ?? false
    );
    const status = String(symbolInfo?.status ?? '');

    if (mode !== 'ONE_WAY') reasons.push('POSITION_MODE_NOT_ONE_WAY');
    if (marginType !== 'ISOLATED') reasons.push('MARGIN_NOT_ISOLATED');
    if (multiAssets) reasons.push('MULTI_ASSETS_MUST_BE_OFF');
    if (status !== 'TRADING') reasons.push('SYMBOL_NOT_TRADING');
    if (expectedLeverage !== undefined && leverage !== expectedLeverage) {
      reasons.push('LEVERAGE_MISMATCH');
    }

    return {
      ok: reasons.length === 0,
      reasons,
      observed: { mode, marginType, multiAssets, status, leverage },
    };
  }
}

export interface CanonicalOrderPackage {
  kind: 'ENTRY_IOC' | 'RISK_EXIT_IOC';
  symbol: 'QUSDT';
  side: 'BUY' | 'SELL';
  quantity: string;
  price: string;
  clientOrderId: string;
  reduceOnly: boolean;
  candleOpenTime: number;
  fencingGeneration: number;
}

export class CanonicalExecutionWriter {
  constructor(
    private adapter: BinanceUsdmAdapter,
    private journal: PgEventJournal,
    private leader: PgLeaderLock,
    private governor: RateLimitGovernor,
    private inFlight: InFlightRegistry
  ) {}

  async persistEntry(args: {
    deploymentId: string;
    candleOpenTime: number;
    action: 'LONG' | 'SHORT';
    quantity: string;
    price: string;
    systemMode: SystemMode;
  }): Promise<{ clientOrderId: string; outboxId: string }> {
    if (args.systemMode !== 'RUNNING') throw new Error('NEW_ENTRIES_HALTED');
    if (!this.governor.canWrite()) throw new Error('RATE_LIMIT_GOVERNOR_BLOCKED');
    const generation = this.leader.assertHeld();
    const clientOrderId = deterministicClientOrderId({
      deploymentId: args.deploymentId,
      symbol: 'QUSDT',
      candleOpenTime: args.candleOpenTime,
      action: args.action,
      generation,
    });
    const side = args.action === 'LONG' ? 'BUY' : 'SELL';
    const orderPackage: CanonicalOrderPackage = {
      kind: 'ENTRY_IOC',
      symbol: 'QUSDT',
      side,
      quantity: args.quantity,
      price: args.price,
      clientOrderId,
      reduceOnly: false,
      candleOpenTime: args.candleOpenTime,
      fencingGeneration: generation,
    };
    const outboxId = await this.journal.persistIntentAndOutbox(
      {
        intentId: clientOrderId,
        symbol: 'QUSDT',
        side,
        state: 'PERSISTED',
        payload: {
          deploymentId: args.deploymentId,
          candleOpenTime: args.candleOpenTime,
          fencingGeneration: generation,
        },
      },
      orderPackage as unknown as Record<string, unknown>
    );
    return { clientOrderId, outboxId };
  }

  async dispatchPending(limit = 1): Promise<number> {
    this.leader.assertHeld();
    if (!this.governor.canWrite()) return 0;
    const jobs = await this.journal.claimOutbox(limit);
    let sent = 0;
    for (const job of jobs) {
      const p = job.payload as unknown as CanonicalOrderPackage;
      if (p.fencingGeneration !== this.leader.assertHeld()) {
        await this.journal.appendEvent('FENCING_MISMATCH', job.intentId, {
          packageGeneration: p.fencingGeneration,
          currentGeneration: this.leader.assertHeld(),
        });
        throw new Error('FENCING_MISMATCH');
      }
      this.inFlight.markSent(p.clientOrderId);
      try {
        const response = await this.adapter.placeIocLimit({
          symbol: p.symbol,
          side: p.side,
          quantity: p.quantity,
          price: p.price,
          clientOrderId: p.clientOrderId,
          reduceOnly: p.reduceOnly,
        });
        await this.journal.appendEvent('ORDER_ACK', p.clientOrderId, { response });
        await this.journal.markOutboxDone(job.outboxId);
        this.inFlight.resolve(p.clientOrderId);
        sent += 1;
      } catch (error: any) {
        // UNKNOWN by design: keep outbox PROCESSING and in-flight identity until
        // exchange reconciliation resolves the actual state.
        await this.journal.appendEvent('ORDER_SUBMIT_UNKNOWN', p.clientOrderId, {
          message: String(error?.message ?? error),
        });
      }
    }
    return sent;
  }
}

export class ProtectionManager {
  constructor(
    private adapter: BinanceUsdmAdapter,
    private journal: PgEventJournal,
    private leader: PgLeaderLock
  ) {}

  async ensureCatastrophicStop(args: {
    symbol: string;
    positionSide: 'LONG' | 'SHORT';
    triggerPrice: string;
    positionIdentity: string;
  }): Promise<void> {
    const generation = this.leader.assertHeld();
    const clientAlgoId = deterministicClientOrderId({
      deploymentId: 'q-hard-stop',
      symbol: args.symbol,
      candleOpenTime: Array.from(args.positionIdentity).reduce(
        (acc, ch) => (acc * 131 + ch.charCodeAt(0)) % 9_000_000_000_000,
        0
      ),
      action: args.positionSide === 'LONG' ? 'STOP_SELL' : 'STOP_BUY',
      generation,
    });

    const side = args.positionSide === 'LONG' ? 'SELL' : 'BUY';
    try {
      const response = await this.adapter.placeCatastrophicStop({
        symbol: args.symbol,
        side,
        triggerPrice: args.triggerPrice,
        clientAlgoId,
      });
      await this.journal.appendEvent('PROTECTION_ACK', args.positionIdentity, {
        clientAlgoId,
        response,
      });
    } catch (error: any) {
      await this.journal.appendEvent('OPEN_UNPROTECTED', args.positionIdentity, {
        clientAlgoId,
        message: String(error?.message ?? error),
      });
      throw error;
    }
  }
}

export interface ReconcileSnapshot {
  openOrders: any[];
  openAlgoOrders: any[];
  positionRisk: any;
}

export interface ReconcileDiagnostics {
  foreignClientOrderIds: string[];
  foreignAlgoIds: string[];
  expectedPosition: number;
  exchangePosition: number;
  positionMismatch: boolean;
  unresolvedUnknown: boolean;
}

export class CanonicalReconciler {
  constructor(
    private adapter: BinanceUsdmAdapter,
    private journal: PgEventJournal,
    private inFlight: InFlightRegistry,
    private quiescenceMs = 800,
    private positionTolerance = 1e-9
  ) {}

  async reconcile(symbol: string): Promise<{ ok: boolean; halt: boolean; snapshot: ReconcileSnapshot; diagnostics: ReconcileDiagnostics }> {
    const remaining = this.inFlight.quiescenceRemainingMs(this.quiescenceMs);
    if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));

    // Resolve all PROCESSING outbox rows by deterministic clientOrderId before
    // concluding anything from account snapshots. PENDING rows were never sent.
    const unresolved = (await this.journal.unresolvedOutbox()).filter(
      x => String((x.payload as any)?.symbol ?? '') === symbol
    );
    let unresolvedUnknown = unresolved.some(x => x.status === 'PENDING');
    for (const row of unresolved.filter(x => x.status === 'PENDING')) {
      await this.journal.appendEvent('OUTBOX_PENDING_UNSENT', row.intentId, {
        symbol,
        outboxId: row.outboxId,
      });
    }
    for (const row of unresolved.filter(x => x.status === 'PROCESSING')) {
      const order = await this.adapter.getOrderByClientId(symbol, row.intentId);
      if (order) {
        await this.journal.markOutboxUnknownResolved(row.outboxId, String(order.status ?? 'FOUND'), { order });
        this.inFlight.resolve(row.intentId);
      } else {
        unresolvedUnknown = true;
        await this.journal.appendEvent('ORDER_STILL_UNKNOWN', row.intentId, {
          reason: 'NOT_FOUND_AFTER_QUIESCENCE',
        });
      }
    }

    const [openOrders, openAlgoOrders, positionRisk] = await Promise.all([
      this.adapter.getOpenOrders(symbol),
      this.adapter.getOpenAlgoOrders(symbol),
      this.adapter.getPositionRisk(symbol),
    ]);

    const knownOrders = new Set(await this.journal.knownIntentIds());
    const knownAlgo = new Set(await this.journal.knownProtectionIds());

    const foreignOrders = (Array.isArray(openOrders) ? openOrders : []).filter(
      (o: any) => o?.clientOrderId && !knownOrders.has(String(o.clientOrderId))
    );
    const foreignAlgo = (Array.isArray(openAlgoOrders) ? openAlgoOrders : []).filter((o: any) => {
      const id = String(o?.clientAlgoId ?? o?.algoId ?? '');
      return id && !knownAlgo.has(id);
    });

    const positionRow = Array.isArray(positionRisk)
      ? positionRisk.find((x: any) => x.symbol === symbol) ?? positionRisk[0] ?? {}
      : positionRisk ?? {};
    const exchangePosition = Number(positionRow.positionAmt ?? 0);
    const expectedPosition = await this.journal.expectedNetPosition(symbol);
    const positionMismatch =
      Number.isFinite(exchangePosition) &&
      Math.abs(exchangePosition - expectedPosition) > this.positionTolerance;

    const snapshot = { openOrders, openAlgoOrders, positionRisk };
    const diagnostics: ReconcileDiagnostics = {
      foreignClientOrderIds: foreignOrders.map((x: any) => String(x.clientOrderId)),
      foreignAlgoIds: foreignAlgo.map((x: any) => String(x.clientAlgoId ?? x.algoId)),
      expectedPosition,
      exchangePosition,
      positionMismatch,
      unresolvedUnknown,
    };
    await this.journal.recordPositionSnapshot(symbol, positionRisk);

    if (foreignOrders.length || foreignAlgo.length || positionMismatch || unresolvedUnknown) {
      await this.journal.appendEvent('RECONCILIATION_ERROR', symbol, diagnostics as unknown as Record<string, unknown>);
      return { ok: false, halt: true, snapshot, diagnostics };
    }

    await this.journal.appendEvent('RECONCILE_OK', symbol, {
      openOrders: Array.isArray(openOrders) ? openOrders.length : 0,
      openAlgoOrders: Array.isArray(openAlgoOrders) ? openAlgoOrders.length : 0,
      expectedPosition,
      exchangePosition,
    });
    return { ok: true, halt: false, snapshot, diagnostics };
  }
}

export type BinanceAccountReason =
  | 'ORDER'
  | 'FUNDING_FEE'
  | 'ADL'
  | 'LIQUIDATION'
  | 'MARGIN_EVENT'
  | 'UNKNOWN';

export class UserDataJournaler {
  constructor(private journal: PgEventJournal) {}

  async handle(event: any): Promise<BinanceAccountReason> {
    const reason = classifyUserDataEvent(event);
    const eventId = String(event?.o?.c ?? event?.E ?? Date.now());

    if (event?.e === 'ORDER_TRADE_UPDATE') {
      const lastQty = Number(event?.o?.l ?? 0);
      const lastPrice = Number(event?.o?.L ?? event?.o?.ap ?? event?.o?.p ?? 0);
      if (lastQty > 0 && lastPrice > 0) {
        const intentId = String(event?.o?.c ?? '');
        const expectedPrice = intentId
          ? await this.journal.expectedPriceForIntent(intentId)
          : null;
        const fillId = [
          String(event?.o?.s ?? ''),
          String(event?.o?.i ?? ''),
          String(event?.o?.t ?? event?.T ?? event?.E ?? ''),
        ].join('|');
        await this.journal.recordFill({
          fillId,
          intentId: intentId || null,
          symbol: String(event?.o?.s ?? ''),
          side: String(event?.o?.S ?? ''),
          expectedPrice,
          fillPrice: lastPrice,
          quantity: lastQty,
          commission: Number(event?.o?.n ?? 0),
          commissionAsset: event?.o?.N ? String(event.o.N) : null,
          eventTime: Number(event?.T ?? event?.E ?? Date.now()),
          payload: event,
        });
      }
    }

    await this.journal.appendEvent('BINANCE_' + reason, eventId, { event });
    return reason;
  }
}

export function classifyUserDataEvent(event: any): BinanceAccountReason {
  if (event?.e === 'ORDER_TRADE_UPDATE') {
    const executionType = String(event?.o?.x ?? '');
    const orderStatus = String(event?.o?.X ?? '');
    if (executionType === 'CALCULATED' || orderStatus === 'EXPIRED_IN_MATCH') return 'LIQUIDATION';
    return 'ORDER';
  }
  if (event?.e === 'ACCOUNT_UPDATE') {
    const reason = String(event?.a?.m ?? event?.m ?? '');
    if (reason === 'FUNDING_FEE') return 'FUNDING_FEE';
    if (reason === 'ADL') return 'ADL';
    if (reason === 'MARGIN_TRANSFER' || reason === 'MARGIN_TYPE_CHANGE') return 'MARGIN_EVENT';
    if (reason === 'ORDER') return 'ORDER';
    return 'UNKNOWN';
  }
  if (event?.e === 'MARGIN_CALL' || event?.e === 'forceOrder') return 'LIQUIDATION';
  return 'UNKNOWN';
}
