import { evaluateEvents, summarizeAll } from './eventStudy.js';
import type {
  Candle,
  EventStudyConfig,
  GateConfig,
  GateDecision,
  SetupEvent,
  SetupKind,
  SetupStats,
  WalkForwardWindows,
} from './types.js';

export interface WalkForwardReport {
  windows: WalkForwardWindows;
  train: SetupStats[];
  validation: SetupStats[];
  holdout: SetupStats[];
  decisions: GateDecision[];
}

export function makeWalkForwardWindows(length: number): WalkForwardWindows {
  if (!Number.isInteger(length) || length < 30) throw new Error('At least 30 candles are required for walk-forward research');
  const trainEnd = Math.max(1, Math.floor(length * 0.6));
  const validationEnd = Math.max(trainEnd + 1, Math.floor(length * 0.8));
  return {
    train: { startIndex: 0, endIndexExclusive: trainEnd },
    validation: { startIndex: trainEnd, endIndexExclusive: validationEnd },
    holdout: { startIndex: validationEnd, endIndexExclusive: length },
  };
}

function statsBySetup(stats: SetupStats[]): Map<SetupKind, SetupStats> {
  return new Map(stats.map((item) => [item.setup, item]));
}

export function decidePromotion(
  validation: SetupStats[],
  holdout: SetupStats[],
  config: Partial<GateConfig> = {},
): GateDecision[] {
  const settings: GateConfig = {
    minimumSamplesPerWindow: config.minimumSamplesPerWindow ?? 30,
    minimumNetExpectancy: config.minimumNetExpectancy ?? 0,
  };
  const validationMap = statsBySetup(validation);
  const holdoutMap = statsBySetup(holdout);
  const setups: SetupKind[] = ['breakout', 'liquidity_sweep_reclaim', 'compression_release'];

  return setups.map((setup) => {
    const v = validationMap.get(setup);
    const h = holdoutMap.get(setup);
    const reasons: string[] = [];
    if (!v || !h || v.sampleCount < settings.minimumSamplesPerWindow || h.sampleCount < settings.minimumSamplesPerWindow) {
      reasons.push('minimum sample count not met in both validation and holdout');
      return { setup, status: 'INSUFFICIENT_DATA', reasons };
    }
    if (v.expectancy <= settings.minimumNetExpectancy) reasons.push('validation net expectancy did not clear threshold');
    if (h.expectancy <= settings.minimumNetExpectancy) reasons.push('holdout net expectancy did not clear threshold');
    return { setup, status: reasons.length === 0 ? 'PASS' : 'REJECT', reasons };
  });
}

export function runWalkForwardStudy(
  candles: Candle[],
  events: SetupEvent[],
  eventConfig: Partial<EventStudyConfig> = {},
  gateConfig: Partial<GateConfig> = {},
): WalkForwardReport {
  const windows = makeWalkForwardWindows(candles.length);
  const train = summarizeAll(evaluateEvents(candles, events, eventConfig, windows.train));
  const validation = summarizeAll(evaluateEvents(candles, events, eventConfig, windows.validation));
  const holdout = summarizeAll(evaluateEvents(candles, events, eventConfig, windows.holdout));
  return { windows, train, validation, holdout, decisions: decidePromotion(validation, holdout, gateConfig) };
}
