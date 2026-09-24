import fs from 'node:fs';
import path from 'node:path';
import { evaluateStrategies } from '../research/strategy_engine_v2.mjs';

const shard = Number(process.argv[2]);
const dataDir = process.argv[3];
const outFile = process.argv[4];
if (!Number.isInteger(shard) || !dataDir || !outFile) {
  console.error('Usage: node scripts/run-kivanc-offline-shard.mjs SHARD DATA_DIR OUT.json');
  process.exit(2);
}
const START = Date.parse('2026-06-24T00:00:00Z');
const END = Date.parse('2026-09-24T00:00:00Z');
const expected = Math.round((END - START) / 3600000);
const manifestPath = path.join(dataDir, 'manifest.json');
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : [];
const metaBy = new Map(manifest.map(x => [x.symbol, x]));
const results = [];
const failures = [];
for (const name of fs.readdirSync(dataDir).filter(x => x.endsWith('.csv')).sort()) {
  const symbol = name.slice(0, -4);
  const lines = fs.readFileSync(path.join(dataDir, name), 'utf8').trim().split(/\r?\n/).slice(1);
  const candles = [];
  for (const line of lines) {
    const a = line.split(',');
    if (a.length < 6) continue;
    candles.push({ t:+a[0], o:+a[1], h:+a[2], l:+a[3], c:+a[4], v:+a[5] });
  }
  if (candles.length < expected * 0.8) {
    failures.push({symbol, reason:'PARTIAL_COVERAGE', candles:candles.length, expected});
    continue;
  }
  for (const r of evaluateStrategies(candles, {cost:0.0014, stressCost:0.0015, lowCost:0.0006, start:START, end:END})) {
    results.push({symbol, timeframe:'1h', candles:candles.length, coverage:candles.length/expected, ...r});
  }
}
for (const m of manifest) {
  if (!m.file && !failures.some(f => f.symbol === m.symbol)) failures.push({symbol:m.symbol, reason:'NO_DATA', errors:m.errors});
}
fs.mkdirSync(path.dirname(outFile), {recursive:true});
fs.writeFileSync(outFile, JSON.stringify({shard, expectedCandles:expected, results, failures}, null, 2)+'\n');
console.log(JSON.stringify({shard, combinations:results.length, testedSymbols:new Set(results.map(r=>r.symbol)).size, failures:failures.length}));
