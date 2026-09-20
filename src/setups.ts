import type { Candle, FeatureRow, SetupEvent } from './types.js';

export interface SetupDetectorConfig {
  breakoutStrength: number;
  sweepStrength: number;
  reclaimStrength: number;
  compressionDepth: number;
  compressionDuration: number;
  expansionVelocity: number;
}

const DEFAULT_CONFIG: SetupDetectorConfig = {
  breakoutStrength: 0.2,
  sweepStrength: 0.15,
  reclaimStrength: 0.05,
  compressionDepth: 0.2,
  compressionDuration: 0.25,
  expansionVelocity: 1.25,
};

function directionFromSign(value: number): 1 | -1 {
  return value >= 0 ? 1 : -1;
}

export function detectSetups(
  candles: Candle[],
  rows: FeatureRow[],
  config: Partial<SetupDetectorConfig> = {},
): SetupEvent[] {
  if (candles.length !== rows.length) throw new Error('candles and feature rows must have equal length');
  const settings = { ...DEFAULT_CONFIG, ...config };
  const events: SetupEvent[] = [];

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const candle = candles[index];
    if (!row || !candle) continue;
    const f = row.features;

    if (Math.abs(f.BOSStrength) >= settings.breakoutStrength) {
      events.push({
        index,
        timestamp: row.timestamp,
        kind: 'breakout',
        direction: directionFromSign(f.BOSStrength),
        strength: Math.abs(f.BOSStrength),
      });
    }

    if (Math.abs(f.SweepDepth) >= settings.sweepStrength && Math.abs(f.ReclaimQuality) >= settings.reclaimStrength) {
      events.push({
        index,
        timestamp: row.timestamp,
        kind: 'liquidity_sweep_reclaim',
        direction: directionFromSign(f.SweepDepth),
        strength: Math.min(3, Math.abs(f.SweepDepth) + Math.abs(f.ReclaimQuality)),
      });
    }

    const previous = rows[index - 1]?.features;
    if (
      previous &&
      previous.CompressionDepth >= settings.compressionDepth &&
      previous.CompressionDuration >= settings.compressionDuration &&
      f.ExpansionVelocity >= settings.expansionVelocity
    ) {
      const body = candle.close - candle.open;
      if (body !== 0) {
        events.push({
          index,
          timestamp: row.timestamp,
          kind: 'compression_release',
          direction: directionFromSign(body),
          strength: f.ExpansionVelocity * (1 + previous.CompressionDepth),
        });
      }
    }
  }

  return events;
}
