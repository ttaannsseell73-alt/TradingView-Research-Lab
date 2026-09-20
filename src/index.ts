export { FeatureEngine } from './featureEngine.js';
export type { FeatureEngineConfig } from './featureEngine.js';
export { replay } from './replay.js';
export type { ReplayResult } from './replay.js';
export { parseCandleCsv } from './csv.js';
export { detectSetups } from './setups.js';
export type { SetupDetectorConfig } from './setups.js';
export { evaluateEvents, summarizeAll, summarizeOutcomes } from './eventStudy.js';
export { decidePromotion, makeWalkForwardWindows, runWalkForwardStudy } from './walkForward.js';
export type { WalkForwardReport } from './walkForward.js';
export { inspectCandleQuality } from './dataQuality.js';
export type { DataQualityReport } from './dataQuality.js';
export { runRobustnessMatrix } from './robustness.js';
export { tuneSetupConfig } from './optimizer.js';
export type { SetupTuningChoice, SetupTuningReport } from './optimizer.js';
export type {
  CostScenario,
  RobustnessConfig,
  RobustnessDecision,
  RobustnessReport,
  RobustnessRun,
} from './robustness.js';
export { KIVANC_CANDIDATES } from './candidates.js';
export type { CandidateDisposition, ResearchCandidate } from './candidates.js';
export type {
  Candle,
  CanonicalFeatureVector,
  Direction,
  EventOutcome,
  EventStudyConfig,
  FeatureRow,
  GateConfig,
  GateDecision,
  GateStatus,
  SetupEvent,
  SetupKind,
  SetupStats,
  StudyWindow,
  WalkForwardWindows,
} from './types.js';

export {
  detectSonarScalpEvents,
  detectSonarScalpEventsFromRows,
  evaluateSonarScalpEvents,
  latestClosedContextIndex,
  runSonarScalpRobustness,
  summarizeSonarScalpOutcomes,
} from './sonarScalp.js';
export type {
  SonarScalpConfig,
  SonarScalpEvent,
  SonarScalpOutcome,
  SonarScalpRobustnessReport,
  SonarScalpRun,
  SonarScalpStats,
  SonarScalpStudyConfig,
  SonarTriggerKind,
} from './sonarScalp.js';
