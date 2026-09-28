import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

function fail(message) {
  console.error(message);
  process.exit(2);
}

const mode = String(process.env.TURBO_PINETS_MODE ?? 'exact').toLowerCase();
if (!['exact', 'recovery'].includes(mode)) fail('TURBO_PINETS_MODE must be exact|recovery');

const prefix = mode === 'exact' ? 'EXACT' : 'RECOVERY';
const env = process.env;
const key = env[`${prefix}_KEY`];
const sourceSha = env[`${prefix}_SOURCE_SHA256`];
const scriptId = env[`${prefix}_SCRIPT_ID`];
const baseOut = path.resolve(env[`${prefix}_OUT_DIR`] ?? `artifacts/${mode}-turbo/${key ?? 'unknown'}`);
const csvCache = path.resolve(env[`${prefix}_CSV_CACHE`] ?? env.TURBO_CSV_CACHE ?? 'D:/Futures-Research-Data/research-cache/2026-01-01__2026-09-20__1m-5m-15m-1h-4h');
const sourceCacheRoot = path.resolve(env.PINE_SOURCE_CACHE ?? 'D:/Futures-Research-Data/pine-source-cache');
const requested = Number(env.LOCAL_PARALLEL_SHARDS ?? 4);
const available = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
const shardCount = Math.max(1, Math.min(Number.isInteger(requested) && requested > 0 ? requested : 4, Math.max(1, available)));
const shardTimeoutMsRaw = Number(env.TURBO_SHARD_TIMEOUT_MS ?? 300_000);
const shardTimeoutMs = Number.isFinite(shardTimeoutMsRaw) && shardTimeoutMsRaw >= 30_000
  ? Math.floor(shardTimeoutMsRaw)
  : 300_000;

if (!key) fail(`${prefix}_KEY is required`);
if (!sourceSha) fail(`${prefix}_SOURCE_SHA256 is required`);
if (!fs.existsSync(csvCache)) fail(`Turbo CSV cache missing: ${csvCache}`);

fs.mkdirSync(baseOut, { recursive: true });
fs.mkdirSync(sourceCacheRoot, { recursive: true });

function sha256(text) {
  return crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}

async function fetchExactSource() {
  const cached = path.join(sourceCacheRoot, `${sourceSha}.pine`);
  if (fs.existsSync(cached)) {
    const text = fs.readFileSync(cached, 'utf8');
    if (sha256(text) === sourceSha) return cached;
    fs.rmSync(cached, { force: true });
  }
  if (!scriptId) fail('EXACT_SCRIPT_ID is required when source cache is cold');
  const url = `https://pine-facade.tradingview.com/pine-facade/get/${encodeURIComponent(scriptId)}/last?no_4xx=true`;
  let lastError = null;
  for (let attempt = 0; attempt < 7; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154 Safari/537.36',
          accept: 'application/json',
        },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      const source = payload?.source;
      if (typeof source !== 'string' || !source.length) throw new Error('source unavailable');
      const actual = sha256(source);
      if (actual !== sourceSha) throw new Error(`SOURCE_CHANGED expected=${sourceSha} actual=${actual}`);
      const tmp = `${cached}.tmp-${process.pid}`;
      fs.writeFileSync(tmp, source, 'utf8');
      fs.renameSync(tmp, cached);
      return cached;
    } catch (error) {
      lastError = error;
      if (attempt < 6) await new Promise((resolve) => setTimeout(resolve, Math.min(12000, 750 * (2 ** attempt))));
    }
  }
  throw lastError ?? new Error('source fetch failed');
}

function recoverySource() {
  const file = env.RECOVERY_SOURCE_FILE;
  if (!file) fail('RECOVERY_SOURCE_FILE is required');
  const resolved = path.resolve(file);
  if (!fs.existsSync(resolved)) fail(`Recovery source missing: ${resolved}`);
  const source = fs.readFileSync(resolved, 'utf8');
  const actual = sha256(source);
  if (actual !== sourceSha) fail(`RECOVERY_SOURCE_CHANGED expected=${sourceSha} actual=${actual}`);
  return resolved;
}

function runShard(index, sourceFile) {
  const runner = mode === 'exact'
    ? 'scripts/run-pinets-exact-strategy.mjs'
    : 'scripts/run-pinets-recovered-strategy.mjs';
  const shardOut = path.join(baseOut, 'shards', `shard-${index}-of-${shardCount}`);
  fs.mkdirSync(shardOut, { recursive: true });
  return new Promise((resolve) => {
    const childEnv = {
      ...env,
      SHARD_INDEX: String(index),
      SHARD_COUNT: String(shardCount),
      TURBO_STRICT_CACHE: '1',
      [`${prefix}_CSV_CACHE`]: csvCache,
      [`${prefix}_SOURCE_FILE`]: sourceFile,
      [`${prefix}_OUT_DIR`]: shardOut,
    };
    const child = spawn(process.execPath, [runner], { stdio: 'inherit', env: childEnv });
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      console.error(JSON.stringify({
        turbo: 'SHARD_TIMEOUT',
        mode,
        key,
        shard: index,
        timeoutMs: shardTimeoutMs,
      }));
      try { child.kill(); } catch {}
      finish({ index, code: 124, signal: 'WATCHDOG_TIMEOUT', shardOut, timedOut: true });
    }, shardTimeoutMs);
    child.on('exit', (code, signal) => finish({ index, code, signal, shardOut, timedOut: false }));
    child.on('error', (error) => finish({ index, code: 1, signal: String(error), shardOut, timedOut: false }));
  });
}

