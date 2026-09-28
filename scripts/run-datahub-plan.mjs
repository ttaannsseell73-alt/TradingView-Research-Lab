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

function monthWindows(startMs, endMs) {
  const windows = [];
  let cursor = startMs;
  while (cursor < endMs) {
    const d = new Date(cursor);
    const nextMonth = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    const stop = Math.min(endMs, nextMonth > cursor ? nextMonth : endMs);
    windows.push({
      key: new Date(cursor).toISOString().slice(0, 7),
      start: cursor,
      end: stop,
    });
    cursor = stop;
  }
  return windows;
}

function fetchCsv({ root, symbol, timeframe, start, end, output }) {
  const sparseVision = String(process.env.VISION_SPARSE_MODE ?? '').toLowerCase() === '1'
    || String(process.env.VISION_SPARSE_MODE ?? '').toLowerCase() === 'true';
  let command;
  let args;
  if (sparseVision) {
    command = process.env.DATAHUB_PYTHON
      ?? process.env.SYSTEM_PYTHON
      ?? (process.platform === 'win32' ? 'python.exe' : 'python3');
    args = [
      path.resolve('scripts/export-binance-vision-sparse.py'),
      '--symbol', symbol,
      '--timeframe', timeframe,
      '--start', start,
      '--end', end,
      '--output', output,
    ];
  } else {
    args = [
      '--root', root,
      'fetch-csv',
      '--symbol', symbol,
      '--timeframe', timeframe,
      '--start', start,
      '--end', end,
      '--output', output,
    ];
    command = process.platform === 'win32' ? 'datahub.exe' : 'datahub';
  }
  const run = spawnSync(command, args, { encoding: 'utf8' });
  if (run.stdout) process.stdout.write(run.stdout);
  if (run.stderr) process.stderr.write(run.stderr);
  if (run.status !== 0) throw new Error(`${sparseVision ? 'Vision sparse' : 'DataHub'} fetch failed for ${symbol} ${timeframe}`);
}

function fetchLocalFeather({ root, symbol, timeframe, start, end, output }) {
  const python = process.env.DATAHUB_PYTHON
    ?? process.env.SYSTEM_PYTHON
    ?? (process.platform === 'win32' ? 'python.exe' : 'python3');
  const bridge = path.resolve('scripts/export-freqtrade-feather.py');
  const args = [
    bridge,
    '--root', root,
    '--symbol', symbol,
    '--timeframe', timeframe,
    '--start', start,
    '--end', end,
    '--output', output,
  ];
  const run = spawnSync(python, args, { encoding: 'utf8' });
  if (run.stdout) process.stdout.write(run.stdout);
  if (run.stderr) process.stderr.write(run.stderr);
  if (run.status !== 0) throw new Error(`Local Feather data unavailable for ${symbol} ${timeframe}`);
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

let progressCommentId = null;
function reportShardProgress(done,total,force=false) {
  const issue = process.env.PROGRESS_ISSUE_NUMBER;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!issue || !repo || !process.env.GH_TOKEN) return;
  if (!force && done !== total && done % 5 !== 0) return;

  const marker = `DATAHUB_SHARD_PROGRESS:${shardIndex}`;
  if (!progressCommentId) {
    const found = spawnSync('gh', [
      'api', `repos/${repo}/issues/${issue}/comments?per_page=100`,
      '--jq', `.[] | select(.body | contains("${marker}")) | .id`
    ], { encoding:'utf8', env:process.env });
    if (found.status === 0) progressCommentId = String(found.stdout || '').trim().split(/\r?\n/).filter(Boolean)[0] ?? null;
  }

  const body = `<!-- ${marker} -->
SHARD_PROGRESS ${shardIndex} ${done} ${total}
Shard ${shardIndex + 1}/${shardCount}: **${done}/${total} coin tamamlandı**`;

  const args = progressCommentId
    ? ['api','--method','PATCH',`repos/${repo}/issues/comments/${progressCommentId}`,'-f',`body=${body}`]
    : ['api','--method','POST',`repos/${repo}/issues/${issue}/comments`,'-f',`body=${body}`,'--jq','.id'];
  const run = spawnSync('gh', args, { encoding:'utf8', env:process.env });
  if (run.status === 0 && !progressCommentId) progressCommentId = String(run.stdout || '').trim() || null;
}

reportShardProgress(0, selectedTasks.length, true);

