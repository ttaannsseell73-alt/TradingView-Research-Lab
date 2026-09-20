import fs from 'node:fs';
import process from 'node:process';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const node = process.execPath;
const git = process.platform === 'win32' ? 'git.exe' : 'git';
const args = process.argv.slice(2);
const publish = args.includes('--publish');
const positional = args.filter((arg) => arg !== '--publish');
const symbol = (positional[0] ?? 'BTCUSDT').toUpperCase();
const bars = Number(positional[1] ?? 50000);

if (!/^[A-Z0-9]+$/.test(symbol)) throw new Error('Invalid symbol');
if (!Number.isInteger(bars) || bars < 10000 || bars > 100000) {
  throw new Error('bars must be an integer between 10000 and 100000');
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = options.capture ? `${result.stdout ?? ''}\n${result.stderr ?? ''}` : '';
    throw new Error(`${command} ${commandArgs.join(' ')} failed with exit ${result.status}\n${detail}`);
  }
  return options.capture ? (result.stdout ?? '').trim() : '';
}

function runNode(script, scriptArgs = []) {
  run(node, [script, ...scriptArgs]);
}

function sha256(path) {
  return crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex');
}

const sourceCommit = run(git, ['rev-parse', 'HEAD'], { capture: true });
const evidence = [];
for (const timeframe of ['1m', '5m']) {
  const csv = `${symbol}-${timeframe}-${bars}.csv`;
  const json = `${symbol}-${timeframe}-acceptance.json`;
  runNode('scripts/fetch-binance.mjs', [symbol, timeframe, String(bars), csv]);
  runNode('scripts/run-acceptance.mjs', [csv, json]);
  evidence.push({
    timeframe,
    data: {
      file: csv,
      bytes: fs.statSync(csv).size,
      sha256: sha256(csv),
    },
    acceptanceFile: json,
    result: JSON.parse(fs.readFileSync(json, 'utf8')),
  });
}

const promotable = evidence.flatMap((item) =>
  item.result.promotableSetups.map((setup) => ({ timeframe: item.timeframe, setup })),
);

const final = {
  schemaVersion: 1,
  sourceCommit,
  symbol,
  barsPerTimeframe: bars,
  generatedAt: new Date().toISOString(),
  runtime: { node: process.version, platform: process.platform, arch: process.arch },
  status: promotable.length ? 'PROMOTION_CANDIDATES_PRESENT' : 'NO_PROMOTABLE_SETUP',
  promotable,
  evidence,
};

fs.writeFileSync('FINAL_ACCEPTANCE.json', JSON.stringify(final, null, 2) + '\n', 'utf8');
console.log('\nFINAL_ACCEPTANCE.json written.');
console.log(JSON.stringify({ status: final.status, promotable: final.promotable }, null, 2));

if (publish) {
  const staged = run(git, ['diff', '--cached', '--name-only'], { capture: true });
  if (staged) throw new Error('Refusing to publish because unrelated staged Git changes already exist');

  const evidencePaths = [
    'FINAL_ACCEPTANCE.json',
    ...evidence.map((item) => item.acceptanceFile),
  ];
  run(git, ['add', '-f', '--', ...evidencePaths]);
  run(git, ['commit', '-m', `evidence: final local acceptance ${symbol}`]);
  run(git, ['push', 'origin', 'HEAD:main']);
  console.log('Acceptance evidence committed and pushed to main.');
}
