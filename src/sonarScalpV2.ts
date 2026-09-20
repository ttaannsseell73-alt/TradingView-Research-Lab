import { replay } from './replay.js';
import { latestClosedContextIndex } from './sonarScalp.js';
import type { Candle, CanonicalFeatureVector, Direction, FeatureRow, GateStatus, StudyWindow } from './types.js';

export type SonarScalpV2Kind = 'trend_retest' | 'range_sweep';

export interface SonarScalpV2Config {
  trendContextThreshold: number;
  trendRetestThreshold: number;
  rangeContextMaxAbs: number;
  rangeBoundaryThreshold: number;
  rangeSweepDepthThreshold: number;
  rangeReclaimThreshold: number;
  minRelativeVolume: number;
  cooldownBars: number;
}

export interface SonarScalpV2Event {
  index: number;
  timestamp: number;
  kind: SonarScalpV2Kind;
  direction: Direction;
  strength: number;
  contextTimestamp: number;
  contextScore: number;
  contextBoundary: number;
  triggerScore: number;
}

export interface SonarScalpV2StudyConfig {
  horizonBars: number;
  feeRate: number;
  slippageRate: number;
}

export interface SonarScalpV2Outcome extends SonarScalpV2Event {
  entryIndex: number;
  exitIndex: number;
  entryPrice: number;
  exitPrice: number;
  grossReturn: number;
  netReturn: number;
  mae: number;
  mfe: number;
}

