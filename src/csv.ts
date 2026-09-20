import type { Candle } from './types.js';

const REQUIRED = ['timestamp', 'open', 'high', 'low', 'close', 'volume'] as const;

function parseNumber(value: string | undefined, field: string, line: number): number {
  if (value === undefined || value.trim() === '') throw new Error(`Missing ${field} at CSV line ${line}`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid ${field} at CSV line ${line}`);
  return parsed;
}

export function parseCandleCsv(text: string): Candle[] {
  const lines = text.replace(/\r/g, '').split('\n').filter((line) => line.trim() !== '');
  if (lines.length < 2) throw new Error('CSV must contain a header and at least one row');
  const header = (lines[0] ?? '').split(',').map((value) => value.trim().toLowerCase());
  const index = new Map(header.map((name, i) => [name, i]));
  for (const name of REQUIRED) if (!index.has(name)) throw new Error(`CSV missing required column: ${name}`);

  const candles: Candle[] = [];
  for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
    const cells = (lines[lineIndex] ?? '').split(',').map((value) => value.trim());
    const get = (name: typeof REQUIRED[number]) => cells[index.get(name) ?? -1];
    candles.push({
      timestamp: parseNumber(get('timestamp'), 'timestamp', lineIndex + 1),
      open: parseNumber(get('open'), 'open', lineIndex + 1),
      high: parseNumber(get('high'), 'high', lineIndex + 1),
      low: parseNumber(get('low'), 'low', lineIndex + 1),
      close: parseNumber(get('close'), 'close', lineIndex + 1),
      volume: parseNumber(get('volume'), 'volume', lineIndex + 1),
      closed: true,
    });
  }
  return candles;
}
