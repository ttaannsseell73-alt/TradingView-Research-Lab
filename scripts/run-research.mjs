import fs from 'node:fs';
import process from 'node:process';
import {
  detectSetups,
  parseCandleCsv,
  replay,
  runWalkForwardStudy,
} from '../dist/index.js';

const path = process.argv[2];
if (!path) {
  console.error('Usage: npm run research -- path/to/candles.csv [horizonBars]');
  process.exit(2);
}
const horizonBars = Number(process.argv[3] ?? 12);
if (!Number.isInteger(horizonBars) || horizonBars < 1) {
  console.error('horizonBars must be a positive integer');
  process.exit(2);
}

const candles = parseCandleCsv(fs.readFileSync(path, 'utf8'));
const replayResult = replay(candles);
const events = detectSetups(candles, replayResult.rows);
const report = runWalkForwardStudy(candles, events, { horizonBars });
console.log(JSON.stringify({
  candles: candles.length,
  replaySignature: replayResult.signature,
  events: events.length,
  report,
}, null, 2));
