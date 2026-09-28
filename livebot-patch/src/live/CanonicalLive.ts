import { createHash } from 'crypto';

export type Direction = -1 | 0 | 1;
export type DeploymentMode = 'SHADOW' | 'CANARY' | 'LIVE' | 'HALTED';
export type SystemMode = 'RUNNING' | 'HALT_NEW_ENTRIES' | 'EXIT_ONLY' | 'EMERGENCY_FLATTEN' | 'FULL_STOP';

export interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface StrategySignal {
  strategyId: string;
  strategyVersion: string;
  direction: Direction;
  fresh: boolean;
  action: 'FLAT' | 'ENTER_LONG' | 'ENTER_SHORT' | 'HOLD_LONG' | 'HOLD_SHORT';
  barOpenTime: number | null;
}

export type QExecutionAction =
  | 'HOLD'
  | 'ENTER_LONG'
  | 'ENTER_SHORT'
  | 'REVERSE_TO_LONG'
  | 'REVERSE_TO_SHORT'
  | 'HALT_UNKNOWN_POSITION';

export function resolveRange48ExecutionAction(
  signal: StrategySignal,
  positionAmt: number | null | undefined,
  tolerance = 1e-12
): QExecutionAction {
  if (positionAmt === null || positionAmt === undefined || !Number.isFinite(positionAmt)) {
    return 'HALT_UNKNOWN_POSITION';
  }
  if (!signal.fresh || (signal.direction !== 1 && signal.direction !== -1)) return 'HOLD';

  const flat = Math.abs(positionAmt) <= tolerance;
  if (signal.direction === 1) {
    if (flat) return 'ENTER_LONG';
    if (positionAmt > tolerance) return 'HOLD';
    return 'REVERSE_TO_LONG';
  }

  if (flat) return 'ENTER_SHORT';
  if (positionAmt < -tolerance) return 'HOLD';
  return 'REVERSE_TO_SHORT';
}

export interface AggregatedIntent {
  decision: 'NO_TRADE' | 'LONG' | 'SHORT';
  supportCount: number;
  evidence: string[];
  reason: 'NO_FRESH_SIGNAL' | 'AGGREGATED' | 'DIRECTION_CONFLICT';
}

const finite = Number.isFinite;

function rma(xs: number[], p: number): number[] {
  const out = Array(xs.length).fill(Number.NaN);
  if (xs.length < p) return out;
  let s = 0;
  for (let i = 0; i < p; i++) s += xs[i];
  let q = s / p;
  out[p - 1] = q;
  for (let i = p; i < xs.length; i++) {
    q = (q * (p - 1) + xs[i]) / p;
    out[i] = q;
  }
  return out;
}

function trueRange(c: Candle[]): number[] {
  return c.map((b, i) =>
    i
      ? Math.max(b.h - b.l, Math.abs(b.h - c[i - 1].c), Math.abs(b.l - c[i - 1].c))
      : b.h - b.l
  );
}

function previousRange(c: Candle[], p: number): { hi: number[]; lo: number[] } {
  const hi = Array(c.length).fill(Number.NaN);
  const lo = Array(c.length).fill(Number.NaN);
  for (let i = p; i < c.length; i++) {
    let h = -Infinity;
    let l = Infinity;
    for (let j = i - p; j < i; j++) {
      h = Math.max(h, c[j].h);
      l = Math.min(l, c[j].l);
    }
    hi[i] = h;
    lo[i] = l;
  }
  return { hi, lo };
}

/**
 * Exact TypeScript port of TradingView-Research-Lab:
 * swp_range48_reclaim / sweep-v1.
 *
 * Semantics are REVERSAL:
 *   LONG  when low sweeps below prior-48 low by > 0.05 ATR and closes back above.
 *   SHORT when high sweeps above prior-48 high by > 0.05 ATR and closes back below.
 */
export class Range48Strategy {
  static readonly id = 'swp_range48_reclaim';
  static readonly version = 'sweep-v1';
  static readonly timeframe = '15m';
  static readonly mode = 'REVERSAL';

