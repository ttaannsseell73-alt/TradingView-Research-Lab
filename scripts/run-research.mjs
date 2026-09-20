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
  console.error('Usage: npm run research -- path/to/candles.csv [horizonBars] [feeRate] [slippageRate]');
  process.exit(2);
}
const horizonBars = Number(process.argv[3] ?? 12);
const feeRate = Number(process.argv[4] ?? 0.0004);
const slippageRate = Number(process.argv[5] ?? 0.0001);
if (!Number.isInteger(horizonBars) || horizonBars < 1) {
  console.error('horizonBars must be a positive integer');
  process.exit(2);
}
if (![feeRate, slippageRate].every((value) => Number.isFinite(value) && value >= 0)) {
  console.error('feeRate and slippageRate must be non-negative finite numbers');
  process.exit(2);
}

const candles = parseCandleCsv(fs.readFileSync(path, 'utf8'));
const replayResult = replay(candles);
const events = detectSetups(candles, replayResult.rows);
const report = runWalkForwardStudy(candles, events, { horizonBars, feeRate, slippageRate });
console.log(JSON.stringify({
  candles: candles.length,
  replaySignature: replayResult.signature,
  events: events.length,
  assumptions: {
    horizonBars,
    feeRate,
    slippageRate,
    roundTripCost: 2 * (feeRate + slippageRate),
  },
  report,
}, null, 2));
