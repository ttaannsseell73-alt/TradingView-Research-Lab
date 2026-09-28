import fs from 'node:fs';
import path from 'node:path';

const root = process.env.FREQTRADE_FUTURES_ROOT;
if (!root) throw new Error('FREQTRADE_FUTURES_ROOT is required');

const out = path.resolve(process.argv[2] ?? 'turbo-cache-plan.json');
const start = process.env.TURBO_START ?? '2026-01-01T00:00:00Z';
const end = process.env.TURBO_END ?? '2026-09-20T00:00:00Z';
const timeframes = String(process.env.TURBO_TIMEFRAMES ?? '1m,5m,15m,1h,4h')
  .split(',').map((x) => x.trim()).filter(Boolean);

const suffix = '_USDT_USDT-1m-futures.feather';
const symbols = fs.readdirSync(root, { withFileTypes: true })
  .filter((d) => d.isFile() && d.name.endsWith(suffix))
  .map((d) => d.name.slice(0, -suffix.length).replaceAll('_', '') + 'USDT')
  .sort();

if (!symbols.length) throw new Error('No 1m futures Feather files found');
const plan = {
  backend: 'local',
  symbols,
  timeframes,
  start,
  end,
  strategies: ['pmax'],
};
fs.writeFileSync(out, JSON.stringify(plan), 'utf8');
console.log(JSON.stringify({ out, symbols: symbols.length, timeframes, start, end }));