  public signals(candles: Candle[]): Direction[] {
    const { hi, lo } = previousRange(candles, 48);
    const atr = rma(trueRange(candles), 14);
    const sig: Direction[] = Array(candles.length).fill(0);

    for (let i = 1; i < candles.length; i++) {
      const a = atr[i];
      if (!finite(a) || a <= 0) continue;
      const h = hi[i];
      const l = lo[i];

      const longSignal =
        finite(l) &&
        candles[i].l < l - 0.05 * a &&
        candles[i].c > l;

      const shortSignal =
        finite(h) &&
        candles[i].h > h + 0.05 * a &&
        candles[i].c < h;

      if (longSignal) sig[i] = 1;
      else if (shortSignal) sig[i] = -1;
    }

    return sig;
  }

  public evaluate(candles: Candle[]): StrategySignal {
    if (!candles.length) {
      return {
        strategyId: Range48Strategy.id,
        strategyVersion: Range48Strategy.version,
        direction: 0,
        fresh: false,
        action: 'FLAT',
        barOpenTime: null,
      };
    }

    const raw = this.signals(candles);
    let state: Direction = 0;
    let lastSignalIndex = -1;
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] === 1 || raw[i] === -1) {
        state = raw[i];
        lastSignalIndex = i;
      }
    }

    const lastIndex = candles.length - 1;
    const fresh = lastSignalIndex === lastIndex;
    let action: StrategySignal['action'] = 'FLAT';
    if (state === 1) action = fresh ? 'ENTER_LONG' : 'HOLD_LONG';
    else if (state === -1) action = fresh ? 'ENTER_SHORT' : 'HOLD_SHORT';

    return {
      strategyId: Range48Strategy.id,
      strategyVersion: Range48Strategy.version,
      direction: state,
      fresh,
      action,
      barOpenTime: candles[lastIndex].t,
    };
  }

  public fingerprint(): string {
    const semantic =
      'swp_range48_reclaim|sweep-v1|REVERSAL|prevRange=48|atr=rma(tr,14)|threshold=0.05atr|closed-only';
    return createHash('sha256').update(semantic).digest('hex');
  }
}

export interface BarrierResult {
  ok: boolean;
  reason:
    | 'OK'
    | 'TOO_FEW_BARS'
    | 'MISALIGNED_BAR'
    | 'OUT_OF_ORDER'
    | 'MISSING_BAR'
    | 'OPEN_BAR'
    | 'STALE_DATA';
  expectedLastOpen: number | null;
  actualLastOpen: number | null;
}

export class CandleBarrier {
  constructor(
    public readonly intervalMs = 15 * 60_000,
    public readonly graceMs = 3_000,
    public readonly minBars = 64
  ) {}

  expectedLastClosedOpen(asOfMs: number): number {
    return Math.floor((asOfMs - this.graceMs) / this.intervalMs) * this.intervalMs - this.intervalMs;
  }

  validate(candles: Candle[], asOfMs = Date.now()): BarrierResult {
    if (candles.length < this.minBars) {
      return { ok: false, reason: 'TOO_FEW_BARS', expectedLastOpen: null, actualLastOpen: candles.at(-1)?.t ?? null };
    }

    for (let i = 0; i < candles.length; i++) {
      const b = candles[i];
      if (b.t % this.intervalMs !== 0) {
        return { ok: false, reason: 'MISALIGNED_BAR', expectedLastOpen: null, actualLastOpen: b.t };
      }
      if (b.t + this.intervalMs > asOfMs) {
        return { ok: false, reason: 'OPEN_BAR', expectedLastOpen: null, actualLastOpen: b.t };
      }
    }

    // Detect ordering before gap classification so a swapped pair is never
    // mislabeled as merely a missing bar.
    for (let i = 1; i < candles.length; i++) {
      if (candles[i].t <= candles[i - 1].t) {
        return { ok: false, reason: 'OUT_OF_ORDER', expectedLastOpen: null, actualLastOpen: candles[i].t };
      }
    }
    for (let i = 1; i < candles.length; i++) {
      if (candles[i].t - candles[i - 1].t !== this.intervalMs) {
        return { ok: false, reason: 'MISSING_BAR', expectedLastOpen: null, actualLastOpen: candles[i].t };
      }
    }

    const expected = this.expectedLastClosedOpen(asOfMs);
    const actual = candles[candles.length - 1].t;
    if (actual !== expected) {
      return { ok: false, reason: 'STALE_DATA', expectedLastOpen: expected, actualLastOpen: actual };
    }

    return { ok: true, reason: 'OK', expectedLastOpen: expected, actualLastOpen: actual };
  }
}

