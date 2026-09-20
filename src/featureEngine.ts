import type { Candle, CanonicalFeatureVector, FeatureRow } from './types.js';

export interface FeatureEngineConfig {
  internalLookback: number;
  externalLookback: number;
  levelLookback: number;
  volumeLookback: number;
  compressionLookback: number;
}

const DEFAULT_CONFIG: FeatureEngineConfig = {
  internalLookback: 12,
  externalLookback: 48,
  levelLookback: 48,
  volumeLookback: 48,
  compressionLookback: 12,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function safeDiv(num: number, den: number, fallback = 0): number {
  return den > 0 ? num / den : fallback;
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  const mid = Math.floor(ordered.length / 2);
  const center = ordered[mid];
  if (center === undefined) return 0;
  if (ordered.length % 2 === 1) return center;
  const left = ordered[mid - 1] ?? center;
  return (left + center) / 2;
}

function candleRange(candle: Candle): number {
  return Math.max(0, candle.high - candle.low);
}

function structureScore(history: Candle[], lookback: number): number {
  const needed = lookback * 2;
  if (history.length < needed) return 0;
  const older = history.slice(-needed, -lookback);
  const newer = history.slice(-lookback);
  const olderHigh = Math.max(...older.map((c) => c.high));
  const olderLow = Math.min(...older.map((c) => c.low));
  const newerHigh = Math.max(...newer.map((c) => c.high));
  const newerLow = Math.min(...newer.map((c) => c.low));
  if (newerHigh > olderHigh && newerLow > olderLow) return 1;
  if (newerHigh < olderHigh && newerLow < olderLow) return -1;
  return 0;
}

function validateCandle(candle: Candle, previousTimestamp?: number): void {
  if (!candle.closed) throw new Error('Only closed candles are accepted');
  const values = [candle.timestamp, candle.open, candle.high, candle.low, candle.close, candle.volume];
  if (values.some((value) => !Number.isFinite(value))) throw new Error('Candle contains non-finite values');
  if (candle.volume < 0) throw new Error('Volume must be non-negative');
  if (candle.high < Math.max(candle.open, candle.close) || candle.low > Math.min(candle.open, candle.close)) {
    throw new Error('Invalid OHLC candle');
  }
  if (candle.high < candle.low) throw new Error('High must be >= low');
  if (previousTimestamp !== undefined && candle.timestamp <= previousTimestamp) {
    throw new Error('Timestamps must be strictly increasing');
  }
}

export class FeatureEngine {
  private readonly config: FeatureEngineConfig;
  private readonly history: Candle[] = [];
  private previousFeatures: CanonicalFeatureVector | undefined;
  private previousBreakoutDirection = 0;
  private previousBreakoutLevel: number | undefined;

  constructor(config: Partial<FeatureEngineConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    for (const [name, value] of Object.entries(this.config)) {
      if (!Number.isInteger(value) || value < 2) throw new Error(`${name} must be an integer >= 2`);
    }
  }

  process(candle: Candle): FeatureRow {
    validateCandle(candle, this.history.at(-1)?.timestamp);

    const priorLevels = this.history.slice(-this.config.levelLookback);
    const priorHigh = priorLevels.length ? Math.max(...priorLevels.map((c) => c.high)) : candle.high;
    const priorLow = priorLevels.length ? Math.min(...priorLevels.map((c) => c.low)) : candle.low;
    const priorSpan = Math.max(priorHigh - priorLow, Number.EPSILON);

    const longHistory = this.history.slice(-this.config.externalLookback);
    const shortHistory = this.history.slice(-this.config.compressionLookback);
    const longRanges = longHistory.map(candleRange);
    const shortRanges = shortHistory.map(candleRange);
    const avgLongRange = mean(longRanges) || candleRange(candle) || 1;
    const avgShortRange = mean(shortRanges) || avgLongRange;
    const currentRange = candleRange(candle);
    const bodyRatio = safeDiv(Math.abs(candle.close - candle.open), currentRange);

    const internalStructure = structureScore(this.history, this.config.internalLookback);
    const externalStructure = structureScore(this.history, this.config.externalLookback);

    const breakoutUp = priorLevels.length > 0 && candle.close > priorHigh;
    const breakoutDown = priorLevels.length > 0 && candle.close < priorLow;
    const breakoutDirection = breakoutUp ? 1 : breakoutDown ? -1 : 0;
    const breakoutLevel = breakoutUp ? priorHigh : breakoutDown ? priorLow : undefined;
    const breakoutDistance = breakoutUp
      ? candle.close - priorHigh
      : breakoutDown
        ? candle.close - priorLow
        : 0;
    const breakoutDisplacement = breakoutDirection * clamp(safeDiv(Math.abs(breakoutDistance), avgLongRange), 0, 3);
    const bosStrength = breakoutDisplacement;
    const chochStrength =
      breakoutDirection !== 0 && externalStructure !== 0 && breakoutDirection !== externalStructure
        ? breakoutDisplacement
        : 0;

    const highSweep = priorLevels.length > 0 && candle.high > priorHigh && candle.close < priorHigh;
    const lowSweep = priorLevels.length > 0 && candle.low < priorLow && candle.close > priorLow;
    const sweepDepth = highSweep
      ? -clamp(safeDiv(candle.high - priorHigh, avgLongRange), 0, 3)
      : lowSweep
        ? clamp(safeDiv(priorLow - candle.low, avgLongRange), 0, 3)
        : 0;
    const reclaimQuality = highSweep
      ? -clamp(safeDiv(priorHigh - candle.close, avgLongRange), 0, 2)
      : lowSweep
        ? clamp(safeDiv(candle.close - priorLow, avgLongRange), 0, 2)
        : 0;

    const currentMid = (priorHigh + priorLow) / 2;
    const rangeBoundary = priorLevels.length === 0 ? 0 : clamp((candle.close - currentMid) / (priorSpan / 2), -1, 1);

    const tolerance = avgLongRange * 0.25;
    let nearbyTouches = 0;
    for (const prior of priorLevels) {
      if (Math.abs(prior.high - candle.close) <= tolerance) nearbyTouches += 1;
      if (Math.abs(prior.low - candle.close) <= tolerance) nearbyTouches += 1;
    }
    const liquidityDensity = priorLevels.length ? nearbyTouches / (priorLevels.length * 2) : 0;

    const upperWick = candle.high - Math.max(candle.open, candle.close);
    const lowerWick = Math.min(candle.open, candle.close) - candle.low;
    const dominantWick = Math.max(upperWick, lowerWick);
    const boundaryProximity = priorLevels.length
      ? 1 - clamp(Math.min(Math.abs(candle.high - priorHigh), Math.abs(candle.low - priorLow)) / avgLongRange, 0, 1)
      : 0;
    const swingQuality = clamp(safeDiv(dominantWick, currentRange) * boundaryProximity, 0, 1);

    const postSweepDisplacement = this.previousFeatures && this.previousFeatures.SweepDepth !== 0 && this.history.length > 0
      ? clamp(safeDiv(candle.close - (this.history.at(-1)?.close ?? candle.close), avgLongRange), -3, 3)
      : 0;

    const structureShiftAfterSweep = this.previousFeatures && this.previousFeatures.SweepDepth !== 0
      ? internalStructure !== 0 && internalStructure !== this.previousFeatures.InternalStructure
        ? internalStructure
        : 0
      : 0;

    let retestQuality = 0;
    if (this.previousBreakoutDirection !== 0 && this.previousBreakoutLevel !== undefined) {
      const touched = candle.low <= this.previousBreakoutLevel && candle.high >= this.previousBreakoutLevel;
      const held = this.previousBreakoutDirection > 0
        ? candle.close >= this.previousBreakoutLevel
        : candle.close <= this.previousBreakoutLevel;
      if (touched && held) {
        retestQuality = this.previousBreakoutDirection * clamp(
          1 - Math.abs(candle.close - this.previousBreakoutLevel) / avgLongRange,
          0,
          1,
        );
      }
    }

    const compressionRatio = safeDiv(avgShortRange, avgLongRange, 1);
    const compressionDepth = clamp(1 - compressionRatio, 0, 1);
    let compressedCount = 0;
    for (let i = shortRanges.length - 1; i >= 0; i -= 1) {
      const value = shortRanges[i];
      if (value === undefined || value >= avgLongRange * 0.75) break;
      compressedCount += 1;
    }
    const compressionDuration = shortRanges.length ? compressedCount / this.config.compressionLookback : 0;

    const expansionVelocity = clamp(safeDiv(currentRange, avgLongRange, 1) * bodyRatio, 0, 4);
    const trendRangeScore = clamp((internalStructure + externalStructure) / 2, -1, 1);

    const volumes = this.history.slice(-this.config.volumeLookback).map((c) => c.volume);
    const baselineVolume = median(volumes);
    const relativeVolume = baselineVolume > 0 ? candle.volume / baselineVolume : 1;

    const features: CanonicalFeatureVector = {
      InternalStructure: internalStructure,
      ExternalStructure: externalStructure,
      BOSStrength: bosStrength,
      CHOCHStrength: chochStrength,
      SwingQuality: swingQuality,
      RangeBoundary: rangeBoundary,
      BreakoutDisplacement: breakoutDisplacement,
      LiquidityDensity: liquidityDensity,
      SweepDepth: sweepDepth,
      ReclaimQuality: reclaimQuality,
      PostSweepDisplacement: postSweepDisplacement,
      StructureShiftAfterSweep: structureShiftAfterSweep,
      RetestQuality: retestQuality,
      CompressionDepth: compressionDepth,
      CompressionDuration: compressionDuration,
      ExpansionVelocity: expansionVelocity,
      TrendRangeScore: trendRangeScore,
      RelativeVolume: relativeVolume,
    };

    this.history.push({ ...candle });
    this.previousFeatures = features;
    this.previousBreakoutDirection = breakoutDirection;
    this.previousBreakoutLevel = breakoutLevel;

    return { timestamp: candle.timestamp, features };
  }
}
