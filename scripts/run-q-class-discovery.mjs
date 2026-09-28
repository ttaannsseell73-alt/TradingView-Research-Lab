import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  QCLASS_ENGINE_VERSION,
  QCLASS_SCHEMA_VERSION,
  annotateRecovery,
  canonicalStringify,
  compactResult,
  createRangeReclaimContext,
  sha256,
} from '../research/q_class_engine.mjs';

function fail(message) {
  console.error(message);
  process.exit(2);
}

function readPlan(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, '');
  const plan = JSON.parse(raw);
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) fail('Q-Class plan must be an object');
  if (!Array.isArray(plan.symbols) || !plan.symbols.length) fail('Q-Class symbols must be non-empty');
  if (!Array.isArray(plan.timeframes) || !plan.timeframes.length) fail('Q-Class timeframes must be non-empty');
  if (!plan.start || !plan.end) fail('Q-Class plan requires start/end');
  if ((plan.family ?? 'range_reclaim') !== 'range_reclaim') fail('Only range_reclaim family is enabled in qclass-v1');
  const start = Date.parse(plan.start);
  const end = Date.parse(plan.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) fail('Invalid Q-Class start/end');
  return {
    ...plan,
    startMs: start,
    endMs: end,
    cost: Number(plan.cost ?? 0.0014),
    stressCost: Number(plan.stressCost ?? 0.0015),
    lowCost: Number(plan.lowCost ?? 0.0006),
    minCoverage: Number(plan.minCoverage ?? 0.98),
    minTrades: plan.minTrades ?? { '1m': 50, '5m': 30, '15m': 25, '1h': 20, '4h': 10 },
    monthlyMinTrades: Number(plan.monthlyMinTrades ?? 10),
    holdoutMonths: Number(plan.holdoutMonths ?? 2),
  };
}

function parseCsv(raw) {
  const lines = raw.trim().split(/\r?\n/u);
  if (lines.length < 2) return [];
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const p = lines[i].split(',');
    if (p.length < 6) continue;
    const [t, o, h, l, c, v] = p.slice(0, 6).map(Number);
    if ([t, o, h, l, c, v].every(Number.isFinite)) rows.push({ t, o, h, l, c, v });
  }
  return rows;
}