export class IntentArbiter {
  aggregate(signals: StrategySignal[]): AggregatedIntent {
    const fresh = signals.filter(s => s.fresh && (s.direction === 1 || s.direction === -1));
    if (!fresh.length) {
      return { decision: 'NO_TRADE', supportCount: 0, evidence: [], reason: 'NO_FRESH_SIGNAL' };
    }
    const dirs = new Set(fresh.map(s => s.direction));
    if (dirs.size > 1) {
      return {
        decision: 'NO_TRADE',
        supportCount: fresh.length,
        evidence: fresh.map(s => s.strategyId),
        reason: 'DIRECTION_CONFLICT',
      };
    }
    const dir = fresh[0].direction;
    return {
      decision: dir === 1 ? 'LONG' : 'SHORT',
      supportCount: fresh.length,
      evidence: fresh.map(s => s.strategyId),
      reason: 'AGGREGATED',
    };
  }
}

export function deterministicClientOrderId(parts: {
  deploymentId: string;
  symbol: string;
  candleOpenTime: number;
  action: string;
  generation: number;
}): string {
  const raw = [
    parts.deploymentId,
    parts.symbol,
    String(parts.candleOpenTime),
    parts.action,
    String(parts.generation),
  ].join('|');
  const digest = createHash('sha256').update(raw).digest('hex').slice(0, 24);
  return ('qb-' + digest).slice(0, 36);
}

export interface RateLimitLimits {
  weight1m: number;
  order10s: number;
  order1m: number;
}

export type RateLimitState = 'OK' | 'SOFT_THROTTLE' | 'STRONG_THROTTLE' | 'BLOCKED';

export class RateLimitGovernor {
  private limits: RateLimitLimits | null = null;
  private usage = { weight1m: 0, order10s: 0, order1m: 0 };
  private blockedUntil = 0;

  configureLimits(limits: RateLimitLimits): void {
    if (limits.weight1m <= 0 || limits.order10s <= 0 || limits.order1m <= 0) {
      throw new Error('Rate-limit values must be positive');
    }
    this.limits = limits;
  }

  observeHeaders(headers: Record<string, unknown>): void {
    const lower: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
    const n = (x: unknown): number => {
      const value = Number(Array.isArray(x) ? x[0] : x);
      return Number.isFinite(value) ? value : 0;
    };
    this.usage.weight1m = n(lower['x-mbx-used-weight-1m']);
    this.usage.order10s = n(lower['x-mbx-order-count-10s']);
    this.usage.order1m = n(lower['x-mbx-order-count-1m']);
  }

  noteHttpLimit(status: number, retryAfterSeconds = 1): void {
    if (status === 429 || status === 418) {
      const multiplier = status === 418 ? 5 : 1;
      this.blockedUntil = Math.max(
        this.blockedUntil,
        Date.now() + Math.max(1, retryAfterSeconds) * 1000 * multiplier
      );
    }
  }

  state(now = Date.now()): RateLimitState {
    if (now < this.blockedUntil) return 'BLOCKED';
    if (!this.limits) return 'OK';
    const ratios = [
      this.usage.weight1m / this.limits.weight1m,
      this.usage.order10s / this.limits.order10s,
      this.usage.order1m / this.limits.order1m,
    ];
    const max = Math.max(...ratios);
    if (max >= 1) return 'BLOCKED';
    if (max >= 0.9) return 'STRONG_THROTTLE';
    if (max >= 0.8) return 'SOFT_THROTTLE';
    return 'OK';
  }

  canWrite(now = Date.now()): boolean {
    return this.state(now) !== 'BLOCKED';
  }
}

export class InFlightRegistry {
  private pending = new Map<string, number>();

  markSent(clientOrderId: string, sentAt = Date.now()): void {
    this.pending.set(clientOrderId, sentAt);
  }

