import type { Candle } from './types.js';

export interface DataQualityReport {
  candleCount: number;
  firstTimestamp: number;
  lastTimestamp: number;
  inferredIntervalMs: number;
  duplicateTimestamps: number;
  nonIncreasingTimestamps: number;
  invalidOhlc: number;
  negativeVolume: number;
  gapCount: number;
  largestGapMultiple: number;
  pass: boolean;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value = sorted[mid];
  if (value === undefined) return 0;
  if (sorted.length % 2 === 1) return value;
  return ((sorted[mid - 1] ?? value) + value) / 2;
}

export function inspectCandleQuality(candles: Candle[], gapTolerance = 1.5): DataQualityReport {
  if (candles.length < 2) throw new Error('At least two candles are required for data-quality inspection');
  if (!Number.isFinite(gapTolerance) || gapTolerance <= 1) throw new Error('gapTolerance must be > 1');

  const intervals: number[] = [];
  let duplicateTimestamps = 0;
  let nonIncreasingTimestamps = 0;
  let invalidOhlc = 0;
  let negativeVolume = 0;

  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];
    if (!candle) continue;
    if (
      candle.high < candle.low ||
      candle.high < Math.max(candle.open, candle.close) ||
      candle.low > Math.min(candle.open, candle.close)
    ) invalidOhlc += 1;
    if (candle.volume < 0) negativeVolume += 1;

    const previous = candles[index - 1];
    if (!previous) continue;
    const delta = candle.timestamp - previous.timestamp;
    if (delta === 0) duplicateTimestamps += 1;
    if (delta <= 0) nonIncreasingTimestamps += 1;
    if (delta > 0) intervals.push(delta);
  }

  const inferredIntervalMs = median(intervals);
  let gapCount = 0;
  let largestGapMultiple = 1;
  if (inferredIntervalMs > 0) {
    for (const delta of intervals) {
      const multiple = delta / inferredIntervalMs;
      largestGapMultiple = Math.max(largestGapMultiple, multiple);
      if (multiple > gapTolerance) gapCount += 1;
    }
  }

  return {
    candleCount: candles.length,
    firstTimestamp: candles[0]?.timestamp ?? 0,
    lastTimestamp: candles.at(-1)?.timestamp ?? 0,
    inferredIntervalMs,
    duplicateTimestamps,
    nonIncreasingTimestamps,
    invalidOhlc,
    negativeVolume,
    gapCount,
    largestGapMultiple,
    pass:
      duplicateTimestamps === 0 &&
      nonIncreasingTimestamps === 0 &&
      invalidOhlc === 0 &&
      negativeVolume === 0 &&
      gapCount === 0,
  };
}
