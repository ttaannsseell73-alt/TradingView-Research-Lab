import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

function fail(message) {
  console.error(message);
  process.exit(2);
}

function readPlan(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, '');
  const plan = JSON.parse(raw);
  if (!plan || typeof plan !== 'object') fail('Plan must be an object');
  if (!Array.isArray(plan.symbols) || !plan.symbols.length) fail('Plan symbols must be non-empty');
  if (!Array.isArray(plan.timeframes) || !plan.timeframes.length) fail('Plan timeframes must be non-empty');
  return plan;
}

function runShard(planFile, index, count, baseOut) {
  const shardOut = path.join(baseOut, 'shards', `shard-${index}-of-${count}`);
  fs.mkdirSync(shardOut, { recursive: true });
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ['scripts/run-q-class-discovery.mjs', path.resolve(planFile)],
      {
        stdio: 'inherit',
        env: {
          ...process.env,
          QCLASS_SHARD_INDEX: String(index),
          QCLASS_SHARD_COUNT: String(count),
          QCLASS_OUT_DIR: shardOut,
        },
      },
    );
    child.on('exit', (code, signal) => resolve({ index, code, signal, shardOut }));
  });
}

function csvEscape(value) {
  const s = value == null ? '' : String(value);
  return /[",\r\n]/u.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s;
}

const planFile = process.argv[2];
if (!planFile) fail('Usage: node scripts/run-q-class-discovery-parallel.mjs PLAN.json');

const plan = readPlan(planFile);
const baseOut = path.resolve(process.env.QCLASS_OUT_DIR ?? 'artifacts/q-class-discovery');
fs.mkdirSync(baseOut, { recursive: true });

const requested = Number(process.env.QCLASS_PARALLEL_SHARDS ?? process.env.LOCAL_PARALLEL_SHARDS ?? 4);
const available = typeof os.availableParallelism === 'function'
  ? os.availableParallelism()
  : os.cpus().length;
const taskCount = new Set(plan.symbols).size * new Set(plan.timeframes).size;
const shardCount = Math.max(
  1,
  Math.min(
    Number.isInteger(requested) && requested > 0 ? requested : 4,
    Math.max(1, available),
    Math.max(1, taskCount),
  ),
);

const started = Date.now();
const runs = await Promise.all(
  Array.from({ length: shardCount }, (_, index) => runShard(planFile, index, shardCount, baseOut)),
);
const failed = runs.filter((run) => run.code !== 0);
if (failed.length) {
  console.error(JSON.stringify({ qclass: 'PARALLEL_FAILED', failed }, null, 2));
  process.exit(1);
}

const rows = [];
const shardSummaries = [];
for (const run of runs) {
  const resultFile = path.join(run.shardOut, 'result-summary.ndjson');
  if (fs.existsSync(resultFile)) {
    const raw = fs.readFileSync(resultFile, 'utf8').trim();
    if (raw) {
      for (const line of raw.split(/\r?\n/u)) rows.push(JSON.parse(line));
    }
  }
  const summaryFile = path.join(run.shardOut, 'summary.json');
  if (fs.existsSync(summaryFile)) shardSummaries.push(JSON.parse(fs.readFileSync(summaryFile, 'utf8')));
}

const planFingerprints = [...new Set(shardSummaries.map((row) => row.planFingerprint).filter(Boolean))];
if (planFingerprints.length !== 1) {
  fail('Q-Class merge rejected: shard plan fingerprints differ');
}

rows.sort((a, b) =>
  Number(Boolean(b.validatedRecovery)) - Number(Boolean(a.validatedRecovery))
  || Number(Boolean(b.recoveryCandidate)) - Number(Boolean(a.recoveryCandidate))
  || Number(b.passMonths ?? -1) - Number(a.passMonths ?? -1)
  || Number(b.net ?? -Infinity) - Number(a.net ?? -Infinity)
  || Number(a.dd ?? Infinity) - Number(b.dd ?? Infinity)
  || String(a.symbol).localeCompare(String(b.symbol))
  || String(a.variantId).localeCompare(String(b.variantId))
);

fs.writeFileSync(
  path.join(baseOut, 'q-class-results.ndjson'),
  rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''),
  'utf8',
);

const csvFields = [
  'symbol','timeframe','variantId','recoveryStatus','validatedRecovery','recoveryCandidate',
  'baseline','passMonths','eligibleMonths','deltaPassMonths','holdoutPassMonths',
  'holdoutEligibleMonths','n','wr','net','net15','pf','dd','longNet','shortNet',
  'combinationId','resultId',
];
const csvLines = [csvFields.join(',')];
for (const row of rows) {
  csvLines.push(csvFields.map((field) => csvEscape(row[field])).join(','));
}
fs.writeFileSync(path.join(baseOut, 'q-class-results.csv'), csvLines.join('\n') + '\n', 'utf8');

const summary = {
  schemaVersion: 2,
  engineVersion: shardSummaries[0]?.engineVersion ?? 'qclass-discovery-v1',
  planFingerprint: planFingerprints[0],
  shards: shardCount,
  taskCount,
  completedTasks: shardSummaries.reduce((n, row) => n + Number(row.completedTasks ?? 0), 0),
  skippedTasks: shardSummaries.reduce((n, row) => n + Number(row.skippedTasks ?? 0), 0),
  variantsInResults: rows.length,
  evaluatedVariants: shardSummaries.reduce((n, row) => n + Number(row.evaluatedVariants ?? 0), 0),
  checkpointHits: shardSummaries.reduce((n, row) => n + Number(row.checkpointHits ?? 0), 0),
  validatedRecoveries: rows.filter((row) => row.validatedRecovery).length,
  recoveryCandidates: rows.filter((row) => row.recoveryCandidate).length,
  fullPass: rows.filter((row) => row.fullPass).length,
  elapsedMs: Date.now() - started,
  topValidatedRecoveries: rows.filter((row) => row.validatedRecovery).slice(0, 200),
  topRecoveryCandidates: rows.filter((row) => row.recoveryCandidate).slice(0, 200),
  topFullPass: rows.filter((row) => row.fullPass).slice(0, 200),
  shardSummaries: shardSummaries.map((row) => ({
    shardIndex: row.shardIndex,
    completedTasks: row.completedTasks,
    skippedTasks: row.skippedTasks,
    evaluatedVariants: row.evaluatedVariants,
    checkpointHits: row.checkpointHits,
    elapsedMs: row.elapsedMs,
    throughputVariantsPerSecond: row.throughputVariantsPerSecond,
  })),
};

fs.writeFileSync(
  path.join(baseOut, 'q-class-summary.json'),
  JSON.stringify(summary, null, 2) + '\n',
  'utf8',
);

console.log(JSON.stringify({
  qclass: 'COMPLETE',
  planFingerprint: summary.planFingerprint,
  shards: shardCount,
  completedTasks: summary.completedTasks,
  variants: rows.length,
  evaluatedVariants: summary.evaluatedVariants,
  checkpointHits: summary.checkpointHits,
  validatedRecoveries: summary.validatedRecoveries,
  recoveryCandidates: summary.recoveryCandidates,
  fullPass: summary.fullPass,
  elapsedMs: summary.elapsedMs,
}));
