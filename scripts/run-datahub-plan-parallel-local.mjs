import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { spawnSync } from 'node:child_process';

function fail(message) {
  console.error(message);
  process.exit(2);
}

function readPlan(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, '');
  const plan = JSON.parse(raw);
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) fail('Plan must be a JSON object');
  if (!Array.isArray(plan.symbols) || !plan.symbols.length) fail('Plan symbols must be non-empty');
  if (!Array.isArray(plan.timeframes) || !plan.timeframes.length) fail('Plan timeframes must be non-empty');
  return plan;
}

function localCacheKey(plan) {
  return [
    String(plan.start).slice(0, 10),
    String(plan.end).slice(0, 10),
    [...new Set(plan.timeframes)].sort().join('-'),
  ].join('__').replace(/[^0-9A-Za-z._-]+/gu, '_');
}

function prepareBatchCache({ root, planFile, outputDir }) {
  const python = process.env.DATAHUB_PYTHON
    ?? process.env.SYSTEM_PYTHON
    ?? (process.platform === 'win32' ? 'python.exe' : 'python3');
  const bridge = path.resolve('scripts/export-freqtrade-feather-batch.py');
  fs.mkdirSync(outputDir, { recursive: true });
  const run = spawnSync(python, [
    bridge,
    '--root', root,
    '--plan', path.resolve(planFile),
    '--output-dir', outputDir,
  ], { encoding: 'utf8' });
  if (run.stdout) process.stdout.write(run.stdout);
  if (run.stderr) process.stderr.write(run.stderr);
  if (run.status !== 0) fail('Batch cache prepare failed with status ' + run.status);
}

function runShard({ planFile, index, count, cacheDir }) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ['scripts/run-datahub-plan-checkpointed.mjs', path.resolve(planFile), String(index), String(count)],
      {
        stdio: 'inherit',
        env: {
          ...process.env,
          SHARD_INDEX: String(index),
          SHARD_COUNT: String(count),
          BATCH_LOCAL_CACHE: '0',
          REUSE_EXISTING_CSV: '1',
          RESEARCH_CSV_DIR: cacheDir,
        },
      },
    );
    child.on('exit', (code, signal) => resolve({ index, code, signal }));
  });
}

const planFile = process.argv[2];
if (!planFile) fail('Usage: node scripts/run-datahub-plan-parallel-local.mjs PLAN.json');

const root = process.env.FREQTRADE_FUTURES_ROOT;
if (!root) fail('FREQTRADE_FUTURES_ROOT is required');

const plan = readPlan(planFile);
const dataRoot = process.env.DATAHUB_ROOT
  ?? process.env.DATAHUB_LOCAL_ROOT
  ?? (process.platform === 'win32' ? 'D:/Futures-Research-Data' : path.resolve('.datahub-local'));

const requested = Number(process.env.LOCAL_PARALLEL_SHARDS ?? 4);
const available = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
const taskCount = new Set(plan.symbols).size * new Set(plan.timeframes).size;
const shardCount = Math.max(1, Math.min(
  Number.isInteger(requested) && requested > 0 ? requested : 4,
  Math.max(1, available),
  Math.max(1, taskCount),
));

const cacheDir = path.resolve(
  process.env.RESEARCH_CSV_DIR
    ?? path.join(dataRoot, 'research-cache', localCacheKey(plan)),
);
const outDir = path.resolve(process.env.RESEARCH_OUT_DIR ?? 'artifacts/hybrid-research');
fs.mkdirSync(outDir, { recursive: true });

for (const name of fs.readdirSync(outDir)) {
  const full = path.join(outDir, name);
  const checkpointMatch = /^checkpoints-\d+-of-(\d+)$/u.exec(name);
  if (checkpointMatch && Number(checkpointMatch[1]) !== shardCount) {
    fs.rmSync(full, { recursive: true, force: true });
    continue;
  }
  if (/^(?:summary|top|results|monthly|failures)-.*-(?:\d+)-of-(?:\d+)\.(?:json|csv|ndjson)$/u.test(name)) {
    fs.rmSync(full, { force: true });
  }
}

const started = Date.now();
prepareBatchCache({ root, planFile, outputDir: cacheDir });
console.log(JSON.stringify({
  parallelLocal: 'CACHE_READY',
  cacheDir,
  shards: shardCount,
  availableParallelism: available,
  cachePrepareMs: Date.now() - started,
}));

const results = await Promise.all(
  Array.from({ length: shardCount }, (_, index) => runShard({
    planFile,
    index,
    count: shardCount,
    cacheDir,
  })),
);

const failed = results.filter((result) => result.code !== 0);
console.log(JSON.stringify({
  parallelLocal: failed.length ? 'FAILED' : 'COMPLETE',
  shards: shardCount,
  results,
  elapsedMs: Date.now() - started,
}));

if (failed.length) process.exitCode = 1;
