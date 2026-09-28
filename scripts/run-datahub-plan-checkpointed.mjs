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
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, '');
  const plan = JSON.parse(raw);
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
    ) fail('Unsafe symbol: ' + symbol);
  }
  for (const tf of plan.timeframes) {
    if (!TF_MS[tf]) fail('Unsupported timeframe: ' + tf);
  }

  const start = Date.parse(plan.start);
  const end = Date.parse(plan.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
    fail('start/end must be valid ISO timestamps with start < end');
  }

  const available = new Set(STRATEGIES.map((s) => s.id));
  const strategyIds = !plan.strategies || plan.strategies === '*' ? [...available] : plan.strategies;
  if (!Array.isArray(strategyIds) || !strategyIds.length) fail('strategies must be "*" or a nonempty array');
  for (const id of strategyIds) if (!available.has(id)) fail('Unknown strategy: ' + id);

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
  const raw = fs.readFileSync(file, 'utf8').trim();
  if (!raw) return [];
  const lines = raw.split(/\r?\n/);
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
  const args = ['--root', root, 'fetch-csv', '--symbol', symbol, '--timeframe', timeframe, '--start', start, '--end', end, '--output', output];
  const command = process.platform === 'win32' ? 'datahub.exe' : 'datahub';
  const run = spawnSync(command, args, { encoding: 'utf8' });
  if (run.stdout) process.stdout.write(run.stdout);
  if (run.stderr) process.stderr.write(run.stderr);
  if (run.status !== 0) throw new Error('DataHub fetch failed for ' + symbol + ' ' + timeframe);
}

function fetchLocalFeather({ root, symbol, timeframe, start, end, output }) {
  const python = process.env.DATAHUB_PYTHON
    ?? process.env.SYSTEM_PYTHON
    ?? (process.platform === 'win32' ? 'python.exe' : 'python3');
  const bridge = path.resolve('scripts/export-freqtrade-feather.py');
  const args = [bridge, '--root', root, '--symbol', symbol, '--timeframe', timeframe, '--start', start, '--end', end, '--output', output];
  const run = spawnSync(python, args, { encoding: 'utf8' });
  if (run.stdout) process.stdout.write(run.stdout);
  if (run.stderr) process.stderr.write(run.stderr);
  if (run.status !== 0) throw new Error('Local Feather data unavailable for ' + symbol + ' ' + timeframe);
}

function localCacheKey(plan) {
  return [
    String(plan.start).slice(0, 10),
    String(plan.end).slice(0, 10),
    [...new Set(plan.timeframes)].sort().join('-'),
  ].join('__').replace(/[^0-9A-Za-z._-]+/gu, '_');
}

function prepareLocalBatchCache({ root, planFile, outputDir }) {
  const python = process.env.DATAHUB_PYTHON
    ?? process.env.SYSTEM_PYTHON
    ?? (process.platform === 'win32' ? 'python.exe' : 'python3');
  const bridge = path.resolve('scripts/export-freqtrade-feather-batch.py');
  const args = [
    bridge,
    '--root', root,
    '--plan', path.resolve(planFile),
    '--output-dir', outputDir,
  ];
  const run = spawnSync(python, args, { encoding: 'utf8' });
  if (run.stdout) process.stdout.write(run.stdout);
  if (run.stderr) process.stderr.write(run.stderr);
  return run.status === 0;
}

function fileReady(file) {
  try {
    return fs.statSync(file).size > 32;
  } catch {
    return false;
  }
}

function writeJsonAtomic(file, value) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value) + '\n', 'utf8');
  if (fs.existsSync(file)) fs.unlinkSync(file);
  fs.renameSync(tmp, file);
}