export interface SonarScalpV2Stats {
  setup: SonarScalpV2Kind;
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

export interface SonarScalpV2Run {
  horizonBars: number;
  costScenario: string;
  feeRate: number;
  slippageRate: number;
  train: SonarScalpV2Stats[];
  validation: SonarScalpV2Stats[];
  holdout: SonarScalpV2Stats[];
  decisions: Array<{ setup: SonarScalpV2Kind; status: GateStatus; reasons: string[] }>;
}

export interface SonarScalpV2Report {
  oneMinuteCount: number;
  fiveMinuteCount: number;
  eventCount: number;
  eventCountBySetup: Record<SonarScalpV2Kind, number>;
  oneMinuteReplaySignature: string;
  fiveMinuteReplaySignature: string;
  config: SonarScalpV2Config;
  runs: SonarScalpV2Run[];
  decisions: Array<{
    setup: SonarScalpV2Kind;
    status: GateStatus;
    passedRuns: number;
    totalRuns: number;
    reasons: string[];
  }>;
  promotable: SonarScalpV2Kind[];
}

const DEFAULT_CONFIG: SonarScalpV2Config = {
  trendContextThreshold: 0.60,
  trendRetestThreshold: 0.35,
  rangeContextMaxAbs: 0.25,
  rangeBoundaryThreshold: 0.35,
  rangeSweepDepthThreshold: 0.15,
  rangeReclaimThreshold: 0.25,
  minRelativeVolume: 1.0,
  cooldownBars: 2,
};

const DEFAULT_COSTS = [
  { name: 'base', feeRate: 0.0004, slippageRate: 0.0001 },
  { name: 'stress', feeRate: 0.0005, slippageRate: 0.0003 },
] as const;

const SETUPS: SonarScalpV2Kind[] = ['trend_retest', 'range_sweep'];

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
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
  if (!diffs.length) throw new Error('Unable to infer candle interval');
  const counts = new Map<number, number>();
  for (const diff of diffs) counts.set(diff, (counts.get(diff) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? diffs[0]!;
}

export function detectSonarScalpV2EventsFromRows(
  oneMinuteCandles: Candle[],
  oneMinuteRows: FeatureRow[],
  fiveMinuteCandles: Candle[],
  fiveMinuteRows: FeatureRow[],
  config: Partial<SonarScalpV2Config> = {},
): SonarScalpV2Event[] {
  if (oneMinuteCandles.length !== oneMinuteRows.length) throw new Error('1m candle/feature length mismatch');
  if (fiveMinuteCandles.length !== fiveMinuteRows.length) throw new Error('5m candle/feature length mismatch');
  const settings = { ...DEFAULT_CONFIG, ...config };
  const oneInterval = inferIntervalMs(oneMinuteCandles);
  const fiveInterval = inferIntervalMs(fiveMinuteCandles);
  const events: SonarScalpV2Event[] = [];
  let lastEventIndex = -Infinity;

  for (let i = 0; i < oneMinuteCandles.length; i += 1) {
    if (i - lastEventIndex <= settings.cooldownBars) continue;
    const candle = oneMinuteCandles[i];
    const row = oneMinuteRows[i];
    if (!candle || !row) continue;

    const contextIndex = latestClosedContextIndex(candle.timestamp, oneInterval, fiveMinuteCandles, fiveInterval);
    if (contextIndex < 0) continue;
    const contextCandle = fiveMinuteCandles[contextIndex];
    const contextRow = fiveMinuteRows[contextIndex];
    if (!contextCandle || !contextRow) continue;

    const ctx = contextRow.features;
    const ctxScore = contextScore(ctx);
    const relativeVolume = row.features.RelativeVolume;
    if (relativeVolume < settings.minRelativeVolume) continue;

    let selected: SonarScalpV2Event | undefined;

    const retest = row.features.RetestQuality;
    if (retest !== 0 && Math.abs(retest) >= settings.trendRetestThreshold) {
      const direction = (retest > 0 ? 1 : -1) as Direction;
      const aligned = (ctxScore * direction) >= settings.trendContextThreshold;
      const opposingShift = (row.features.CHOCHStrength * direction) < -0.15;
      if (aligned && !opposingShift) {
        selected = {
          index: i,
          timestamp: candle.timestamp,
          kind: 'trend_retest',
          direction,
          strength: clamp(
            Math.abs(retest) * (1 + Math.abs(ctxScore)) * clamp(relativeVolume, 0.5, 2),
            0,
            6,
          ),
          contextTimestamp: contextCandle.timestamp,
          contextScore: ctxScore,
          contextBoundary: ctx.RangeBoundary,
          triggerScore: retest,
        };
      }
    }

    if (!selected && Math.abs(ctxScore) <= settings.rangeContextMaxAbs) {
      const sweep = row.features.SweepDepth;
      const reclaim = row.features.ReclaimQuality;
      if (
        sweep !== 0 &&
        reclaim !== 0 &&
        Math.sign(sweep) === Math.sign(reclaim) &&
        Math.abs(sweep) >= settings.rangeSweepDepthThreshold &&
        Math.abs(reclaim) >= settings.rangeReclaimThreshold
      ) {
        const direction = (reclaim > 0 ? 1 : -1) as Direction;
        const atOppositeBoundary = (ctx.RangeBoundary * direction) <= -settings.rangeBoundaryThreshold;
        if (atOppositeBoundary) {
          selected = {
            index: i,
            timestamp: candle.timestamp,
            kind: 'range_sweep',
            direction,
            strength: clamp(
              ((Math.abs(reclaim) * 0.65) + (Math.abs(sweep) * 0.35)) *
                (1 + Math.abs(ctx.RangeBoundary)) *
                clamp(relativeVolume, 0.5, 2),
              0,
              6,
            ),
            contextTimestamp: contextCandle.timestamp,
            contextScore: ctxScore,
            contextBoundary: ctx.RangeBoundary,
            triggerScore: reclaim,
          };
        }
      }
    }

    if (selected) {
      events.push(selected);
      lastEventIndex = i;
    }
  }

  return events;
}

export function detectSonarScalpV2Events(
  oneMinuteCandles: Candle[],
  fiveMinuteCandles: Candle[],
  config: Partial<SonarScalpV2Config> = {},
): {
  events: SonarScalpV2Event[];
  oneMinuteReplaySignature: string;
  fiveMinuteReplaySignature: string;
} {
  const oneReplay = replay(oneMinuteCandles);
  const fiveReplay = replay(fiveMinuteCandles);
  return {
    events: detectSonarScalpV2EventsFromRows(
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

function signedReturn(entry: number, price: number, direction: Direction): number {
  return direction * (price - entry) / entry;
}

export function evaluateSonarScalpV2Events(
  candles: Candle[],
  events: SonarScalpV2Event[],
  config: Partial<SonarScalpV2StudyConfig> = {},
  window?: StudyWindow,
): SonarScalpV2Outcome[] {
  const settings: SonarScalpV2StudyConfig = {
    horizonBars: config.horizonBars ?? 5,
    feeRate: config.feeRate ?? 0.0004,
    slippageRate: config.slippageRate ?? 0.0001,
  };
  if (!Number.isInteger(settings.horizonBars) || settings.horizonBars < 1) throw new Error('horizonBars must be >= 1');
  if (settings.feeRate < 0 || settings.slippageRate < 0) throw new Error('cost rates must be non-negative');

  const start = window?.startIndex ?? 0;
  const end = window?.endIndexExclusive ?? candles.length;
  const roundTripCost = 2 * (settings.feeRate + settings.slippageRate);
  const outcomes: SonarScalpV2Outcome[] = [];

  for (const event of events) {
    const entryIndex = event.index + 1;
    const exitIndex = entryIndex + settings.horizonBars - 1;
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
      netReturn: grossReturn - roundTripCost,
      mae: pathReturns.length ? Math.min(...pathReturns) : 0,
      mfe: pathReturns.length ? Math.max(...pathReturns) : 0,
    });
  }
  return outcomes;
}

export function summarizeSonarScalpV2Outcomes(
  outcomes: SonarScalpV2Outcome[],
  setup: SonarScalpV2Kind,
): SonarScalpV2Stats {
  const selected = outcomes.filter((outcome) => outcome.kind === setup);
  const winners = selected.filter((outcome) => outcome.netReturn > 0).map((outcome) => outcome.netReturn);
  const losers = selected.filter((outcome) => outcome.netReturn <= 0).map((outcome) => outcome.netReturn);
  const grossExpectancy = mean(selected.map((outcome) => outcome.grossReturn));
  return {
    setup,
    sampleCount: selected.length,
    hitRate: selected.length ? winners.length / selected.length : 0,
    grossExpectancy,
    expectancy: mean(selected.map((outcome) => outcome.netReturn)),
    breakEvenRoundTripCost: Math.max(0, grossExpectancy),
    averageWin: mean(winners),
    averageLoss: mean(losers),
    averageMae: mean(selected.map((outcome) => outcome.mae)),
    averageMfe: mean(selected.map((outcome) => outcome.mfe)),
  };
}

function summarizeAll(outcomes: SonarScalpV2Outcome[]): SonarScalpV2Stats[] {
  return SETUPS.map((setup) => summarizeSonarScalpV2Outcomes(outcomes, setup));
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

function decideSetup(
  setup: SonarScalpV2Kind,
  validation: SonarScalpV2Stats[],
  holdout: SonarScalpV2Stats[],
  minimumSamples: number,
  minimumNetExpectancy: number,
): { setup: SonarScalpV2Kind; status: GateStatus; reasons: string[] } {
  const v = validation.find((item) => item.setup === setup);
  const h = holdout.find((item) => item.setup === setup);
  if (!v || !h || v.sampleCount < minimumSamples || h.sampleCount < minimumSamples) {
    return { setup, status: 'INSUFFICIENT_DATA', reasons: ['minimum sample count not met in both validation and holdout'] };
  }
  const reasons: string[] = [];
  if (v.expectancy <= minimumNetExpectancy) reasons.push('validation net expectancy did not clear threshold');
  if (h.expectancy <= minimumNetExpectancy) reasons.push('holdout net expectancy did not clear threshold');
  return { setup, status: reasons.length ? 'REJECT' : 'PASS', reasons };
}

export function runSonarScalpV2Robustness(
  oneMinuteCandles: Candle[],
  fiveMinuteCandles: Candle[],
  options: {
    signalConfig?: Partial<SonarScalpV2Config>;
    horizons?: number[];
    minimumSamplesPerWindow?: number;
    minimumNetExpectancy?: number;
  } = {},
): SonarScalpV2Report {
  const config = { ...DEFAULT_CONFIG, ...(options.signalConfig ?? {}) };
  const horizons = options.horizons ?? [3, 5, 8, 12];
  const minimumSamples = options.minimumSamplesPerWindow ?? 30;
  const minimumNetExpectancy = options.minimumNetExpectancy ?? 0;
  const detected = detectSonarScalpV2Events(oneMinuteCandles, fiveMinuteCandles, config);
  const windows = makeWindows(oneMinuteCandles.length);
  const runs: SonarScalpV2Run[] = [];

  for (const horizonBars of horizons) {
    for (const cost of DEFAULT_COSTS) {
      const study = { horizonBars, feeRate: cost.feeRate, slippageRate: cost.slippageRate };
      const train = summarizeAll(evaluateSonarScalpV2Events(oneMinuteCandles, detected.events, study, windows.train));
      const validation = summarizeAll(evaluateSonarScalpV2Events(oneMinuteCandles, detected.events, study, windows.validation));
      const holdout = summarizeAll(evaluateSonarScalpV2Events(oneMinuteCandles, detected.events, study, windows.holdout));
      const decisions = SETUPS.map((setup) =>
        decideSetup(setup, validation, holdout, minimumSamples, minimumNetExpectancy),
      );
      runs.push({
        horizonBars,
        costScenario: cost.name,
        feeRate: cost.feeRate,
        slippageRate: cost.slippageRate,
        train,
        validation,
        holdout,
        decisions,
      });
    }
  }

  const decisions = SETUPS.map((setup) => {
    const statuses = runs.map((run) => run.decisions.find((item) => item.setup === setup)?.status ?? 'INSUFFICIENT_DATA');
    const passedRuns = statuses.filter((status) => status === 'PASS').length;
    const reasons: string[] = [];
    let status: GateStatus = 'PASS';
    if (statuses.some((item) => item === 'INSUFFICIENT_DATA')) {
      status = 'INSUFFICIENT_DATA';
      reasons.push('at least one horizon/cost window lacks minimum samples');
    } else if (statuses.some((item) => item === 'REJECT') || passedRuns !== runs.length) {
      status = 'REJECT';
      reasons.push('setup failed at least one horizon/cost robustness run');
    }
    return { setup, status, passedRuns, totalRuns: statuses.length, reasons };
  });

  return {
    oneMinuteCount: oneMinuteCandles.length,
    fiveMinuteCount: fiveMinuteCandles.length,
    eventCount: detected.events.length,
    eventCountBySetup: {
      trend_retest: detected.events.filter((event) => event.kind === 'trend_retest').length,
      range_sweep: detected.events.filter((event) => event.kind === 'range_sweep').length,
    },
    oneMinuteReplaySignature: detected.oneMinuteReplaySignature,
    fiveMinuteReplaySignature: detected.fiveMinuteReplaySignature,
    config,
    runs,
    decisions,
    promotable: decisions.filter((item) => item.status === 'PASS').map((item) => item.setup),
  };
}