  resolve(clientOrderId: string): void {
    this.pending.delete(clientOrderId);
  }

  pendingIds(): string[] {
    return [...this.pending.keys()].sort();
  }

  quiescenceRemainingMs(windowMs: number, now = Date.now()): number {
    if (!this.pending.size) return 0;
    const newest = Math.max(...this.pending.values());
    return Math.max(0, newest + windowMs - now);
  }
}

export interface PortfolioRiskConfig {
  maxSymbolNotionalPct: number;
  maxPortfolioNotionalPct: number;
  maxEffectiveLeverage: number;
  maxOpenPositions: number;
  maxDailyLossPct: number;
  maxWeeklyLossPct: number;
  maxDrawdownPct: number;
}

export interface PortfolioSnapshot {
  equity: number;
  dayStartEquity: number;
  weekStartEquity: number;
  peakEquity: number;
  portfolioNotional: number;
  symbolNotional: number;
  openPositions: number;
}

export interface RiskDecision {
  allowed: boolean;
  reasons: string[];
}

export class PortfolioRiskEngine {
  constructor(public readonly config: PortfolioRiskConfig) {}

  evaluateEntry(snapshot: PortfolioSnapshot, requestedNotional: number, mode: SystemMode): RiskDecision {
    const reasons: string[] = [];
    if (mode !== 'RUNNING') reasons.push('SYSTEM_NOT_RUNNING');
    if (!(snapshot.equity > 0)) reasons.push('INVALID_EQUITY');
    if (!(requestedNotional > 0)) reasons.push('INVALID_NOTIONAL');

    const equity = Math.max(snapshot.equity, 1e-9);
    if (snapshot.symbolNotional + requestedNotional > equity * this.config.maxSymbolNotionalPct) {
      reasons.push('SYMBOL_NOTIONAL_LIMIT');
    }
    if (snapshot.portfolioNotional + requestedNotional > equity * this.config.maxPortfolioNotionalPct) {
      reasons.push('PORTFOLIO_NOTIONAL_LIMIT');
    }
    if ((snapshot.portfolioNotional + requestedNotional) / equity > this.config.maxEffectiveLeverage) {
      reasons.push('EFFECTIVE_LEVERAGE_LIMIT');
    }
    if (snapshot.openPositions >= this.config.maxOpenPositions) reasons.push('MAX_OPEN_POSITIONS');

    if (snapshot.equity <= snapshot.dayStartEquity * (1 - this.config.maxDailyLossPct)) {
      reasons.push('DAILY_LOSS_BREAKER');
    }
    if (snapshot.equity <= snapshot.weekStartEquity * (1 - this.config.maxWeeklyLossPct)) {
      reasons.push('WEEKLY_LOSS_BREAKER');
    }
    if (snapshot.equity <= snapshot.peakEquity * (1 - this.config.maxDrawdownPct)) {
      reasons.push('DRAWDOWN_BREAKER');
    }
    return { allowed: reasons.length === 0, reasons };
  }

  evaluateRiskReducingExit(): RiskDecision {
    return { allowed: true, reasons: [] };
  }
}

export interface DeploymentManifest {
  deploymentId: string;
  exchange: 'BINANCE_USDM';
  symbol: 'QUSDT';
  timeframe: '15m';
  strategyId: 'swp_range48_reclaim';
  strategyVersion: 'sweep-v1';
  closedOnly: true;
  mode: DeploymentMode;
  strategyHash: string;
  historyAnchor: '2025-12-29T00:00:00Z';
}

export function qCanonicalManifest(mode: DeploymentMode = 'SHADOW'): DeploymentManifest {
  const strategyHash = new Range48Strategy().fingerprint();
  return {
    deploymentId: 'q-usdt-15m-range48-v1',
    exchange: 'BINANCE_USDM',
    symbol: 'QUSDT',
    timeframe: '15m',
    strategyId: 'swp_range48_reclaim',
    strategyVersion: 'sweep-v1',
    closedOnly: true,
    mode,
    strategyHash,
    historyAnchor: '2025-12-29T00:00:00Z',
  };
}