function createBufferedAppender(file, flushBytes = 4 * 1024 * 1024) {
  fs.writeFileSync(file, '', 'utf8');
  let buffer = '';
  return {
    addRows(rows) {
      if (!rows.length) return;
      buffer += rows.map((row) => JSON.stringify(row)).join('\n') + '\n';
      if (buffer.length >= flushBytes) {
        fs.appendFileSync(file, buffer, 'utf8');
        buffer = '';
      }
    },
    flush() {
      if (!buffer) return;
      fs.appendFileSync(file, buffer, 'utf8');
      buffer = '';
    },
  };
}

function candlesByWindows(candles, windows) {
  const groups = [];
  let cursor = 0;
  for (const window of windows) {
    while (cursor < candles.length && candles[cursor].t < window.start) cursor += 1;
    const startIndex = cursor;
    while (cursor < candles.length && candles[cursor].t < window.end) cursor += 1;
    groups.push({ window, candles: candles.slice(startIndex, cursor) });
  }
  return groups;
}

function compareRows(a, b) {
  return Number(b.pass) - Number(a.pass)
    || Number(b.net ?? -Infinity) - Number(a.net ?? -Infinity)
    || Number(b.pf ?? -Infinity) - Number(a.pf ?? -Infinity)
    || String(a.symbol ?? '').localeCompare(String(b.symbol ?? ''))
    || String(a.id ?? '').localeCompare(String(b.id ?? ''));
}

