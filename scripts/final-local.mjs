import fs from 'node:fs';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const symbol = (process.argv[2] ?? 'BTCUSDT').toUpperCase();
const bars = Number(process.argv[3] ?? 50000);

if (!/^[A-Z0-9]+$/.test(symbol)) throw new Error('Invalid symbol');
if (!Number.isInteger(bars) || bars < 10000 || bars > 100000) {
  throw new Error('bars must be an integer between 10000 and 100000');
}

function run(args) {
  const result = spawnSync(npm, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const evidence = [];
for (const timeframe of ['1m', '5m']) {
  const csv = `${symbol}-${timeframe}-${bars}.csv`;
  const json = `${symbol}-${timeframe}-acceptance.json`;
  run(['run', 'fetch:binance', '--', symbol, timeframe, String(bars), csv]);
  run(['run', 'acceptance', '--', csv, json]);
  evidence.push({ timeframe, file: json, result: JSON.parse(fs.readFileSync(json, 'utf8')) });
}

const promotable = evidence.flatMap((item) =>
  item.result.promotableSetups.map((setup) => ({ timeframe: item.timeframe, setup })),
);

const final = {
  symbol,
  barsPerTimeframe: bars,
  generatedAt: new Date().toISOString(),
  status: promotable.length ? 'PROMOTION_CANDIDATES_PRESENT' : 'NO_PROMOTABLE_SETUP',
  promotable,
  evidence,
};

fs.writeFileSync('FINAL_ACCEPTANCE.json', JSON.stringify(final, null, 2) + '\n', 'utf8');
console.log('\nFINAL_ACCEPTANCE.json written.');
console.log(JSON.stringify({ status: final.status, promotable: final.promotable }, null, 2));
