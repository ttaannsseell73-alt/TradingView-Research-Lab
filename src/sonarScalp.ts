import { replay } from './replay.js';
import type { Candle, CanonicalFeatureVector, Direction, FeatureRow, GateStatus, StudyWindow } from './types.js';

export type SonarTriggerKind = 'sweep_reclaim' | 'retest' | 'structure_shift';

export interface SonarScalpConfig {
  contextThreshold: number;
  triggerThreshold: number;
  minRelativeVolume: number;
  cooldownBars: number;
}

export interface SonarScalpEvent {
  index: number;
  timestamp: number;
  direction: Direction;
  strength: number;
  contextTimestamp: number;
  contextScore: number;
  triggerScore: number;
  triggerKind: SonarTriggerKind;
}

export interface SonarScalpStudyConfig {
  horizonBars: number;
  feeRate: number;
  slippageRate: number;
}

export interface SonarScalpOutcome extends SonarScalpEvent {
  entryIndex: number;
  exitIndex: number;
  entryPrice: number;
  exitPrice: number;
  grossReturn: number;
  netReturn: number;
  mae: number;
  mfe: number;
}

export interface SonarScalpStats {
  sampleCount: number;
  hitRate: number;
  grossExpectancy: number;
  expectancy: number;
  breakEvenRoundTripCost: number;
  averageWin: number;
  averageLoss: number;
  averageMae: number;
  averageMfe: number;
}

export interface SonarScalpRun {
  horizonBars: number;
  costScenario: string;
  feeRate: number;
  slippageRate: number;
  train: SonarScalpStats;
  validation: SonarScalpStats;
  holdout: SonarScalpStats;
  status: GateStatus;
  reasons: string[];
}

export interface SonarScalpRobustnessReport {
  oneMinuteCount: number;
  fiveMinuteCount: number;
  eventCount: number;
  oneMinuteReplaySignature: string;
  fiveMinuteReplaySignature: string;
  config: SonarScalpConfig;
  runs: SonarScalpRun[];
  decision: {
    status: GateStatus;
    passedRuns: number;
    totalRuns: number;
    reasons: string[];
  };
}

const DEFAULT_SIGNAL_CONFIG: SonarScalpConfig = {
  contextThreshold: 0.25,
  triggerThreshold: 0.20,
  minRelativeVolume: 0.90,
  cooldownBars: 2,
};

const DEFAULT_COSTS = [
  { name: 'base', feeRate: 0.0004, slippageRate: 0.0001 },
  { name: 'stress', feeRate: 0.0005, slippageRate: 0.0003 },
] as const;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function signedReturn(entry: number, price: number, direction: Direction): number {
  return direction * (price - entry) / entry;
}

