import fs from 'node:fs';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const node = process.execPath;
const git = process.platform === 'win32' ? 'git.exe' : 'git';
const cliArgs = process.argv.slice(2);
const publish = cliArgs.includes('--publish');

const DEFAULT_UNIVERSE = [
  'BTCUSDT',
  'ETHUSDT',
  'SOLUSDT',
  'XRPUSDT',
  'DOGEUSDT',
  'AVAXUSDT',
  'ENAUSDT',
  'NEARUSDT',
  'SUIUSDT',
  '1000PEPEUSDT',
  'ARBUSDT',
  'INJUSDT',
];

const explicit = cliArgs.find((arg) => arg.startsWith('--symbols='));
const symbols = explicit
  ? explicit.slice('--symbols='.length).split(',').map((x) => x.trim().toUpperCase()).filter(Boolean)
  : DEFAULT_UNIVERSE;

if (!symbols.length) throw new Error('No symbols selected');
for (const symbol of symbols) {
  if (!/^[A-Z0-9]+$/.test(symbol)) throw new Error(`Invalid symbol: ${symbol}`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = options.capture ? `${result.stdout ?? ''}\n${result.stderr ?? ''}` : '';
    throw new Error(`${command} ${args.join(' ')} failed with exit ${result.status}\n${detail}`);
  }
  return options.capture ? (result.stdout ?? '').trim() : '';
}
function runNode(script, args = []) { run(node, [script, ...args]); }

const sourceCommit = run(git, ['rev-parse', 'HEAD'], { capture: true });
const results = [];

for (const symbol of symbols) {
  console.log(`\n=== SonarScalp V3 ${symbol} ===`);
  const oneCsv = `${symbol}-1m-42000.csv`;
  const fiveCsv = `${symbol}-5m-9000.csv`;
  const flowCsv = `${symbol}-sonar-orderflow-5m.csv`;
  const acceptance = `SONAR_SCALP_V3_ORDERFLOW_${symbol}.json`;

  if (!fs.existsSync(oneCsv)) runNode('scripts/fetch-binance.mjs', [symbol, '1m', '42000', oneCsv]);
  if (!fs.existsSync(fiveCsv)) runNode('scripts/fetch-binance.mjs', [symbol, '5m', '9000', fiveCsv]);
  runNode('scripts/fetch-sonar-orderflow.mjs', [symbol, '29', flowCsv]);
  runNode('scripts/run-sonar-v3-orderflow-acceptance.mjs', [oneCsv, fiveCsv, flowCsv, acceptance]);

  const report = JSON.parse(fs.readFileSync(acceptance, 'utf8'));
  results.push({
    symbol,
    status: report.status,
    eventCount: report.robustness?.eventCount ?? 0,
    decision: report.robustness?.decision ?? null,
    overlapOneMinuteCount: report.robustness?.overlapOneMinuteCount ?? 0,
  });
}

const promotable = results.filter((item) => item.status === 'PROMOTION_CANDIDATE').map((item) => item.symbol);
const summary = {
  strategy: 'SONAR_SCALP_V3_ORDERFLOW_UNIVERSE',
  sourceCommit,
  generatedAt: new Date().toISOString(),
  symbols,
  results,
  promotable,
  status: promotable.length ? 'PROMOTION_CANDIDATES_FOUND' : 'NO_PROMOTABLE_SYMBOL',
};
const summaryPath = 'SONAR_SCALP_V3_UNIVERSE.json';
fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + '\n', 'utf8');
console.log('\n=== Universe result ===');
console.log(JSON.stringify(summary, null, 2));

if (publish) {
  const allowed = new Set([
    summaryPath,
    ...symbols.map((symbol) => `SONAR_SCALP_V3_ORDERFLOW_${symbol}.json`),
  ]);
  const staged = run(git, ['diff', '--cached', '--name-only'], { capture: true })
    .split(/\r?\n/)
    .filter(Boolean);
  const foreign = staged.filter((path) => !allowed.has(path));
  if (foreign.length) throw new Error(`Refusing to publish unrelated staged files: ${foreign.join(', ')}`);

  run(git, ['config', '--local', 'user.name', 'ttaannsseell73-alt']);
  run(git, ['config', '--local', 'user.email', '254803259+ttaannsseell73-alt@users.noreply.github.com']);
  run(git, ['add', '-f', '--', summaryPath, ...symbols.map((symbol) => `SONAR_SCALP_V3_ORDERFLOW_${symbol}.json`)]);
  run(git, ['commit', '-m', 'evidence: SonarScalp v3 multi-symbol universe']);
  const currentBranch = run(git, ['branch', '--show-current'], { capture: true });
  run(git, ['push', 'origin', `HEAD:${currentBranch}`]);
  console.log('Multi-symbol SonarScalp V3 evidence committed and pushed.');
}