const results = [];
const monthlyResults = [];
const failures = [];
let processedTasks = 0;
for (const task of selectedTasks) {
  const csvFile = path.join(csvDir, `${task.symbol}-${task.timeframe}.csv`);
  try {
    const localFeatherRoot = process.env.FREQTRADE_FUTURES_ROOT;
    const strictLocal = String(process.env.LOCAL_DATA_MODE ?? '').toLowerCase() === 'strict';
    if (localFeatherRoot) {
      fetchLocalFeather({
        root: localFeatherRoot,
        symbol: task.symbol,
        timeframe: task.timeframe,
        start: plan.start,
        end: plan.end,
        output: csvFile,
      });
    } else if (strictLocal) {
      throw new Error(`LOCAL_DATA_MISSING: FREQTRADE_FUTURES_ROOT is not configured for ${task.symbol} ${task.timeframe}`);
    } else {
      fetchCsv({
        root: dataRoot,
        symbol: task.symbol,
        timeframe: task.timeframe,
        start: plan.start,
        end: plan.end,
        output: csvFile,
      });
    }
    const candles = parseCsv(csvFile).filter((bar) => bar.t >= plan.startMs && bar.t < plan.endMs);
    const lifetimeAware = String(process.env.LIFETIME_AWARE_MODE ?? '').toLowerCase() === '1'
      || String(process.env.LIFETIME_AWARE_MODE ?? '').toLowerCase() === 'true';
    const firstBarMs = candles.length ? candles[0].t : NaN;
    const lastBarMs = candles.length ? candles[candles.length - 1].t : NaN;
    const effectiveStartMs = lifetimeAware && Number.isFinite(firstBarMs)
      ? Math.max(plan.startMs, firstBarMs)
      : plan.startMs;
    const expected = Math.floor((plan.endMs - effectiveStartMs) / TF_MS[task.timeframe]);
    const coverage = expected ? Math.min(1, candles.length / expected) : 0;
    const historyDays = Number.isFinite(firstBarMs) && Number.isFinite(lastBarMs)
      ? (lastBarMs - firstBarMs + TF_MS[task.timeframe]) / 86_400_000
      : 0;
    const minHistoryDays = Number(plan.minHistoryDays ?? 30);
    if (historyDays < minHistoryDays) {
      failures.push({ ...task, reason: 'TOO_SHORT_HISTORY', rows: candles.length, expected, coverage, historyDays, minHistoryDays });
      continue;
    }
    if (coverage < Number(plan.minCoverage ?? 0.98)) {
      failures.push({ ...task, reason: 'PARTIAL_LIFETIME_COVERAGE', rows: candles.length, expected, coverage, historyDays });
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
      strategyIds: plan.strategyIds,
    });

    for (const row of evaluated) {
      results.push({
        ...task,
        start: new Date(effectiveStartMs).toISOString(),
        requestedStart: plan.start,
        end: plan.end,
        rows: candles.length,
        coverage,
        historyDays,
        ...row,
      });
    }

    if (plan.monthlyBreakdown) {
      const monthlyMinTrades = Number(plan.monthlyMinTrades ?? minTrades);
      for (const window of monthWindows(effectiveStartMs, plan.endMs)) {
        const monthCandles = candles.filter((bar) => bar.t >= window.start && bar.t < window.end);
        const expectedMonth = Math.floor((window.end - window.start) / TF_MS[task.timeframe]);
        const monthCoverage = expectedMonth ? monthCandles.length / expectedMonth : 0;
        if (monthCoverage < Number(plan.minCoverage ?? 0.98)) {
          monthlyResults.push({
            ...task,
            month: window.key,
            start: new Date(window.start).toISOString(),
            end: new Date(window.end).toISOString(),
            rows: monthCandles.length,
            coverage: monthCoverage,
            status: 'PARTIAL_COVERAGE',
          });
          continue;
        }

        const monthEvaluated = evaluateStrategies(monthCandles, {
          cost: plan.cost,
          stressCost: plan.stressCost,
          lowCost: plan.lowCost,
          minTrades: monthlyMinTrades,
          start: window.start,
          end: window.end,
          strategyIds: plan.strategyIds,
        });

        for (const row of monthEvaluated) {
          monthlyResults.push({
            ...task,
            month: window.key,
            start: new Date(window.start).toISOString(),
            end: new Date(window.end).toISOString(),
            rows: monthCandles.length,
            coverage: monthCoverage,
            ...row,
          });
        }
      }
    }
  } catch (error) {
    failures.push({ ...task, reason: 'ERROR', error: String(error?.message ?? error) });
  } finally {
    processedTasks += 1;
    reportShardProgress(processedTasks, selectedTasks.length);
  }
}

results.sort((a, b) =>
  Number(b.pass) - Number(a.pass)
  || b.net - a.net
  || b.pf - a.pf
  || a.symbol.localeCompare(b.symbol)
  || a.id.localeCompare(b.id)
);

monthlyResults.sort((a, b) =>
  a.symbol.localeCompare(b.symbol)
  || a.timeframe.localeCompare(b.timeframe)
  || String(a.id ?? '').localeCompare(String(b.id ?? ''))
  || String(a.month ?? '').localeCompare(String(b.month ?? ''))
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
  monthlyBreakdown: Boolean(plan.monthlyBreakdown),
  monthlyCombinations: monthlyResults.filter((r) => r.id).length,
  failures,
  results,
  monthlyResults,
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
  monthlyCombinations: output.monthlyCombinations,
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
