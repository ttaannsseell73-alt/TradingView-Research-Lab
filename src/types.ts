export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closed: boolean;
}

export interface CanonicalFeatureVector {
  InternalStructure: number;
  ExternalStructure: number;
  BOSStrength: number;
  CHOCHStrength: number;
  SwingQuality: number;
  RangeBoundary: number;
  BreakoutDisplacement: number;
  LiquidityDensity: number;
  SweepDepth: number;
  ReclaimQuality: number;
  PostSweepDisplacement: number;
  StructureShiftAfterSweep: number;
  RetestQuality: number;
  CompressionDepth: number;
  CompressionDuration: number;
  ExpansionVelocity: number;
  TrendRangeScore: number;
  RelativeVolume: number;
}

export interface FeatureRow {
  timestamp: number;
  features: CanonicalFeatureVector;
}

export type Direction = 1 | -1;
export type SetupKind = 'breakout' | 'liquidity_sweep_reclaim' | 'compression_release';

export interface SetupEvent {
  index: number;
  timestamp: number;
  kind: SetupKind;
  direction: Direction;
  strength: number;
}

export interface EventStudyConfig {
  horizonBars: number;
  feeRate: number;
  slippageRate: number;
}

export interface EventOutcome extends SetupEvent {
  entryPrice: number;
  exitPrice: number;
  grossReturn: number;
  netReturn: number;
  mae: number;
  mfe: number;
}

export interface SetupStats {
  setup: SetupKind;
  sampleCount: number;
  hitRate: number;
  expectancy: number;
  averageWin: number;
  averageLoss: number;
  averageMae: number;
  averageMfe: number;
}

export interface StudyWindow {
  startIndex: number;
  endIndexExclusive: number;
}

export interface WalkForwardWindows {
  train: StudyWindow;
  validation: StudyWindow;
  holdout: StudyWindow;
}

export interface GateConfig {
  minimumSamplesPerWindow: number;
  minimumNetExpectancy: number;
}

export type GateStatus = 'PASS' | 'REJECT' | 'INSUFFICIENT_DATA';

export interface GateDecision {
  setup: SetupKind;
  status: GateStatus;
  reasons: string[];
}
