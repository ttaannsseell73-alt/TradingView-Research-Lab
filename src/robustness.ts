import { detectSetups, type SetupDetectorConfig } from './setups.js';
import { replay, type FeatureEngineConfig } from './replay.js';
import { runWalkForwardStudy, type WalkForwardReport } from './walkForward.js';
import type { Candle, EventStudyConfig, GateConfig, GateStatus, SetupKind } from './types.js';

export interface CostScenario {
  name: string;
  feeRate: number;
  slippageRate: number;
}

export interface RobustnessConfig {
  horizons: number[];
  costScenarios: CostScenario[];
  featureConfig?: Partial<FeatureEngineConfig>;
  setupConfig?: Partial<SetupDetectorConfig>;
  gateConfig?: Partial<GateConfig>;
}

export interface RobustnessRun {
  horizonBars: number;
  costScenario: string;
  feeRate: number;
  slippageRate: number;
  report: WalkForwardReport;
}

export interface RobustnessDecision {
  setup: SetupKind;
  status: GateStatus;
  passedRuns: number;
  totalRuns: number;
  reasons: string[];
}

export interface RobustnessReport {
  candleCount: number;
  eventCount: number;
  replaySignature: string;
  runs: RobustnessRun[];
  decisions: RobustnessDecision[];
}

const DEFAULT_COSTS: CostScenario[] = [
  { name: 'base', feeRate: 0.0004, slippageRate: 0.0001 },
  { name: 'stress', feeRate: 0.0005, slippageRate: 0.0003 },
];

export function runRobustnessMatrix(
  candles: Candle[],
  config: Partial<RobustnessConfig> = {},
): RobustnessReport {
  const horizons = config.horizons ?? [3, 6, 12, 24];
  const costScenarios = config.costScenarios ?? DEFAULT_COSTS;
  if (horizons.length === 0 || horizons.some((value) => !Number.isInteger(value) || value < 1)) {
    throw new Error('horizons must contain positive integers');
  }
  if (costScenarios.length === 0) throw new Error('At least one cost scenario is required');
  for (const scenario of costScenarios) {
    if (!scenario.name || scenario.feeRate < 0 || scenario.slippageRate < 0) {
      throw new Error('Invalid cost scenario');
    }
  }

  const replayResult = replay(candles, config.featureConfig);
  const events = detectSetups(candles, replayResult.rows, config.setupConfig);
  const runs: RobustnessRun[] = [];

  for (const horizonBars of horizons) {
    for (const scenario of costScenarios) {
      const eventConfig: Partial<EventStudyConfig> = {
        horizonBars,
        feeRate: scenario.feeRate,
        slippageRate: scenario.slippageRate,
      };
      runs.push({
        horizonBars,
        costScenario: scenario.name,
        feeRate: scenario.feeRate,
        slippageRate: scenario.slippageRate,
        report: runWalkForwardStudy(candles, events, eventConfig, config.gateConfig),
      });
    }
  }

  const setups: SetupKind[] = ['breakout', 'liquidity_sweep_reclaim', 'compression_release'];
  const decisions = setups.map((setup): RobustnessDecision => {
    const statuses = runs.map((run) => run.report.decisions.find((decision) => decision.setup === setup)?.status ?? 'INSUFFICIENT_DATA');
    const passedRuns = statuses.filter((status) => status === 'PASS').length;
    const insufficient = statuses.some((status) => status === 'INSUFFICIENT_DATA');
    const rejected = statuses.some((status) => status === 'REJECT');
    const reasons: string[] = [];
    let status: GateStatus = 'PASS';

    if (insufficient) {
      status = 'INSUFFICIENT_DATA';
      reasons.push('at least one horizon/cost window lacks minimum samples');
    } else if (rejected || passedRuns !== statuses.length) {
      status = 'REJECT';
      reasons.push('setup failed at least one horizon/cost stress run');
    }
    return { setup, status, passedRuns, totalRuns: statuses.length, reasons };
  });

  return {
    candleCount: candles.length,
    eventCount: events.length,
    replaySignature: replayResult.signature,
    runs,
    decisions,
  };
}
