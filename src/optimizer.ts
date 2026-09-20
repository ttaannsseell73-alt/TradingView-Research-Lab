import { evaluateEvents, summarizeOutcomes } from './eventStudy.js';
import { detectSetups, type SetupDetectorConfig } from './setups.js';
import type { Candle, EventStudyConfig, FeatureRow, SetupKind, StudyWindow } from './types.js';

export interface SetupTuningChoice {
  setup: SetupKind;
  sampleCount: number;
  expectancy: number;
  selected: Record<string, number>;
}

export interface SetupTuningReport {
  config: SetupDetectorConfig;
  choices: SetupTuningChoice[];
}

const BASE: SetupDetectorConfig = {
  breakoutStrength: 0.2,
  sweepStrength: 0.15,
  reclaimStrength: 0.05,
  compressionDepth: 0.2,
  compressionDuration: 0.25,
  expansionVelocity: 1.25,
};

function score(
  candles: Candle[],
  rows: FeatureRow[],
  setup: SetupKind,
  config: SetupDetectorConfig,
  eventConfig: Partial<EventStudyConfig>,
  trainWindow: StudyWindow,
): { sampleCount: number; expectancy: number } {
  const events = detectSetups(candles, rows, config);
  const outcomes = evaluateEvents(candles, events, eventConfig, trainWindow);
  const stats = summarizeOutcomes(outcomes, setup);
  return { sampleCount: stats.sampleCount, expectancy: stats.expectancy };
}

function better(
  candidate: { sampleCount: number; expectancy: number },
  best: { sampleCount: number; expectancy: number } | undefined,
  minimumSamples: number,
): boolean {
  const candidateEligible = candidate.sampleCount >= minimumSamples;
  const bestEligible = best ? best.sampleCount >= minimumSamples : false;
  if (candidateEligible !== bestEligible) return candidateEligible;
  if (!best) return true;
  if (candidate.expectancy !== best.expectancy) return candidate.expectancy > best.expectancy;
  return candidate.sampleCount > best.sampleCount;
}

export function tuneSetupConfig(
  candles: Candle[],
  rows: FeatureRow[],
  trainWindow: StudyWindow,
  eventConfig: Partial<EventStudyConfig> = {},
  minimumSamples = 30,
): SetupTuningReport {
  if (!Number.isInteger(minimumSamples) || minimumSamples < 1) throw new Error('minimumSamples must be >= 1');
  const config = { ...BASE };
  const choices: SetupTuningChoice[] = [];

  let bestBreakout: { sampleCount: number; expectancy: number } | undefined;
  let breakoutStrength = config.breakoutStrength;
  for (const value of [0.15, 0.2, 0.3, 0.45, 0.65, 0.9]) {
    const candidate = { ...config, breakoutStrength: value };
    const result = score(candles, rows, 'breakout', candidate, eventConfig, trainWindow);
    if (better(result, bestBreakout, minimumSamples)) {
      bestBreakout = result;
      breakoutStrength = value;
    }
  }
  config.breakoutStrength = breakoutStrength;
  choices.push({
    setup: 'breakout',
    sampleCount: bestBreakout?.sampleCount ?? 0,
    expectancy: bestBreakout?.expectancy ?? 0,
    selected: { breakoutStrength },
  });

  let bestSweep: { sampleCount: number; expectancy: number } | undefined;
  let sweepStrength = config.sweepStrength;
  let reclaimStrength = config.reclaimStrength;
  for (const sweep of [0.08, 0.12, 0.18, 0.25, 0.35, 0.5]) {
    for (const reclaim of [0.03, 0.05, 0.08, 0.12, 0.2, 0.3]) {
      const candidate = { ...config, sweepStrength: sweep, reclaimStrength: reclaim };
      const result = score(candles, rows, 'liquidity_sweep_reclaim', candidate, eventConfig, trainWindow);
      if (better(result, bestSweep, minimumSamples)) {
        bestSweep = result;
        sweepStrength = sweep;
        reclaimStrength = reclaim;
      }
    }
  }
  config.sweepStrength = sweepStrength;
  config.reclaimStrength = reclaimStrength;
  choices.push({
    setup: 'liquidity_sweep_reclaim',
    sampleCount: bestSweep?.sampleCount ?? 0,
    expectancy: bestSweep?.expectancy ?? 0,
    selected: { sweepStrength, reclaimStrength },
  });

  let bestCompression: { sampleCount: number; expectancy: number } | undefined;
  let compressionDepth = config.compressionDepth;
  let compressionDuration = config.compressionDuration;
  let expansionVelocity = config.expansionVelocity;
  for (const depth of [0.1, 0.18, 0.25, 0.35, 0.45]) {
    for (const duration of [0.15, 0.25, 0.4, 0.55]) {
      for (const expansion of [1.05, 1.2, 1.4, 1.7, 2.1]) {
        const candidate = {
          ...config,
          compressionDepth: depth,
          compressionDuration: duration,
          expansionVelocity: expansion,
        };
        const result = score(candles, rows, 'compression_release', candidate, eventConfig, trainWindow);
        if (better(result, bestCompression, minimumSamples)) {
          bestCompression = result;
          compressionDepth = depth;
          compressionDuration = duration;
          expansionVelocity = expansion;
        }
      }
    }
  }
  config.compressionDepth = compressionDepth;
  config.compressionDuration = compressionDuration;
  config.expansionVelocity = expansionVelocity;
  choices.push({
    setup: 'compression_release',
    sampleCount: bestCompression?.sampleCount ?? 0,
    expectancy: bestCompression?.expectancy ?? 0,
    selected: { compressionDepth, compressionDuration, expansionVelocity },
  });

  return { config, choices };
}