function fileSha256(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function atomicWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

function sanitize(value) {
  return String(value).replace(/[^0-9A-Za-z._-]+/gu, '_');
}

function minTradesFor(plan, timeframe) {
  return Number(
    typeof plan.minTrades === 'number'
      ? plan.minTrades
      : plan.minTrades?.[timeframe] ?? 25,
  );
}

function taskCoverage(candles, start, end, timeframe) {
  const tfMs = {
    '1m': 60_000,
    '5m': 300_000,
    '15m': 900_000,
    '1h': 3_600_000,
    '4h': 14_400_000,
  }[timeframe];
  if (!tfMs || !candles.length) return 0;
  const first = Math.max(start, candles[0].t);
  const expected = Math.max(1, Math.floor((end - first) / tfMs));
  return Math.min(1, candles.length / expected);
}

const planFile = process.argv[2];
if (!planFile) fail('Usage: node scripts/run-q-class-discovery.mjs PLAN.json');

const shardIndex = Number(process.env.QCLASS_SHARD_INDEX ?? 0);
const shardCount = Number(process.env.QCLASS_SHARD_COUNT ?? 1);
if (!Number.isInteger(shardIndex) || !Number.isInteger(shardCount) || shardCount < 1 || shardIndex < 0 || shardIndex >= shardCount) {
  fail('Invalid Q-Class shard index/count');
}

const plan = readPlan(planFile);
const csvDir = path.resolve(
  process.env.QCLASS_CSV_DIR
    ?? process.env.RESEARCH_CSV_DIR
    ?? 'C:/actions-runner-datahub/qclass-cache',
);
const checkpointRoot = path.resolve(
  process.env.QCLASS_CHECKPOINT_ROOT
    ?? 'C:/actions-runner-datahub/qclass-checkpoints',
);
const outDir = path.resolve(
  process.env.QCLASS_OUT_DIR
    ?? 'artifacts/q-class-discovery',
);
fs.mkdirSync(outDir, { recursive: true });

const enginePath = path.resolve('research/q_class_engine.mjs');
const runnerPath = path.resolve('scripts/run-q-class-discovery.mjs');
const engineSourceSha = fileSha256(fs.readFileSync(enginePath));
const runnerSourceSha = fileSha256(fs.readFileSync(runnerPath));
const normalizedPlan = {
  schemaVersion: QCLASS_SCHEMA_VERSION,
  engineVersion: QCLASS_ENGINE_VERSION,
  family: plan.family ?? 'range_reclaim',
  start: plan.start,
  end: plan.end,
  timeframes: [...new Set(plan.timeframes)].sort(),
  symbols: [...new Set(plan.symbols)].sort(),
  cost: plan.cost,
  stressCost: plan.stressCost,
  lowCost: plan.lowCost,
  minCoverage: plan.minCoverage,
  minTrades: plan.minTrades,
  monthlyMinTrades: plan.monthlyMinTrades,
  holdoutMonths: plan.holdoutMonths,
  range: plan.range ?? {},
};
const planFingerprint = sha256({
  normalizedPlan,
  engineSourceSha,
  runnerSourceSha,
});

const tasks = [];
for (const symbol of [...new Set(plan.symbols)].sort()) {
  for (const timeframe of [...new Set(plan.timeframes)].sort()) {
    tasks.push({ symbol, timeframe });
  }
}
const selectedTasks = tasks.filter((_, index) => index % shardCount === shardIndex);

const compactRows = [];
const taskSummaries = [];
let evaluatedVariants = 0;
let checkpointHits = 0;
let skippedTasks = 0;
const started = Date.now();

for (let taskIndex = 0; taskIndex < selectedTasks.length; taskIndex += 1) {
  const task = selectedTasks[taskIndex];
  const csvFile = path.join(csvDir, `${task.symbol}-${task.timeframe}.csv`);
  if (!fs.existsSync(csvFile)) {
    taskSummaries.push({ ...task, status: 'CSV_MISSING', csvFile });
    skippedTasks += 1;
    continue;
  }

  const raw = fs.readFileSync(csvFile);
  const datasetSha = fileSha256(raw);
  const candles = parseCsv(raw.toString('utf8'))
    .filter((bar) => bar.t >= plan.startMs && bar.t < plan.endMs);

  if (!candles.length) {
    taskSummaries.push({ ...task, status: 'NO_CANDLES', datasetSha });
    skippedTasks += 1;
    continue;
  }

  const coverage = taskCoverage(candles, plan.startMs, plan.endMs, task.timeframe);
  if (coverage < plan.minCoverage) {
    taskSummaries.push({
      ...task,
      status: 'PARTIAL_COVERAGE',
      datasetSha,
      rows: candles.length,
      coverage,
    });
    skippedTasks += 1;
    continue;
  }

  const taskFingerprint = sha256({
    planFingerprint,
    datasetSha,
    symbol: task.symbol,
    timeframe: task.timeframe,
    start: plan.start,
    end: plan.end,
  });

  const checkpointDir = path.join(
    checkpointRoot,
    planFingerprint,
    sanitize(task.symbol + '__' + task.timeframe),
  );
  fs.mkdirSync(checkpointDir, { recursive: true });

  const context = createRangeReclaimContext(candles, { range: plan.range ?? {} });
  const rawResults = [];

  for (const variant of context.variants) {
    const combinationId = sha256({
      symbol: task.symbol,
      timeframe: task.timeframe,
      family: variant.family,
      variantFingerprint: variant.variantFingerprint,
    }).slice(0, 24);
    const resultId = sha256({
      combinationId,
      taskFingerprint,
      schemaVersion: QCLASS_SCHEMA_VERSION,
    });
    const checkpointFile = path.join(checkpointDir, combinationId + '.json');

    let row = null;
    if (fs.existsSync(checkpointFile)) {
      try {
        const saved = JSON.parse(fs.readFileSync(checkpointFile, 'utf8'));
        if (
          saved?.schemaVersion === QCLASS_SCHEMA_VERSION
          && saved?.engineVersion === QCLASS_ENGINE_VERSION
          && saved?.taskFingerprint === taskFingerprint
          && saved?.variantFingerprint === variant.variantFingerprint
          && saved?.resultId === resultId
        ) {
          row = saved.result;
          checkpointHits += 1;
        }
      } catch {
        row = null;
      }
    }

    if (!row) {
      row = context.evaluate(variant, {
        timeframe: task.timeframe,
        start: plan.startMs,
        end: plan.endMs,
        cost: plan.cost,
        stressCost: plan.stressCost,
        lowCost: plan.lowCost,
        minTrades: minTradesFor(plan, task.timeframe),
        monthlyMinTrades: plan.monthlyMinTrades,
        minCoverage: plan.minCoverage,
        holdoutMonths: plan.holdoutMonths,
      });
      evaluatedVariants += 1;
      atomicWriteJson(checkpointFile, {
        schemaVersion: QCLASS_SCHEMA_VERSION,
        engineVersion: QCLASS_ENGINE_VERSION,
        planFingerprint,
        taskFingerprint,
        datasetSha,
        combinationId,
        resultId,
        variantFingerprint: variant.variantFingerprint,
        result: row,
      });
    }

    rawResults.push({
      ...row,
      symbol: task.symbol,
      timeframe: task.timeframe,
      planFingerprint,
      taskFingerprint,
      datasetSha,
      combinationId,
      resultId,
      coverage,
      rows: candles.length,
    });
  }

  const annotated = annotateRecovery(rawResults);
  const baseline = annotated.find((row) => row.baseline) ?? null;
  const taskFile = path.join(outDir, 'tasks', sanitize(task.symbol + '__' + task.timeframe) + '.json');
  atomicWriteJson(taskFile, {
    schemaVersion: QCLASS_SCHEMA_VERSION,
    engineVersion: QCLASS_ENGINE_VERSION,
    planFingerprint,
    taskFingerprint,
    task,
    datasetSha,
    coverage,
    rows: candles.length,
    variants: annotated.length,
    baseline: baseline ? compactResult(baseline) : null,
    recoveryCandidates: annotated.filter((row) => row.recoveryCandidate).length,
    validatedRecoveries: annotated.filter((row) => row.validatedRecovery).length,
    fullPass: annotated.filter((row) => row.fullPass).length,
    results: annotated,
  });

  for (const row of annotated) compactRows.push(compactResult(row));
  taskSummaries.push({
    ...task,
    status: 'OK',
    taskFingerprint,
    datasetSha,
    coverage,
    rows: candles.length,
    featureArrays: context.featureCache.size,
    variants: annotated.length,
    baselinePassMonths: baseline?.passMonths ?? null,
    baselineEligibleMonths: baseline?.eligibleMonths ?? null,
    recoveryCandidates: annotated.filter((row) => row.recoveryCandidate).length,
    validatedRecoveries: annotated.filter((row) => row.validatedRecovery).length,
    fullPass: annotated.filter((row) => row.fullPass).length,
  });

  console.log(JSON.stringify({
    qclass: 'TASK_DONE',
    shardIndex,
    taskIndex: taskIndex + 1,
    taskCount: selectedTasks.length,
    symbol: task.symbol,
    timeframe: task.timeframe,
    variants: annotated.length,
    checkpointHits,
    evaluatedVariants,
  }));
}

compactRows.sort((a, b) =>
  Number(Boolean(b.validatedRecovery)) - Number(Boolean(a.validatedRecovery))
  || Number(Boolean(b.recoveryCandidate)) - Number(Boolean(a.recoveryCandidate))
  || Number(b.passMonths ?? -1) - Number(a.passMonths ?? -1)
  || Number(b.net ?? -Infinity) - Number(a.net ?? -Infinity)
  || Number(a.dd ?? Infinity) - Number(b.dd ?? Infinity)
  || String(a.symbol).localeCompare(String(b.symbol))
  || String(a.variantId).localeCompare(String(b.variantId))
);

const ndjsonFile = path.join(outDir, 'result-summary.ndjson');
fs.writeFileSync(
  ndjsonFile,
  compactRows.map((row) => JSON.stringify(row)).join('\n') + (compactRows.length ? '\n' : ''),
  'utf8',
);

const summary = {
  schemaVersion: QCLASS_SCHEMA_VERSION,
  engineVersion: QCLASS_ENGINE_VERSION,
  planFingerprint,
  engineSourceSha,
  runnerSourceSha,
  shardIndex,
  shardCount,
  selectedTasks: selectedTasks.length,
  completedTasks: taskSummaries.filter((row) => row.status === 'OK').length,
  skippedTasks,
  variantsInResults: compactRows.length,
  evaluatedVariants,
  checkpointHits,
  validatedRecoveries: compactRows.filter((row) => row.validatedRecovery).length,
  recoveryCandidates: compactRows.filter((row) => row.recoveryCandidate).length,
  fullPass: compactRows.filter((row) => row.fullPass).length,
  elapsedMs: Date.now() - started,
  throughputVariantsPerSecond: (evaluatedVariants / Math.max(0.001, (Date.now() - started) / 1000)),
  tasks: taskSummaries,
  top: compactRows.slice(0, 100),
};

atomicWriteJson(path.join(outDir, 'summary.json'), summary);
console.log(JSON.stringify({
  qclass: 'SHARD_DONE',
  shardIndex,
  shardCount,
  planFingerprint,
  completedTasks: summary.completedTasks,
  variants: compactRows.length,
  evaluatedVariants,
  checkpointHits,
  validatedRecoveries: summary.validatedRecoveries,
  elapsedMs: summary.elapsedMs,
}));
