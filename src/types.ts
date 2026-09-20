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
