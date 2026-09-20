import crypto from 'node:crypto';
import fs from 'node:fs';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const node = process.execPath;
const git = process.platform === 'win32' ? 'git.exe' : 'git';
const cliArgs = process.argv.slice(2);
const publish = cliArgs.includes('--publish');
const positional = cliArgs.filter((arg) => !arg.startsWith('--'));
const symbol = (positional[0] ?? 'BTCUSDT').toUpperCase();
const bars = Number(positional[1] ?? 50000);

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
function sha256(path) { return crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex'); }

const sourceCommit = run(git, ['rev-parse', 'HEAD'], { capture: true });
const oneCsv = `${symbol}-1m-${bars}.csv`;
const fiveCsv = `${symbol}-5m-${bars}.csv`;
const flowCsv = `${symbol}-sonar-orderflow-5m.csv`;

if (!fs.existsSync(oneCsv)) runNode('scripts/fetch-binance.mjs', [symbol, '1m', String(bars), oneCsv]);
if (!fs.existsSync(fiveCsv)) runNode('scripts/fetch-binance.mjs', [symbol, '5m', String(bars), fiveCsv]);
runNode('scripts/fetch-sonar-orderflow.mjs', [symbol, '29', flowCsv]);

const acceptance = 'SONAR_SCALP_V3_ORDERFLOW_ACCEPTANCE.json';
runNode('scripts/run-sonar-v3-orderflow-acceptance.mjs', [oneCsv, fiveCsv, flowCsv, acceptance]);
const result = JSON.parse(fs.readFileSync(acceptance, 'utf8'));
result.sourceCommit = sourceCommit;
result.symbol = symbol;
result.generatedAt = new Date().toISOString();
result.runtime = { node: process.version, platform: process.platform, arch: process.arch };
result.data = {
  oneMinute: { file: oneCsv, bytes: fs.statSync(oneCsv).size, sha256: sha256(oneCsv) },
  fiveMinute: { file: fiveCsv, bytes: fs.statSync(fiveCsv).size, sha256: sha256(fiveCsv) },
  orderflow: { file: flowCsv, bytes: fs.statSync(flowCsv).size, sha256: sha256(flowCsv) },
};
fs.writeFileSync(acceptance, JSON.stringify(result, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({
  status: result.status,
  decision: result.robustness?.decision ?? null,
  orderflowRows: result.robustness?.orderflowCount ?? 0,
  events: result.robustness?.eventCount ?? 0,
}, null, 2));

if (publish) {
  const staged = run(git, ['diff', '--cached', '--name-only'], { capture: true }).split(/\r?\n/).filter(Boolean);
  const foreign = staged.filter((path) => path !== acceptance);
  if (foreign.length) throw new Error(`Refusing to publish unrelated staged files: ${foreign.join(', ')}`);
  run(git, ['config', '--local', 'user.name', 'ttaannsseell73-alt']);
  run(git, ['config', '--local', 'user.email', '254803259+ttaannsseell73-alt@users.noreply.github.com']);
  run(git, ['add', '-f', '--', acceptance]);
  run(git, ['commit', '-m', `evidence: SonarScalp v3 orderflow acceptance ${symbol}`]);
  const currentBranch = run(git, ['branch', '--show-current'], { capture: true });
  if (!currentBranch) throw new Error('Detached HEAD is not supported');
  run(git, ['push', 'origin', `HEAD:${currentBranch}`]);
  console.log('SonarScalp V3 orderflow evidence committed and pushed.');
}
