import { describe, expect, it } from 'vitest';
import {
  Candle,
  CandleBarrier,
  deterministicClientOrderId,
  InFlightRegistry,
  IntentArbiter,
  PortfolioRiskEngine,
  qCanonicalManifest,
  Range48Strategy,
  RateLimitGovernor,
  StrategySignal,
} from '../../live/CanonicalLive';

function flatCandles(n = 80, start = 0, interval = 900_000, px = 100): Candle[] {
  return Array.from({ length: n }, (_, i) => ({
    t: start + i * interval,
    o: px,
    h: px + 1,
    l: px - 1,
    c: px,
    v: 100,
  }));
}

describe('Canonical Q live engine primitives', () => {
  it('Range48 emits LONG on a downside sweep/reclaim', () => {
    const c = flatCandles(80);
    const i = c.length - 1;
    c[i] = { ...c[i], l: 96, c: 99.5, h: 101, o: 99 };
    const s = new Range48Strategy().signals(c);
    expect(s[i]).toBe(1);
  });

  it('Range48 emits SHORT on an upside sweep/reclaim', () => {
    const c = flatCandles(80);
    const i = c.length - 1;
    c[i] = { ...c[i], h: 104, c: 100.5, l: 99, o: 101 };
    const s = new Range48Strategy().signals(c);
    expect(s[i]).toBe(-1);
  });

  it('Range48 is reversal stateful and marks fresh only on last-bar event', () => {
    const c = flatCandles(80);
    const i = c.length - 2;
    c[i] = { ...c[i], l: 96, c: 99.5, h: 101, o: 99 };
    const result = new Range48Strategy().evaluate(c);
    expect(result.direction).toBe(1);
    expect(result.fresh).toBe(false);
    expect(result.action).toBe('HOLD_LONG');
  });

  it('CandleBarrier accepts contiguous closed aligned bars', () => {
    const interval = 900_000;
    const grace = 3_000;
    const now = 80 * interval + grace + 1;
    const c = flatCandles(80, 0, interval);
    expect(new CandleBarrier(interval, grace, 64).validate(c, now).ok).toBe(true);
  });

  it('CandleBarrier rejects missing bars without fill-forward', () => {
    const interval = 900_000;
    const c = flatCandles(80, 0, interval);
    c.splice(30, 1);
    const r = new CandleBarrier(interval, 3_000, 64).validate(c, 80 * interval + 5_000);
    expect(r.reason).toBe('MISSING_BAR');
  });

  it('CandleBarrier rejects out-of-order bars', () => {
    const interval = 900_000;
    const c = flatCandles(80, 0, interval);
    [c[10], c[11]] = [c[11], c[10]];
    expect(new CandleBarrier(interval, 3_000, 64).validate(c, 80 * interval + 5_000).reason).toBe('OUT_OF_ORDER');
  });

  it('CandleBarrier rejects stale data', () => {
    const interval = 900_000;
    const c = flatCandles(80, 0, interval);
    const r = new CandleBarrier(interval, 3_000, 64).validate(c, 82 * interval + 5_000);
    expect(r.reason).toBe('STALE_DATA');
  });

  it('IntentArbiter merges same-direction signals with support_count', () => {
    const mk = (id: string): StrategySignal => ({
      strategyId: id,
      strategyVersion: 'v1',
      direction: 1,
      fresh: true,
      action: 'ENTER_LONG',
      barOpenTime: 1,
    });
    const r = new IntentArbiter().aggregate([mk('a'), mk('b')]);
    expect(r.decision).toBe('LONG');
    expect(r.supportCount).toBe(2);
  });

  it('IntentArbiter rejects opposite-direction conflict', () => {
    const a: StrategySignal = { strategyId:'a',strategyVersion:'v1',direction:1,fresh:true,action:'ENTER_LONG',barOpenTime:1 };
    const b: StrategySignal = { strategyId:'b',strategyVersion:'v1',direction:-1,fresh:true,action:'ENTER_SHORT',barOpenTime:1 };
    const r = new IntentArbiter().aggregate([a,b]);
    expect(r.decision).toBe('NO_TRADE');
    expect(r.reason).toBe('DIRECTION_CONFLICT');
  });

  it('deterministic clientOrderId is stable and <=36 chars', () => {
    const p={deploymentId:'q-usdt-15m-range48-v1',symbol:'QUSDT',candleOpenTime:123,action:'LONG',generation:7};
    const a=deterministicClientOrderId(p);
    const b=deterministicClientOrderId(p);
    expect(a).toBe(b);
    expect(a.length).toBeLessThanOrEqual(36);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('InFlightRegistry enforces quiescence window', () => {
    const r = new InFlightRegistry();
    r.markSent('x', 1000);
    expect(r.quiescenceRemainingMs(800, 1200)).toBe(600);
    r.resolve('x');
    expect(r.quiescenceRemainingMs(800, 1200)).toBe(0);
  });

  it('RateLimitGovernor soft-throttles at 80%', () => {
    const g=new RateLimitGovernor();
    g.configureLimits({weight1m:100,order10s:100,order1m:100});
    g.observeHeaders({'X-MBX-USED-WEIGHT-1M':'80','X-MBX-ORDER-COUNT-10S':'10','X-MBX-ORDER-COUNT-1M':'10'});
    expect(g.state()).toBe('SOFT_THROTTLE');
  });

  it('RateLimitGovernor blocks after 429', () => {
    const g=new RateLimitGovernor();
    g.noteHttpLimit(429, 2);
    expect(g.canWrite()).toBe(false);
  });

  it('PortfolioRiskEngine blocks daily loss', () => {
    const r=new PortfolioRiskEngine({
      maxSymbolNotionalPct:.05,maxPortfolioNotionalPct:.25,maxEffectiveLeverage:1,maxOpenPositions:1,
      maxDailyLossPct:.01,maxWeeklyLossPct:.03,maxDrawdownPct:.05
    });
    const d=r.evaluateEntry({equity:989,dayStartEquity:1000,weekStartEquity:1000,peakEquity:1000,portfolioNotional:0,symbolNotional:0,openPositions:0},10,'RUNNING');
    expect(d.allowed).toBe(false);
    expect(d.reasons).toContain('DAILY_LOSS_BREAKER');
  });

  it('PortfolioRiskEngine blocks second open position', () => {
    const r=new PortfolioRiskEngine({
      maxSymbolNotionalPct:.05,maxPortfolioNotionalPct:.25,maxEffectiveLeverage:1,maxOpenPositions:1,
      maxDailyLossPct:.01,maxWeeklyLossPct:.03,maxDrawdownPct:.05
    });
    const d=r.evaluateEntry({equity:1000,dayStartEquity:1000,weekStartEquity:1000,peakEquity:1000,portfolioNotional:10,symbolNotional:0,openPositions:1},10,'RUNNING');
    expect(d.reasons).toContain('MAX_OPEN_POSITIONS');
  });

  it('Risk-reducing exits are never blocked by HALT_NEW_ENTRIES', () => {
    const r=new PortfolioRiskEngine({
      maxSymbolNotionalPct:.05,maxPortfolioNotionalPct:.25,maxEffectiveLeverage:1,maxOpenPositions:1,
      maxDailyLossPct:.01,maxWeeklyLossPct:.03,maxDrawdownPct:.05
    });
    expect(r.evaluateRiskReducingExit().allowed).toBe(true);
  });

  it('Q deployment manifest is immutable-identifiable', () => {
    const m=qCanonicalManifest('SHADOW');
    expect(m.symbol).toBe('QUSDT');
    expect(m.timeframe).toBe('15m');
    expect(m.strategyId).toBe('swp_range48_reclaim');
    expect(m.strategyVersion).toBe('sweep-v1');
    expect(m.marginType).toBe('ISOLATED');
    expect(m.leverage).toBe(1);
    expect(m.strategyHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
