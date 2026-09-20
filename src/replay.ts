import { FeatureEngine, type FeatureEngineConfig } from './featureEngine.js';
import type { Candle, FeatureRow } from './types.js';

export interface ReplayResult {
  rows: FeatureRow[];
  signature: string;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}

function fnv1a32(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function replay(
  candles: Candle[],
  config: Partial<FeatureEngineConfig> = {},
): ReplayResult {
  const engine = new FeatureEngine(config);
  const rows = candles.map((candle) => engine.process(candle));
  return { rows, signature: fnv1a32(stableStringify(rows)) };
}
