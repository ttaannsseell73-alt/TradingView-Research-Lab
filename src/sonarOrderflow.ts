import { replay } from './replay.js';
import type { Candle, CanonicalFeatureVector, Direction, FeatureRow, GateStatus, StudyWindow } from './types.js';

export interface SonarOrderflowRow {
  timestamp: number;
  buyVol: number;
  sellVol: number;
  buySellRatio: number;
  openInterest: number;
  openInterestValue: number;
}

export interface SonarOrderflowConfig {
  minTriggerScore: number;
  minTakerScore: number;
  minRelativeVolume: number;
  maxOpposingContext: number;
  cooldownBars: number;
}

export interface SonarOrderflowEvent {
  index: number;
  timestamp: number;
  direction: Direction;
  triggerScore: number;
  takerScore: number;
  oiDelta: number;
  contextScore: number;
  orderflowTimestamp: number;
  strength: number;
}

export interface SonarOrderflowOutcome extends SonarOrderflowEvent {
  entryIndex: number;
  exitIndex: number;
  entryPrice: number;
  exitPrice: number;
  grossReturn: number;
  netReturn: number;
  mae: number;
  mfe: number;
}

export interface SonarOrderflowStats {
  sampleCount: number;
  hitRate: number;
  grossExpectancy: number;
  expectancy: number;
  averageWin: number;
  averageLoss: number;
  averageMae: number;
  averageMfe: number;
}

export interface SonarOrderflowRun {
  horizonBars: number;
  costScenario: string;
  train: SonarOrderflowStats;
  validation: SonarOrderflowStats;
  holdout: SonarOrderflowStats;
  status: GateStatus;
  reasons: string[];
}

export interface SonarOrderflowReport {
  oneMinuteCount: number;
  fiveMinuteCount: number;
  orderflowCount: number;
  overlapOneMinuteCount: number;
  eventCount: number;
  config: SonarOrderflowConfig;
  runs: SonarOrderflowRun[];
  decision: {
    status: GateStatus;
    passedRuns: number;
    totalRuns: number;
    reasons: string[];
  };
  replay: {
    oneMinute: string;
    fiveMinute: string;
  };
}

const DEFAULT_CONFIG: SonarOrderflowConfig = {
  minTriggerScore: 0.20,
  minTakerScore: 0.12,
  minRelativeVolume: 0.90,
  maxOpposingContext: 0.25,
  cooldownBars: 2,
};

const COSTS = [
  { name: 'base', feeRate: 0.0004, slippageRate: 0.0001 },
  { name: 'stress', feeRate: 0.0005, slippageRate: 0.0003 },
] as const;

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function contextScore(features: CanonicalFeatureVector): number {
  return clamp(
    features.ExternalStructure * 0.5 +
    features.InternalStructure * 0.3 +
    features.TrendRangeScore * 0.2,
    -1,
    1,
  );
}

function triggerScore(features: CanonicalFeatureVector): number {
  const candidates: number[] = [];
  if (features.RetestQuality !== 0) candidates.push(features.RetestQuality);
  if (features.CHOCHStrength !== 0) candidates.push(features.CHOCHStrength);
  if (features.BOSStrength !== 0) candidates.push(features.BOSStrength);
  if (
    features.SweepDepth !== 0 &&
    features.ReclaimQuality !== 0 &&
    Math.sign(features.SweepDepth) === Math.sign(features.ReclaimQuality)
  ) {
    candidates.push(
      Math.sign(features.ReclaimQuality) *
      ((Math.abs(features.ReclaimQuality) * 0.65) + (Math.abs(features.SweepDepth) * 0.35)),
    );
  }
  if (!candidates.length) return 0;
  return candidates.sort((a, b) => Math.abs(b) - Math.abs(a))[0] ?? 0;
}

function takerScore(row: SonarOrderflowRow): number {
  const total = row.buyVol + row.sellVol;
  return total > 0 ? (row.buyVol - row.sellVol) / total : 0;
}