function csvEscape(value) {
  if (value == null) return '';
  const s = String(value);
  return /[",\r\n]/u.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

const planFile = process.argv[2];
if (!planFile) fail('Usage: node scripts/run-datahub-plan-checkpointed.mjs PLAN.json [SHARD_INDEX] [SHARD_COUNT]');

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
const localFeatherRoot = process.env.FREQTRADE_FUTURES_ROOT;
const defaultCsvDir = localFeatherRoot
  ? path.join(dataRoot, 'research-cache', localCacheKey(plan))
  : path.join(outDir, 'csv');
const csvDir = path.resolve(process.env.RESEARCH_CSV_DIR ?? defaultCsvDir);
const checkpointDir = path.join(outDir, 'checkpoints-' + shardIndex + '-of-' + shardCount);
fs.mkdirSync(csvDir, { recursive: true });
fs.mkdirSync(checkpointDir, { recursive: true });

const tasks = [];
for (const symbol of [...new Set(plan.symbols)].sort()) {
  for (const timeframe of [...new Set(plan.timeframes)].sort()) tasks.push({ symbol, timeframe });
}
const selectedTasks = tasks.filter((_, index) => index % shardCount === shardIndex);

const batchLocalRequested = Boolean(localFeatherRoot)
  && shardCount === 1
  && !['0', 'false', 'off'].includes(String(process.env.BATCH_LOCAL_CACHE ?? '1').toLowerCase());
let batchLocalPrepared = false;
if (batchLocalRequested) {
  const started = Date.now();
  batchLocalPrepared = prepareLocalBatchCache({
    root: localFeatherRoot,
    planFile,
    outputDir: csvDir,
  });
  console.log(JSON.stringify({
    localBatchCache: batchLocalPrepared ? 'READY' : 'PARTIAL_FALLBACK',
    csvDir,
    elapsedMs: Date.now() - started,
  }));
}

let progressCommentId = null;
function reportShardProgress(done, total, force = false) {
  const issue = process.env.PROGRESS_ISSUE_NUMBER;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!issue || !repo || !process.env.GH_TOKEN) return;
  if (!force && done !== total && done % 5 !== 0) return;

  const marker = 'DATAHUB_SHARD_PROGRESS:' + shardIndex;
  if (!progressCommentId) {
    const found = spawnSync('gh', [
      'api', 'repos/' + repo + '/issues/' + issue + '/comments?per_page=100',
      '--jq', '.[] | select(.body | contains("' + marker + '")) | .id',
    ], { encoding: 'utf8', env: process.env });
    if (found.status === 0) {
      progressCommentId = String(found.stdout || '').trim().split(/\r?\n/).filter(Boolean)[0] ?? null;
    }
  }

  const body = '<!-- ' + marker + ' -->\n'
    + 'SHARD_PROGRESS ' + shardIndex + ' ' + done + ' ' + total + '\n'
    + 'Shard ' + (shardIndex + 1) + '/' + shardCount + ': **' + done + '/' + total + ' görev tamamlandı**';

  const args = progressCommentId
    ? ['api', '--method', 'PATCH', 'repos/' + repo + '/issues/comments/' + progressCommentId, '-f', 'body=' + body]
    : ['api', '--method', 'POST', 'repos/' + repo + '/issues/' + issue + '/comments', '-f', 'body=' + body, '--jq', '.id'];
  const run = spawnSync('gh', args, { encoding: 'utf8', env: process.env });
  if (run.status === 0 && !progressCommentId) progressCommentId = String(run.stdout || '').trim() || null;
}

const state = {
  completed: 0,
  combinations: 0,
  passing: 0,
  monthlyCombinations: 0,
  failures: 0,
  hardFailures: 0,
  topResults: [],
};

function aggregateCheckpoint(cp) {
  state.completed += 1;
  state.combinations += cp.results.length;
  state.passing += cp.results.filter((r) => r.pass).length;
  state.monthlyCombinations += cp.monthlyResults.filter((r) => r.id).length;
  if (cp.failure) {
    state.failures += 1;
    if (cp.failure.reason === 'ERROR') state.hardFailures += 1;
  }
  if (cp.results.length) {
    state.topResults.push(...cp.results);
    state.topResults.sort(compareRows);
    if (state.topResults.length > 500) state.topResults.length = 500;
  }
}

const completedFiles = fs.readdirSync(checkpointDir)
  .filter((name) => /^task-\d{6}\.json$/u.test(name))
  .sort();

for (const name of completedFiles) {
  try {
    const cp = JSON.parse(fs.readFileSync(path.join(checkpointDir, name), 'utf8'));
    aggregateCheckpoint(cp);
  } catch (error) {
    console.warn('Ignoring unreadable checkpoint ' + name + ': ' + String(error?.message ?? error));
  }
}

reportShardProgress(state.completed, selectedTasks.length, true);

const reuseExistingCsv = batchLocalPrepared
  || String(process.env.REUSE_EXISTING_CSV ?? '').toLowerCase() === '1'
  || String(process.env.REUSE_EXISTING_CSV ?? '').toLowerCase() === 'true';

for (let taskIndex = 0; taskIndex < selectedTasks.length; taskIndex += 1) {
  const task = selectedTasks[taskIndex];
  const checkpointFile = path.join(checkpointDir, 'task-' + String(taskIndex).padStart(6, '0') + '.json');
  if (fs.existsSync(checkpointFile)) continue;

  const csvFile = path.join(csvDir, task.symbol + '-' + task.timeframe + '.csv');
  const checkpoint = {
    taskIndex,
    task,
    results: [],
    monthlyResults: [],
    failure: null,
  };

  try {
    const strictLocal = String(process.env.LOCAL_DATA_MODE ?? '').toLowerCase() === 'strict';

    if (!(reuseExistingCsv && fileReady(csvFile))) {
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
        throw new Error('LOCAL_DATA_MISSING: FREQTRADE_FUTURES_ROOT is not configured for ' + task.symbol + ' ' + task.timeframe);
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
    }

    const candles = parseCsv(csvFile).filter((bar) => bar.t >= plan.startMs && bar.t < plan.endMs);
    const firstBarMs = candles.length ? candles[0].t : NaN;
    const lastBarMs = candles.length ? candles[candles.length - 1].t : NaN;
    const effectiveStartMs = Number.isFinite(firstBarMs) ? Math.max(plan.startMs, firstBarMs) : plan.startMs;
    const expected = Math.max(0, Math.floor((plan.endMs - effectiveStartMs) / TF_MS[task.timeframe]));
    const coverage = expected ? Math.min(1, candles.length / expected) : 0;
    const historyDays = Number.isFinite(firstBarMs) && Number.isFinite(lastBarMs)
      ? (lastBarMs - firstBarMs + TF_MS[task.timeframe]) / 86_400_000
      : 0;
    const minHistoryDays = Number(plan.minHistoryDays ?? 30);

    if (historyDays < minHistoryDays) {
      checkpoint.failure = {
        ...task,
        reason: 'TOO_SHORT_HISTORY',
        rows: candles.length,
        expected,
        coverage,
        historyDays,
        minHistoryDays,
        firstBar: Number.isFinite(firstBarMs) ? new Date(firstBarMs).toISOString() : null,
        lastBar: Number.isFinite(lastBarMs) ? new Date(lastBarMs).toISOString() : null,
      };
    } else if (coverage < Number(plan.minCoverage ?? 0.98)) {
      checkpoint.failure = {
        ...task,
        reason: 'PARTIAL_LIFETIME_COVERAGE',
        rows: candles.length,
        expected,
        coverage,
        historyDays,
        firstBar: Number.isFinite(firstBarMs) ? new Date(firstBarMs).toISOString() : null,
        lastBar: Number.isFinite(lastBarMs) ? new Date(lastBarMs).toISOString() : null,
      };
    } else {
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
        start: effectiveStartMs,
        end: plan.endMs,
        strategyIds: plan.strategyIds,
      });

      checkpoint.results = evaluated.map((row) => ({
        ...task,
        start: new Date(effectiveStartMs).toISOString(),
        requestedStart: plan.start,
        end: plan.end,
        rows: candles.length,
        coverage,
        historyDays,
        firstBar: Number.isFinite(firstBarMs) ? new Date(firstBarMs).toISOString() : null,
        lastBar: Number.isFinite(lastBarMs) ? new Date(lastBarMs).toISOString() : null,
        ...row,
      }));

      if (plan.monthlyBreakdown) {
        const monthlyMinTrades = Number(plan.monthlyMinTrades ?? minTrades);
        const windows = monthWindows(effectiveStartMs, plan.endMs);
        for (const { window, candles: monthCandles } of candlesByWindows(candles, windows)) {
          const expectedMonth = Math.floor((window.end - window.start) / TF_MS[task.timeframe]);
          const monthCoverage = expectedMonth ? monthCandles.length / expectedMonth : 0;

          if (monthCoverage < Number(plan.minCoverage ?? 0.98)) {
            checkpoint.monthlyResults.push({
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

          checkpoint.monthlyResults.push(...monthEvaluated.map((row) => ({
            ...task,
            month: window.key,
            start: new Date(window.start).toISOString(),
            end: new Date(window.end).toISOString(),
            rows: monthCandles.length,
            coverage: monthCoverage,
            ...row,
          })));
        }

        for (const row of checkpoint.results) {
          const months = checkpoint.monthlyResults.filter((m) => m.id === row.id);
          const eligibleMonths = months.length;
          const passMonths = months.filter((m) => m.pass).length;
          const positiveMonths = months.filter((m) => Number(m.net) > 0).length;
          const stressPositiveMonths = months.filter((m) => Number(m.net15) > 0).length;
          let monthlyGrade = 'REVIEW';
          if (eligibleMonths >= 9 && passMonths >= 9) monthlyGrade = 'A_9_OF_9';
          else if (eligibleMonths >= 9 && passMonths >= 8) monthlyGrade = 'B_8_OF_9';
          else if (eligibleMonths >= 6 && passMonths / eligibleMonths >= 0.80) monthlyGrade = 'C_80PCT_SHORTER';
          row.monthlyEligibleMonths = eligibleMonths;
          row.monthlyPassMonths = passMonths;
          row.monthlyPositiveMonths = positiveMonths;
          row.monthlyStressPositiveMonths = stressPositiveMonths;
          row.monthlyPassRatio = eligibleMonths ? passMonths / eligibleMonths : 0;
          row.monthlyGrade = monthlyGrade;
        }
      }
    }
  } catch (error) {
    checkpoint.failure = { ...task, reason: 'ERROR', error: String(error?.message ?? error) };
  }

  writeJsonAtomic(checkpointFile, checkpoint);
  aggregateCheckpoint(checkpoint);
  reportShardProgress(state.completed, selectedTasks.length);
}

const backend = process.env.RESEARCH_BACKEND ?? plan.backend;
const resultsFile = path.join(outDir, 'results-' + backend + '-' + shardIndex + '-of-' + shardCount + '.ndjson');
const monthlyFile = path.join(outDir, 'monthly-' + backend + '-' + shardIndex + '-of-' + shardCount + '.ndjson');
const failuresFile = path.join(outDir, 'failures-' + backend + '-' + shardIndex + '-of-' + shardCount + '.ndjson');
const resultsAppender = createBufferedAppender(resultsFile);
const monthlyAppender = createBufferedAppender(monthlyFile);
const failuresAppender = createBufferedAppender(failuresFile);

for (let taskIndex = 0; taskIndex < selectedTasks.length; taskIndex += 1) {
  const checkpointFile = path.join(checkpointDir, 'task-' + String(taskIndex).padStart(6, '0') + '.json');
  if (!fs.existsSync(checkpointFile)) continue;
  const cp = JSON.parse(fs.readFileSync(checkpointFile, 'utf8'));
  resultsAppender.addRows(cp.results);
  monthlyAppender.addRows(cp.monthlyResults);
  if (cp.failure) failuresAppender.addRows([cp.failure]);
}
resultsAppender.flush();
monthlyAppender.flush();
failuresAppender.flush();

state.topResults.sort(compareRows);
const summary = {
  schemaVersion: 2,
  format: 'checkpointed-ndjson',
  backend,
  shardIndex,
  shardCount,
  dataRoot,
  start: plan.start,
  end: plan.end,
  requestedStrategies: plan.strategyIds,
  tasks: selectedTasks.length,
  completedTasks: state.completed,
  combinations: state.combinations,
  passing: state.passing,
  monthlyBreakdown: Boolean(plan.monthlyBreakdown),
  monthlyCombinations: state.monthlyCombinations,
  failures: state.failures,
  hardFailures: state.hardFailures,
  topResults: state.topResults,
  files: {
    results: path.basename(resultsFile),
    monthly: path.basename(monthlyFile),
    failures: path.basename(failuresFile),
  },
};

const summaryFile = path.join(outDir, 'summary-' + backend + '-' + shardIndex + '-of-' + shardCount + '.json');
fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2) + '\n', 'utf8');

const topCsvFile = path.join(outDir, 'top-' + backend + '-' + shardIndex + '-of-' + shardCount + '.csv');
const columns = ['symbol', 'timeframe', 'id', 'pass', 'trades', 'net', 'pf', 'winRate', 'maxDrawdown', 'coverage'];
const csvLines = [columns.join(',')];
for (const row of state.topResults) {
  csvLines.push(columns.map((column) => csvEscape(row[column])).join(','));
}
fs.writeFileSync(topCsvFile, csvLines.join('\n') + '\n', 'utf8');

reportShardProgress(state.completed, selectedTasks.length, true);

console.log(JSON.stringify({
  summaryFile,
  topCsvFile,
  resultsFile,
  monthlyFile,
  failuresFile,
  backend,
  shardIndex,
  shardCount,
  tasks: selectedTasks.length,
  completedTasks: state.completed,
  combinations: state.combinations,
  passing: state.passing,
  monthlyCombinations: state.monthlyCombinations,
  failures: state.failures,
  hardFailures: state.hardFailures,
}));

const maxErrorRate = Number(plan.maxErrorRate ?? 0.10);
if (selectedTasks.length > 0 && state.hardFailures / selectedTasks.length > maxErrorRate) {
  process.exitCode = 1;
}
