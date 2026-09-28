import fs from 'fs';
import path from 'path';
import {
  CandleBarrier,
  IntentArbiter,
  qCanonicalManifest,
  Range48Strategy,
  RateLimitGovernor,
} from './CanonicalLive';
import { BinanceUsdmAdapter } from './BinanceUsdmAdapter';

function firstNDepthNotional(levels: any[], n: number): number {
  return levels.slice(0, n).reduce((sum, row) => sum + Number(row[0]) * Number(row[1]), 0);
}

export interface QShadowReport {
  mode: 'SHADOW';
  generatedAt: string;
  manifest: ReturnType<typeof qCanonicalManifest>;
  dataBarrier: ReturnType<CandleBarrier['validate']>;
  signal: ReturnType<Range48Strategy['evaluate']>;
  intent: ReturnType<IntentArbiter['aggregate']>;
  symbolStatus: string;
  spreadBps: number;
  bidDepth5Notional: number;
  askDepth5Notional: number;
  closedBars: number;
  lastBarOpenTime: number;
  rateLimitState: string;
}

export class QShadowRuntime {
  constructor(private adapter: BinanceUsdmAdapter, private governor: RateLimitGovernor) {}

  async runOnce(nowOverride?: number): Promise<QShadowReport> {
    const serverTime = nowOverride ?? (await this.adapter.serverTime());
    const info = await this.adapter.exchangeInfo();
    const symbolInfo = info.symbols?.find((x: any) => x.symbol === 'QUSDT');
    if (!symbolInfo) throw new Error('QUSDT_NOT_IN_EXCHANGE_INFO');
    if (symbolInfo.status !== 'TRADING') throw new Error('QUSDT_NOT_TRADING');

    if (Array.isArray(info.rateLimits)) {
      const weight = info.rateLimits.find((x: any) => x.rateLimitType === 'REQUEST_WEIGHT' && x.interval === 'MINUTE');
      const orderMinute = info.rateLimits.find((x: any) => x.rateLimitType === 'ORDERS' && x.interval === 'MINUTE');
      const order10s = info.rateLimits.find((x: any) => x.rateLimitType === 'ORDERS' && x.interval === 'SECOND' && Number(x.intervalNum) === 10);
      if (weight?.limit && orderMinute?.limit && order10s?.limit) {
        this.governor.configureLimits({
          weight1m: Number(weight.limit),
          order10s: Number(order10s.limit),
          order1m: Number(orderMinute.limit),
        });
      }
    }

    const manifest = qCanonicalManifest('SHADOW');
    const historyStart = Date.parse(manifest.historyAnchor);
    const raw = await this.adapter.klinesRange('QUSDT', '15m', historyStart, serverTime, 1500);
    const closed = raw
      .filter(k => k.closeTime < serverTime)
      .map(k => ({ t: k.t, o: k.o, h: k.h, l: k.l, c: k.c, v: k.v }));

    const barrier = new CandleBarrier(15 * 60_000, 3_000, 64);
    const barrierResult = barrier.validate(closed, serverTime);
    if (!barrierResult.ok) {
      throw new Error('CANDLE_BARRIER_' + barrierResult.reason);
    }

    const strategy = new Range48Strategy();
    const signal = strategy.evaluate(closed);
    const intent = new IntentArbiter().aggregate([signal]);

    const book = await this.adapter.depth('QUSDT', 20);
    const bestBid = Number(book.bids?.[0]?.[0]);
    const bestAsk = Number(book.asks?.[0]?.[0]);
    if (!(bestBid > 0) || !(bestAsk > bestBid)) throw new Error('INVALID_ORDER_BOOK');
    const mid = (bestBid + bestAsk) / 2;
    const spreadBps = ((bestAsk - bestBid) / mid) * 10_000;

    return {
      mode: 'SHADOW',
      generatedAt: new Date(serverTime).toISOString(),
      manifest,
      dataBarrier: barrierResult,
      signal,
      intent,
      symbolStatus: symbolInfo.status,
      spreadBps,
      bidDepth5Notional: firstNDepthNotional(book.bids ?? [], 5),
      askDepth5Notional: firstNDepthNotional(book.asks ?? [], 5),
      closedBars: closed.length,
      lastBarOpenTime: closed.at(-1)!.t,
      rateLimitState: this.governor.state(),
    };
  }

  static writeReport(report: QShadowReport, outPath = 'artifacts/q-shadow-latest.json'): void {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  }
}