function inferIntervalMs(candles: Candle[]): number {
  if (candles.length < 2) throw new Error('At least two candles are required');
  const diffs: number[] = [];
  for (let i = 1; i < candles.length; i += 1) {
    const current = candles[i];
    const previous = candles[i - 1];
    if (!current || !previous) continue;
    const diff = current.timestamp - previous.timestamp;
    if (diff > 0) diffs.push(diff);
  }
  if (!diffs.length) throw new Error('Unable to infer interval');
  const counts = new Map<number, number>();
  for (const diff of diffs) counts.set(diff, (counts.get(diff) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? diffs[0]!;
}

function latestClosedFiveMinuteIndex(
  triggerOpenTimestamp: number,
  oneMinuteInterval: number,
  fiveMinuteCandles: Candle[],
  fiveMinuteInterval: number,
): number {
  const triggerClose = triggerOpenTimestamp + oneMinuteInterval;
  let low = 0;
  let high = fiveMinuteCandles.length - 1;
  let answer = -1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candle = fiveMinuteCandles[mid];
    if (!candle) break;
    if ((candle.timestamp + fiveMinuteInterval) <= triggerClose) {
      answer = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return answer;
}

export function parseSonarOrderflowCsv(text: string): SonarOrderflowRow[] {
  const lines = text.trim().split(/\r?\n/);
  if (!lines.length) return [];
  const header = lines[0]?.split(',') ?? [];
  const required = ['timestamp','buyVol','sellVol','buySellRatio','openInterest','openInterestValue'];
  for (const name of required) if (!header.includes(name)) throw new Error(`Missing orderflow column: ${name}`);
  const idx = Object.fromEntries(header.map((name, i) => [name, i]));
  const rows = lines.slice(1).filter(Boolean).map((line) => {
    const parts = line.split(',');
    const row: SonarOrderflowRow = {
      timestamp: Number(parts[idx.timestamp]),
      buyVol: Number(parts[idx.buyVol]),
      sellVol: Number(parts[idx.sellVol]),
      buySellRatio: Number(parts[idx.buySellRatio]),
      openInterest: Number(parts[idx.openInterest]),
      openInterestValue: Number(parts[idx.openInterestValue]),
    };
    if (Object.values(row).some((value) => !Number.isFinite(value))) throw new Error('Invalid orderflow row');
    return row;
  });
  rows.sort((a, b) => a.timestamp - b.timestamp);
  return rows;
}

export function detectSonarOrderflowEventsFromRows(
  oneMinuteCandles: Candle[],
  oneMinuteRows: FeatureRow[],
  fiveMinuteCandles: Candle[],
  fiveMinuteRows: FeatureRow[],
  orderflow: SonarOrderflowRow[],
  config: Partial<SonarOrderflowConfig> = {},
): SonarOrderflowEvent[] {
  if (oneMinuteCandles.length !== oneMinuteRows.length) throw new Error('1m length mismatch');
  if (fiveMinuteCandles.length !== fiveMinuteRows.length) throw new Error('5m length mismatch');
  const settings = { ...DEFAULT_CONFIG, ...config };
  const oneInterval = inferIntervalMs(oneMinuteCandles);
  const fiveInterval = inferIntervalMs(fiveMinuteCandles);
  const orderflowByTimestamp = new Map(orderflow.map((row) => [row.timestamp, row]));
  const previousOi = new Map<number, number>();
  for (let i = 1; i < orderflow.length; i += 1) {
    const current = orderflow[i];
    const previous = orderflow[i - 1];
    if (!current || !previous || previous.openInterest <= 0) continue;
    previousOi.set(current.timestamp, (current.openInterest - previous.openInterest) / previous.openInterest);
  }

  const events: SonarOrderflowEvent[] = [];
  let lastEvent = -Infinity;

  for (let i = 0; i < oneMinuteCandles.length; i += 1) {
    if (i - lastEvent <= settings.cooldownBars) continue;
    const candle = oneMinuteCandles[i];
    const row = oneMinuteRows[i];
    if (!candle || !row) continue;

    const fiveIndex = latestClosedFiveMinuteIndex(candle.timestamp, oneInterval, fiveMinuteCandles, fiveInterval);
    if (fiveIndex < 0) continue;
    const fiveCandle = fiveMinuteCandles[fiveIndex];
    const fiveRow = fiveMinuteRows[fiveIndex];
    if (!fiveCandle || !fiveRow) continue;

    const of = orderflowByTimestamp.get(fiveCandle.timestamp);
    if (!of) continue;
    const oiDelta = previousOi.get(of.timestamp);
    if (oiDelta === undefined || oiDelta <= 0) continue;

    const trigger = triggerScore(row.features);
    if (trigger === 0 || Math.abs(trigger) < settings.minTriggerScore) continue;
    const direction = (trigger > 0 ? 1 : -1) as Direction;
    const flow = takerScore(of);
    if ((flow * direction) < settings.minTakerScore) continue;
    if (row.features.RelativeVolume < settings.minRelativeVolume) continue;

    const ctx = contextScore(fiveRow.features);
    if ((ctx * direction) < -settings.maxOpposingContext) continue;

    events.push({
      index: i,
      timestamp: candle.timestamp,
      direction,
      triggerScore: trigger,
      takerScore: flow,
      oiDelta,
      contextScore: ctx,
      orderflowTimestamp: of.timestamp,
      strength: clamp(
        Math.abs(trigger) *
        (1 + Math.abs(flow)) *
        (1 + Math.min(0.02, oiDelta) * 25) *
        clamp(row.features.RelativeVolume, 0.5, 2),
        0,
        8,
      ),
    });
    lastEvent = i;
  }

  return events;
}

function signedReturn(entry: number, price: number, direction: Direction): number {
  return direction * (price - entry) / entry;
}

export function evaluateSonarOrderflowEvents(
  candles: Candle[],
  events: SonarOrderflowEvent[],
  config: { horizonBars?: number; feeRate?: number; slippageRate?: number } = {},
  window?: StudyWindow,
): SonarOrderflowOutcome[] {
  const horizonBars = config.horizonBars ?? 3;
  const feeRate = config.feeRate ?? 0.0004;
  const slippageRate = config.slippageRate ?? 0.0001;
  const cost = 2 * (feeRate + slippageRate);
  const start = window?.startIndex ?? 0;
  const end = window?.endIndexExclusive ?? candles.length;
  const outcomes: SonarOrderflowOutcome[] = [];

  for (const event of events) {
    const entryIndex = event.index + 1;
    const exitIndex = entryIndex + horizonBars - 1;
    if (event.index < start || entryIndex < start || exitIndex >= end || exitIndex >= candles.length) continue;
    const entry = candles[entryIndex];
    const exit = candles[exitIndex];
    if (!entry || !exit || entry.open <= 0) continue;
    const path = candles.slice(entryIndex, exitIndex + 1);
    const pathReturns = path.flatMap((bar) => [
      signedReturn(entry.open, bar.high, event.direction),
      signedReturn(entry.open, bar.low, event.direction),
    ]);
    const grossReturn = signedReturn(entry.open, exit.close, event.direction);
    outcomes.push({
      ...event,
      entryIndex,
      exitIndex,
      entryPrice: entry.open,
      exitPrice: exit.close,
      grossReturn,
      netReturn: grossReturn - cost,
      mae: pathReturns.length ? Math.min(...pathReturns) : 0,
      mfe: pathReturns.length ? Math.max(...pathReturns) : 0,
    });
  }
  return outcomes;
}

export function summarizeSonarOrderflowOutcomes(outcomes: SonarOrderflowOutcome[]): SonarOrderflowStats {
  const wins = outcomes.filter((x) => x.netReturn > 0).map((x) => x.netReturn);
  const losses = outcomes.filter((x) => x.netReturn <= 0).map((x) => x.netReturn);
  return {
    sampleCount: outcomes.length,
    hitRate: outcomes.length ? wins.length / outcomes.length : 0,
    grossExpectancy: mean(outcomes.map((x) => x.grossReturn)),
    expectancy: mean(outcomes.map((x) => x.netReturn)),
    averageWin: mean(wins),
    averageLoss: mean(losses),
    averageMae: mean(outcomes.map((x) => x.mae)),
    averageMfe: mean(outcomes.map((x) => x.mfe)),
  };
}

function makeWindows(length: number): { train: StudyWindow; validation: StudyWindow; holdout: StudyWindow } {
  if (length < 30) throw new Error('At least 30 candles are required');
  const trainEnd = Math.floor(length * 0.6);
  const validationEnd = Math.floor(length * 0.8);
  return {
    train: { startIndex: 0, endIndexExclusive: trainEnd },
    validation: { startIndex: trainEnd, endIndexExclusive: validationEnd },
    holdout: { startIndex: validationEnd, endIndexExclusive: length },
  };
}

export function runSonarOrderflowRobustness(
  oneMinuteCandles: Candle[],
  fiveMinuteCandles: Candle[],
  orderflow: SonarOrderflowRow[],
  options: {
    signalConfig?: Partial<SonarOrderflowConfig>;
    horizons?: number[];
    minimumSamplesPerWindow?: number;
  } = {},
): SonarOrderflowReport {
  const config = { ...DEFAULT_CONFIG, ...(options.signalConfig ?? {}) };
  const horizons = options.horizons ?? [2, 3, 5, 8];
  const minimumSamples = options.minimumSamplesPerWindow ?? 30;

  const earliest = Math.max(
    oneMinuteCandles[0]?.timestamp ?? 0,
    orderflow[1]?.timestamp ?? 0,
  );
  const latest = Math.min(
    oneMinuteCandles.at(-1)?.timestamp ?? 0,
    (orderflow.at(-1)?.timestamp ?? 0) + 5 * 60_000,
  );
  const startIndex = oneMinuteCandles.findIndex((candle) => candle.timestamp >= earliest);
  if (startIndex < 0) throw new Error('No 1m/orderflow overlap');
  const endIndex = oneMinuteCandles.findIndex((candle) => candle.timestamp > latest);
  const slicedOne = oneMinuteCandles.slice(startIndex, endIndex < 0 ? undefined : endIndex);
  if (slicedOne.length < 1000) throw new Error('Insufficient 1m/orderflow overlap');

  const oneReplay = replay(slicedOne);
  const fiveReplay = replay(fiveMinuteCandles);
  const events = detectSonarOrderflowEventsFromRows(
    slicedOne,
    oneReplay.rows,
    fiveMinuteCandles,
    fiveReplay.rows,
    orderflow,
    config,
  );
  const windows = makeWindows(slicedOne.length);
  const runs: SonarOrderflowRun[] = [];

  for (const horizonBars of horizons) {
    for (const cost of COSTS) {
      const study = { horizonBars, feeRate: cost.feeRate, slippageRate: cost.slippageRate };
      const train = summarizeSonarOrderflowOutcomes(evaluateSonarOrderflowEvents(slicedOne, events, study, windows.train));
      const validation = summarizeSonarOrderflowOutcomes(evaluateSonarOrderflowEvents(slicedOne, events, study, windows.validation));
      const holdout = summarizeSonarOrderflowOutcomes(evaluateSonarOrderflowEvents(slicedOne, events, study, windows.holdout));
      const reasons: string[] = [];
      let status: GateStatus = 'PASS';
      if (validation.sampleCount < minimumSamples || holdout.sampleCount < minimumSamples) {
        status = 'INSUFFICIENT_DATA';
        reasons.push('minimum sample count not met in validation and holdout');
      } else {
        if (validation.expectancy <= 0) reasons.push('validation net expectancy did not clear zero');
        if (holdout.expectancy <= 0) reasons.push('holdout net expectancy did not clear zero');
        if (reasons.length) status = 'REJECT';
      }
      runs.push({
        horizonBars,
        costScenario: cost.name,
        train,
        validation,
        holdout,
        status,
        reasons,
      });
    }
  }

  const statuses = runs.map((run) => run.status);
  const passedRuns = statuses.filter((status) => status === 'PASS').length;
  const reasons: string[] = [];
  let status: GateStatus = 'PASS';
  if (statuses.some((x) => x === 'INSUFFICIENT_DATA')) {
    status = 'INSUFFICIENT_DATA';
    reasons.push('at least one robustness run lacks minimum samples');
  } else if (statuses.some((x) => x === 'REJECT') || passedRuns !== runs.length) {
    status = 'REJECT';
    reasons.push('orderflow-confirmed scalp failed at least one robustness run');
  }

  return {
    oneMinuteCount: oneMinuteCandles.length,
    fiveMinuteCount: fiveMinuteCandles.length,
    orderflowCount: orderflow.length,
    overlapOneMinuteCount: slicedOne.length,
    eventCount: events.length,
    config,
    runs,
    decision: { status, passedRuns, totalRuns: runs.length, reasons },
    replay: { oneMinute: oneReplay.signature, fiveMinute: fiveReplay.signature },
  };
}