function csvEscape(value) {
  const s = value == null ? '' : String(value);
  return /[",\n]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s;
}

function mergeResults(results, elapsedMs) {
  const summaries = [];
  const runtimeSkips = [];
  for (const result of results) {
    const summaryFile = path.join(result.shardOut, 'summary.json');
    const skipFile = path.join(result.shardOut, 'runtime-skip.json');
    if (fs.existsSync(summaryFile)) summaries.push(JSON.parse(fs.readFileSync(summaryFile, 'utf8')));
    if (fs.existsSync(skipFile)) runtimeSkips.push(JSON.parse(fs.readFileSync(skipFile, 'utf8')));
  }

  if (!summaries.length && runtimeSkips.length) {
    const one = {
      ...runtimeSkips[0],
      turbo: true,
      shardCount,
      elapsedMs,
    };
    fs.writeFileSync(path.join(baseOut, 'runtime-skip.json'), JSON.stringify(one, null, 2) + '\n', 'utf8');
    return { status: 'SKIP_RUNTIME_UNSUPPORTED', counts: null };
  }
  if (summaries.length !== shardCount) {
    throw new Error(`Turbo merge incomplete: summaries=${summaries.length} expected=${shardCount}`);
  }

  const accepted = summaries.flatMap((s) => s.accepted ?? [])
    .sort((a, b) =>
      (a.grade === b.grade ? 0 : a.grade === 'A_9_OF_9' ? -1 : 1)
      || Number(b.netPct ?? -Infinity) - Number(a.netPct ?? -Infinity)
    );
  const counts = {
    ok: summaries.reduce((n, s) => n + Number(s.counts?.ok ?? 0), 0),
    errors: summaries.reduce((n, s) => n + Number(s.counts?.errors ?? 0), 0),
    tooShortHistory: summaries.reduce((n, s) => n + Number(s.counts?.tooShortHistory ?? 0), 0),
    partialCoverage: summaries.reduce((n, s) => n + Number(s.counts?.partialCoverage ?? 0), 0),
    nineOfNine: accepted.filter((r) => r.grade === 'A_9_OF_9').length,
    eightOfNine: accepted.filter((r) => r.grade === 'B_8_OF_9').length,
  };
  const merged = {
    ...summaries[0],
    turbo: {
      enabled: true,
      shards: shardCount,
      csvCache,
      sourceCache: mode === 'exact' ? sourceCacheRoot : null,
      elapsedMs,
    },
    universe: {
      ...summaries[0].universe,
      tasks: summaries.reduce((n, s) => n + Number(s.universe?.tasks ?? 0), 0),
      shardCount,
    },
    counts,
    accepted,
  };
  fs.writeFileSync(path.join(baseOut, 'summary.json'), JSON.stringify(merged, null, 2) + '\n', 'utf8');

  const fields = ['grade','symbol','timeframe','name','author','sourceSha256','trades','winRate','netPct','profitFactor','maxDrawdownPct','passMonths','positiveMonths'];
  const lines = [fields.join(',')];
  for (const row of accepted) lines.push(fields.map((f) => csvEscape(row[f])).join(','));
  fs.writeFileSync(path.join(baseOut, 'accepted-9of9-8of9.csv'), lines.join('\n') + '\n', 'utf8');

  const ndjson = [];
  for (const result of results) {
    const file = path.join(result.shardOut, 'task-results.ndjson');
    if (fs.existsSync(file)) ndjson.push(fs.readFileSync(file, 'utf8').trim());
  }
  fs.writeFileSync(path.join(baseOut, 'task-results.ndjson'), ndjson.filter(Boolean).join('\n') + '\n', 'utf8');
  return { status: 'DONE', counts };
}

// Remove only incompatible topology outputs; same topology remains useful for inspection.
const shardsRoot = path.join(baseOut, 'shards');
fs.mkdirSync(shardsRoot, { recursive: true });
for (const entry of fs.readdirSync(shardsRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const m = /^shard-(\d+)-of-(\d+)$/.exec(entry.name);
  if (m && Number(m[2]) !== shardCount) fs.rmSync(path.join(shardsRoot, entry.name), { recursive: true, force: true });
}

const started = Date.now();
const sourceFile = mode === 'exact' ? await fetchExactSource() : recoverySource();
console.log(JSON.stringify({ turbo: 'START', mode, key, shards: shardCount, csvCache, sourceFile }));

const results = await Promise.all(Array.from({ length: shardCount }, (_, index) => runShard(index, sourceFile)));
const timedOut = results.filter((r) => r.timedOut);
if (timedOut.length) {
  const skip = {
    status: 'SKIP_RUNTIME_TIMEOUT',
    mode,
    key,
    shardCount,
    timedOutShards: timedOut.map((r) => r.index),
    shardTimeoutMs,
    elapsedMs: Date.now() - started,
    note: 'Watchdog prevented one exact/recovery strategy from monopolizing the self-hosted runner.',
  };
  fs.writeFileSync(path.join(baseOut, 'runtime-skip.json'), JSON.stringify(skip, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify({ turbo: 'SKIP_RUNTIME_TIMEOUT', ...skip }));
  process.exit(0);
}
const failed = results.filter((r) => r.code !== 0);
if (failed.length) {
  console.error(JSON.stringify({ turbo: 'FAILED', mode, key, failed }));
  process.exit(1);
}
const merged = mergeResults(results, Date.now() - started);
console.log(JSON.stringify({ turbo: merged.status, mode, key, shards: shardCount, elapsedMs: Date.now() - started, counts: merged.counts }));
