import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { STRATEGIES, evaluateStrategies } from '../research/strategy_engine_v2.mjs';

const TF_MS = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
};

const DEFAULT_MIN_TRADES = {
  '1m': 50,
  '5m': 30,
  '15m': 25,
  '1h': 20,
  '4h': 10,
};

function fail(message) {
  console.error(message);
  process.exit(2);
}

function readPlan(file) {
  const plan = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) fail('Plan must be a JSON object');
  if (!['cloud', 'local', 'hybrid'].includes(plan.backend)) fail('backend must be cloud|local|hybrid');
  if (!Array.isArray(plan.symbols) || !plan.symbols.length) fail('symbols must be a nonempty array');
  if (!Array.isArray(plan.timeframes) || !plan.timeframes.length) fail('timeframes must be a nonempty array');

  for (const symbol of plan.symbols) {
    if (
      typeof symbol !== 'string'
      || symbol.length < 1
      || symbol.length > 100
      || symbol === '.'
      || symbol === '..'
      || /[\\/<>:"|?*\u0000-\u001F\u007F]/u.test(symbol)
      || /[. ]$/u.test(symbol)
    ) fail(`Unsafe symbol: ${symbol}`);
  }
  for (const tf of plan.timeframes) {
    if (!TF_MS[tf]) fail(`Unsupported timeframe: ${tf}`);
  }

  const start = Date.parse(plan.start);
  const end = Date.parse(plan.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
    fail('start/end must be valid ISO timestamps with start < end');
  }

  const available = new Set(STRATEGIES.map((s) => s.id));
  const strategyIds =
    !plan.strategies || plan.strategies === '*'
      ? [...available]
      : plan.strategies;
  if (!Array.isArray(strategyIds) || !strategyIds.length) fail('strategies must be "*" or a nonempty array');
  for (const id of strategyIds) if (!available.has(id)) fail(`Unknown strategy: ${id}`);

  return {
    ...plan,
    startMs: start,
    endMs: end,
    strategyIds,
    cost: Number(plan.cost ?? 0.0014),
    stressCost: Number(plan.stressCost ?? 0.0015),
    lowCost: Number(plan.lowCost ?? 0.0006),
  };
}

function parseCsv(file) {
  const lines = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  return lines.slice(1).map((line) => {
    const [t, o, h, l, c, v] = line.split(',').map(Number);
    return { t, o, h, l, c, v };
  }).filter((b) => [b.t, b.o, b.h, b.l, b.c, b.v].every(Number.isFinite));
}

function fetchCsv({ root, symbol, timeframe, start, end, output }) {
  const args = [
    '--root', root,
    'fetch-csv',
    '--symbol', symbol,
    '--timeframe', timeframe,
    '--start', start,
    '--end', end,
    '--output', output,
  ];
  const command = process.platform === 'win32' ? 'datahub.exe' : 'datahub';
  const run = spawnSync(command, args, { encoding: 'utf8' });
  if (run.stdout) process.stdout.write(run.stdout);
  if (run.stderr) process.stderr.write(run.stderr);
  if (run.status !== 0) throw new Error(`DataHub fetch failed for ${symbol} ${timeframe}`);
}

const planFile = process.argv[2];
if (!planFile) fail('Usage: node scripts/run-datahub-plan.mjs PLAN.json [SHARD_INDEX] [SHARD_COUNT]');

const shardIndex = Number(process.argv[3] ?? process.env.SHARD_INDEX ?? 0);
const shardCount = Number(process.argv[4] ?? process.env.SHARD_COUNT ?? 1);
if (!Number.isInteger(shardIndex) || !Number.isInteger(shardCount) || shardCount < 1 || shardIndex < 0 || shardIndex >= shardCount) {
  fail('Invalid shard index/count');
}

const plan = readPlan(planFile);
const dataRoot = process.env.DATAHUB_ROOT
  ?? process.env.DATAHUB_LOCAL_ROOT
  ?? (process.platform === 'win32' ? 'D:/Futures-Research-Data' : path.resolve('.datahub-cloud'));
const outDir = path.resolve(process.env.RESEARCH_OUT_DIR ?? 'artifacts/hybrid-research');
const csvDir = path.join(outDir, 'csv');
fs.mkdirSync(csvDir, { recursive: true });

const tasks = [];
for (const symbol of [...new Set(plan.symbols)].sort()) {
  for (const timeframe of [...new Set(plan.timeframes)].sort()) tasks.push({ symbol, timeframe });
}
const selectedTasks = tasks.filter((_, index) => index % shardCount === shardIndex);

const results = [];
const failures = [];
for (const task of selectedTasks) {
  const csvFile = path.join(csvDir, `${task.symbol}-${task.timeframe}.csv`);
  try {
    fetchCsv({
      root: dataRoot,
      symbol: task.symbol,
      timeframe: task.timeframe,
      start: plan.start,
      end: plan.end,
      output: csvFile,
    });
    const candles = parseCsv(csvFile);
    const expected = Math.floor((plan.endMs - plan.startMs) / TF_MS[task.timeframe]);
    const coverage = expected ? candles.length / expected : 0;
    if (coverage < Number(plan.minCoverage ?? 0.98)) {
      failures.push({ ...task, reason: 'PARTIAL_COVERAGE', rows: candles.length, expected, coverage });
      continue;
    }

    const minTrades = Number(
      typeof plan.minTrades === 'number'
        ? plan.minTrades
        : plan.minTrades?.[task.timeframe] ?? DEFAULT_MIN_TRADES[task.timeframe]
    );
    const evaluated = evaluateStrategies(candles, {
      cost: plan.cost,
      stressCost: plan.stressCost,
      lowCost: plan.lowCost,
      minTrades,
      start: plan.startMs,
      end: plan.endMs,
    }).filter((row) => plan.strategyIds.includes(row.id));

    for (const row of evaluated) {
      results.push({
        ...task,
        start: plan.start,
        end: plan.end,
        rows: candles.length,
        coverage,
        ...row,
      });
    }
  } catch (error) {
    failures.push({ ...task, reason: 'ERROR', error: String(error?.message ?? error) });
  }
}

results.sort((a, b) =>
  Number(b.pass) - Number(a.pass)
  || b.net - a.net
  || b.pf - a.pf
  || a.symbol.localeCompare(b.symbol)
  || a.id.localeCompare(b.id)
);

const backend = process.env.RESEARCH_BACKEND ?? plan.backend;
const output = {
  schemaVersion: 1,
  backend,
  shardIndex,
  shardCount,
  dataRoot,
  start: plan.start,
  end: plan.end,
  requestedStrategies: plan.strategyIds,
  tasks: selectedTasks.length,
  combinations: results.length,
  passing: results.filter((r) => r.pass).length,
  failures,
  results,
};

const resultFile = path.join(outDir, `result-${backend}-${shardIndex}-of-${shardCount}.json`);
fs.writeFileSync(resultFile, JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify({
  resultFile,
  backend,
  shardIndex,
  shardCount,
  tasks: selectedTasks.length,
  combinations: results.length,
  passing: output.passing,
  failures: failures.length,
}));

const hardFailures = failures.filter((failure) => failure.reason === 'ERROR');
const maxErrorRate = Number(plan.maxErrorRate ?? 0.10);
if (
  selectedTasks.length > 0
  && hardFailures.length / selectedTasks.length > maxErrorRate
) {
  process.exitCode = 1;
}