function inferIntervalMs(candles: Candle[]): number {
  if (candles.length < 2) throw new Error('At least two candles are required to infer interval');
  const diffs: number[] = [];
  for (let i = 1; i < candles.length; i += 1) {
    const current = candles[i];
    const previous = candles[i - 1];
    if (!current || !previous) continue;
    const diff = current.timestamp - previous.timestamp;
    if (diff > 0) diffs.push(diff);
  }
  if (!diffs.length) throw new Error('Unable to infer candle interval');
  const counts = new Map<number, number>();
  for (const diff of diffs) counts.set(diff, (counts.get(diff) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? diffs[0]!;
}

export function latestClosedContextIndex(
  triggerOpenTimestamp: number,
  triggerIntervalMs: number,
  contextCandles: Candle[],
  contextIntervalMs: number,
): number {
  const triggerClose = triggerOpenTimestamp + triggerIntervalMs;
  let low = 0;
  let high = contextCandles.length - 1;
  let answer = -1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candle = contextCandles[mid];
    if (!candle) break;
    const contextClose = candle.timestamp + contextIntervalMs;
    if (contextClose <= triggerClose) {
      answer = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return answer;
}

function contextScore(features: CanonicalFeatureVector): number {
  return clamp(
    (features.ExternalStructure * 0.50) +
      (features.InternalStructure * 0.30) +
      (features.TrendRangeScore * 0.20),
    -1,
    1,
  );
}

function triggerCandidate(
  features: CanonicalFeatureVector,
): { score: number; kind: SonarTriggerKind } {
  const candidates: Array<{ score: number; kind: SonarTriggerKind }> = [];

  if (
    features.SweepDepth !== 0 &&
    features.ReclaimQuality !== 0 &&
    Math.sign(features.SweepDepth) === Math.sign(features.ReclaimQuality)
  ) {
    const direction = Math.sign(features.ReclaimQuality);
    const followThrough = Math.max(0, direction * features.PostSweepDisplacement);
    const magnitude =
      (Math.abs(features.ReclaimQuality) * 0.55) +
      (Math.abs(features.SweepDepth) * 0.30) +
      (followThrough * 0.15);
    candidates.push({ score: direction * magnitude, kind: 'sweep_reclaim' });
  }

  if (features.RetestQuality !== 0) {
    candidates.push({ score: features.RetestQuality, kind: 'retest' });
  }

  const choch = features.CHOCHStrength;
  const bos = features.BOSStrength;
  if (choch !== 0 || bos !== 0) {
    const selected = Math.abs(choch) >= Math.abs(bos) ? choch : bos;
    const companion = selected === choch ? bos : choch;
    const magnitude = (Math.abs(selected) * 0.75) + (Math.abs(companion) * 0.25);
    candidates.push({ score: Math.sign(selected) * magnitude, kind: 'structure_shift' });
  }

  if (!candidates.length) return { score: 0, kind: 'structure_shift' };
  return candidates.sort((a, b) => Math.abs(b.score) - Math.abs(a.score))[0]!;
}

export function detectSonarScalpEventsFromRows(
  oneMinuteCandles: Candle[],
  oneMinuteRows: FeatureRow[],
  fiveMinuteCandles: Candle[],
  fiveMinuteRows: FeatureRow[],
  config: Partial<SonarScalpConfig> = {},
): SonarScalpEvent[] {
  if (oneMinuteCandles.length !== oneMinuteRows.length) throw new Error('1m candle/feature length mismatch');
  if (fiveMinuteCandles.length !== fiveMinuteRows.length) throw new Error('5m candle/feature length mismatch');
  const settings = { ...DEFAULT_SIGNAL_CONFIG, ...config };
  if (settings.contextThreshold < 0 || settings.contextThreshold > 1) throw new Error('contextThreshold must be 0..1');
  if (settings.triggerThreshold < 0) throw new Error('triggerThreshold must be non-negative');
  if (settings.minRelativeVolume < 0) throw new Error('minRelativeVolume must be non-negative');
  if (!Number.isInteger(settings.cooldownBars) || settings.cooldownBars < 0) throw new Error('cooldownBars must be >= 0');

  const oneInterval = inferIntervalMs(oneMinuteCandles);
  const fiveInterval = inferIntervalMs(fiveMinuteCandles);
  const events: SonarScalpEvent[] = [];
  let lastEventIndex = -Infinity;

  for (let i = 0; i < oneMinuteCandles.length; i += 1) {
    const candle = oneMinuteCandles[i];
    const triggerRow = oneMinuteRows[i];
    if (!candle || !triggerRow) continue;
    if (i - lastEventIndex <= settings.cooldownBars) continue;

    const contextIndex = latestClosedContextIndex(candle.timestamp, oneInterval, fiveMinuteCandles, fiveInterval);
    if (contextIndex < 0) continue;
    const contextCandle = fiveMinuteCandles[contextIndex];
    const contextRow = fiveMinuteRows[contextIndex];
    if (!contextCandle || !contextRow) continue;

    const ctxScore = contextScore(contextRow.features);
    const trigger = triggerCandidate(triggerRow.features);
    if (trigger.score === 0) continue;

    const direction: Direction = trigger.score > 0 ? 1 : -1;
    if ((ctxScore * direction) < settings.contextThreshold) continue;
    if (Math.abs(trigger.score) < settings.triggerThreshold) continue;
    if (triggerRow.features.RelativeVolume < settings.minRelativeVolume) continue;
    if ((contextRow.features.BreakoutDisplacement * direction) < 0) continue;

    const strength = clamp(
      Math.abs(trigger.score) *
        (1 + Math.abs(ctxScore)) *
        clamp(triggerRow.features.RelativeVolume, 0.5, 2),
      0,
      6,
    );

    events.push({
      index: i,
      timestamp: candle.timestamp,
      direction,
      strength,
      contextTimestamp: contextCandle.timestamp,
      contextScore: ctxScore,
      triggerScore: trigger.score,
      triggerKind: trigger.kind,
    });
    lastEventIndex = i;
  }

  return events;
}

export function detectSonarScalpEvents(
  oneMinuteCandles: Candle[],
  fiveMinuteCandles: Candle[],
  config: Partial<SonarScalpConfig> = {},
): {
  events: SonarScalpEvent[];
  oneMinuteReplaySignature: string;
  fiveMinuteReplaySignature: string;
} {
  const oneReplay = replay(oneMinuteCandles);
  const fiveReplay = replay(fiveMinuteCandles);
  return {
    events: detectSonarScalpEventsFromRows(
      oneMinuteCandles,
      oneReplay.rows,
      fiveMinuteCandles,
      fiveReplay.rows,
      config,
    ),
    oneMinuteReplaySignature: oneReplay.signature,
    fiveMinuteReplaySignature: fiveReplay.signature,
  };
}

export function evaluateSonarScalpEvents(
  candles: Candle[],
  events: SonarScalpEvent[],
  config: Partial<SonarScalpStudyConfig> = {},
  window?: StudyWindow,
): SonarScalpOutcome[] {
  const settings: SonarScalpStudyConfig = {
    horizonBars: config.horizonBars ?? 3,
    feeRate: config.feeRate ?? 0.0004,
    slippageRate: config.slippageRate ?? 0.0001,
  };
  if (!Number.isInteger(settings.horizonBars) || settings.horizonBars < 1) throw new Error('horizonBars must be >= 1');
  if (settings.feeRate < 0 || settings.slippageRate < 0) throw new Error('cost rates must be non-negative');

  const start = window?.startIndex ?? 0;
  const end = window?.endIndexExclusive ?? candles.length;
  const roundTripCost = 2 * (settings.feeRate + settings.slippageRate);
  const outcomes: SonarScalpOutcome[] = [];

  for (const event of events) {
    const entryIndex = event.index + 1;
    const exitIndex = entryIndex + settings.horizonBars - 1;
    if (event.index < start || entryIndex < start || exitIndex >= end || exitIndex >= candles.length) continue;
    const entryCandle = candles[entryIndex];
    const exitCandle = candles[exitIndex];
    if (!entryCandle || !exitCandle || entryCandle.open <= 0) continue;

    const path = candles.slice(entryIndex, exitIndex + 1);
    const pathReturns = path.flatMap((bar) => [
      signedReturn(entryCandle.open, bar.high, event.direction),
      signedReturn(entryCandle.open, bar.low, event.direction),
    ]);
    const grossReturn = signedReturn(entryCandle.open, exitCandle.close, event.direction);

    outcomes.push({
      ...event,
      entryIndex,
      exitIndex,
      entryPrice: entryCandle.open,
      exitPrice: exitCandle.close,
      grossReturn,
      netReturn: grossReturn - roundTripCost,
      mae: pathReturns.length ? Math.min(...pathReturns) : 0,
      mfe: pathReturns.length ? Math.max(...pathReturns) : 0,
    });
  }
  return outcomes;
}

export function summarizeSonarScalpOutcomes(outcomes: SonarScalpOutcome[]): SonarScalpStats {
  const winners = outcomes.filter((outcome) => outcome.netReturn > 0).map((outcome) => outcome.netReturn);
  const losers = outcomes.filter((outcome) => outcome.netReturn <= 0).map((outcome) => outcome.netReturn);
  const grossExpectancy = mean(outcomes.map((outcome) => outcome.grossReturn));
  return {
    sampleCount: outcomes.length,
    hitRate: outcomes.length ? winners.length / outcomes.length : 0,
    grossExpectancy,
    expectancy: mean(outcomes.map((outcome) => outcome.netReturn)),
    breakEvenRoundTripCost: Math.max(0, grossExpectancy),
    averageWin: mean(winners),
    averageLoss: mean(losers),
    averageMae: mean(outcomes.map((outcome) => outcome.mae)),
    averageMfe: mean(outcomes.map((outcome) => outcome.mfe)),
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

function gate(
  validation: SonarScalpStats,
  holdout: SonarScalpStats,
  minimumSamples: number,
  minimumNetExpectancy: number,
): { status: GateStatus; reasons: string[] } {
  const reasons: string[] = [];
  if (validation.sampleCount < minimumSamples || holdout.sampleCount < minimumSamples) {
    return { status: 'INSUFFICIENT_DATA', reasons: ['minimum sample count not met in both validation and holdout'] };
  }
  if (validation.expectancy <= minimumNetExpectancy) reasons.push('validation net expectancy did not clear threshold');
  if (holdout.expectancy <= minimumNetExpectancy) reasons.push('holdout net expectancy did not clear threshold');
  return { status: reasons.length ? 'REJECT' : 'PASS', reasons };
}

export function runSonarScalpRobustness(
  oneMinuteCandles: Candle[],
  fiveMinuteCandles: Candle[],
  options: {
    signalConfig?: Partial<SonarScalpConfig>;
    horizons?: number[];
    minimumSamplesPerWindow?: number;
    minimumNetExpectancy?: number;
  } = {},
): SonarScalpRobustnessReport {
  const config = { ...DEFAULT_SIGNAL_CONFIG, ...(options.signalConfig ?? {}) };
  const horizons = options.horizons ?? [2, 3, 5, 8];
  if (!horizons.length || horizons.some((value) => !Number.isInteger(value) || value < 1)) {
    throw new Error('horizons must contain positive integers');
  }
  const minimumSamples = options.minimumSamplesPerWindow ?? 30;
  const minimumNetExpectancy = options.minimumNetExpectancy ?? 0;
  const detected = detectSonarScalpEvents(oneMinuteCandles, fiveMinuteCandles, config);
  const windows = makeWindows(oneMinuteCandles.length);
  const runs: SonarScalpRun[] = [];

  for (const horizonBars of horizons) {
    for (const cost of DEFAULT_COSTS) {
      const studyConfig = { horizonBars, feeRate: cost.feeRate, slippageRate: cost.slippageRate };
      const train = summarizeSonarScalpOutcomes(evaluateSonarScalpEvents(oneMinuteCandles, detected.events, studyConfig, windows.train));
      const validation = summarizeSonarScalpOutcomes(evaluateSonarScalpEvents(oneMinuteCandles, detected.events, studyConfig, windows.validation));
      const holdout = summarizeSonarScalpOutcomes(evaluateSonarScalpEvents(oneMinuteCandles, detected.events, studyConfig, windows.holdout));
      const decision = gate(validation, holdout, minimumSamples, minimumNetExpectancy);
      runs.push({
        horizonBars,
        costScenario: cost.name,
        feeRate: cost.feeRate,
        slippageRate: cost.slippageRate,
        train,
        validation,
        holdout,
        status: decision.status,
        reasons: decision.reasons,
      });
    }
  }

  const statuses = runs.map((run) => run.status);
  const passedRuns = statuses.filter((status) => status === 'PASS').length;
  const reasons: string[] = [];
  let status: GateStatus = 'PASS';
  if (statuses.some((item) => item === 'INSUFFICIENT_DATA')) {
    status = 'INSUFFICIENT_DATA';
    reasons.push('at least one horizon/cost window lacks minimum samples');
  } else if (statuses.some((item) => item === 'REJECT') || passedRuns !== runs.length) {
    status = 'REJECT';
    reasons.push('SonarScalp failed at least one horizon/cost robustness run');
  }

  return {
    oneMinuteCount: oneMinuteCandles.length,
    fiveMinuteCount: fiveMinuteCandles.length,
    eventCount: detected.events.length,
    oneMinuteReplaySignature: detected.oneMinuteReplaySignature,
    fiveMinuteReplaySignature: detected.fiveMinuteReplaySignature,
    config,
    runs,
    decision: { status, passedRuns, totalRuns: runs.length, reasons },
  };
}
