import fs from 'node:fs';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const git = process.platform === 'win32' ? 'git.exe' : 'git';
const symbol = (process.argv[2] ?? 'BTCUSDT').toUpperCase();

if (!/^[A-Z0-9]+$/.test(symbol)) throw new Error('Invalid symbol');

function run(args, options = {}) {
  const result = spawnSync(git, args, {
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = options.capture ? `${result.stdout ?? ''}\n${result.stderr ?? ''}` : '';
    throw new Error(`git ${args.join(' ')} failed with exit ${result.status}\n${detail}`);
  }
  return options.capture ? (result.stdout ?? '').trim() : '';
}

const evidencePaths = [
  'FINAL_ACCEPTANCE.json',
  `${symbol}-1m-acceptance.json`,
  `${symbol}-5m-acceptance.json`,
];

for (const path of evidencePaths) {
  if (!fs.existsSync(path)) throw new Error(`Missing evidence file: ${path}`);
}

const allowed = new Set(evidencePaths);
const staged = run(['diff', '--cached', '--name-only'], { capture: true })
  .split(/\r?\n/)
  .filter(Boolean);

const foreign = staged.filter((path) => !allowed.has(path));
if (foreign.length) {
  throw new Error(`Refusing to publish unrelated staged files: ${foreign.join(', ')}`);
}

run(['config', '--local', 'user.name', 'ttaannsseell73-alt']);
run(['config', '--local', 'user.email', '254803259+ttaannsseell73-alt@users.noreply.github.com']);

run(['add', '-f', '--', ...evidencePaths]);

const changed = run(['diff', '--cached', '--name-only'], { capture: true });
if (!changed) {
  console.log('No new evidence changes to publish.');
  process.exit(0);
}

run(['commit', '-m', `evidence: final local acceptance ${symbol}`]);
run(['push', 'origin', 'HEAD:main']);
console.log('Acceptance evidence committed and pushed to main.');
