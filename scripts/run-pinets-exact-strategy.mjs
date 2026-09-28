import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { PineTS } from 'pinets';

const TF_MS = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
};

const MIN_TRADES = {
  '1m': 50,
  '5m': 30,
  '15m': 25,
  '1h': 20,
  '4h': 10,
};

const START_MS = Date.parse(process.env.EXACT_START ?? '2026-01-01T00:00:00Z');
const END_MS = Date.parse(process.env.EXACT_END ?? '2026-09-20T00:00:00Z');
const MONTHLY_MIN_TRADES = Number(process.env.EXACT_MONTHLY_MIN_TRADES ?? 10);
const MIN_COVERAGE = Number(process.env.EXACT_MIN_COVERAGE ?? 0.98);
const MIN_HISTORY_DAYS = Number(process.env.EXACT_MIN_HISTORY_DAYS ?? 30);

const meta = {
  key: process.env.EXACT_KEY,
  name: process.env.EXACT_NAME,
  author: process.env.EXACT_AUTHOR,
  origin: process.env.EXACT_ORIGIN,
  group: process.env.EXACT_GROUP,
  scriptIdPart: process.env.EXACT_SCRIPT_ID,
  sourceSha256: process.env.EXACT_SOURCE_SHA256,
  pineVersion: process.env.EXACT_PINE_VERSION || null,
  url: process.env.EXACT_URL || null,
};

for (const k of ['key', 'name', 'scriptIdPart', 'sourceSha256']) {
  if (!meta[k]) throw new Error(`missing required env: ${k}`);
}

const shardIndex = Number(process.env.SHARD_INDEX ?? 0);
const shardCount = Number(process.env.SHARD_COUNT ?? 1);
if (!Number.isInteger(shardIndex) || !Number.isInteger(shardCount) || shardCount < 1 || shardIndex < 0 || shardIndex >= shardCount) {
  throw new Error(`invalid shard topology: ${shardIndex}/${shardCount}`);
}

const dataRoot = process.env.FREQTRADE_FUTURES_ROOT;
if (!dataRoot) throw new Error('FREQTRADE_FUTURES_ROOT is required');

const outDir = path.resolve(process.env.EXACT_OUT_DIR ?? `artifacts/exact-source-results/${meta.key}`);
fs.mkdirSync(outDir, { recursive: true });

const persistentCsv = path.resolve(process.env.EXACT_CSV_CACHE ?? 'C:/actions-runner-datahub/exact-source-csv-cache-2026');
const persistentRoot = path.resolve(process.env.EXACT_CHECKPOINT_ROOT ?? 'C:/actions-runner-datahub/exact-source-checkpoints');
const windowKey = `${new Date(START_MS).toISOString().slice(0,10)}_${new Date(END_MS).toISOString().slice(0,10)}_pinets-0.10.0`;
const checkpointDir = path.join(persistentRoot, meta.sourceSha256, windowKey, `checkpoints-${shardIndex}-of-${shardCount}`);
fs.mkdirSync(persistentCsv, { recursive: true });
fs.mkdirSync(checkpointDir, { recursive: true });

function safeJsonWrite(file, value) {
  const tmp = `${file}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

async function fetchExactSource() {
  const sourceFile = process.env.EXACT_SOURCE_FILE;
  if (sourceFile) {
    const source = fs.readFileSync(path.resolve(sourceFile), 'utf8');
    const hash = crypto.createHash('sha256').update(Buffer.from(source, 'utf8')).digest('hex');
    if (hash !== meta.sourceSha256) {
      throw new Error(`SOURCE_CHANGED expected=${meta.sourceSha256} actual=${hash}`);
    }
    return { source, payload: { version: meta.pineVersion, scriptAccess: 'turbo_source_cache' } };
  }

  const url = `https://pine-facade.tradingview.com/pine-facade/get/${encodeURIComponent(meta.scriptIdPart)}/last?no_4xx=true`;
  let lastError = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154 Safari/537.36',
          'accept': 'application/json',
        },
      });
      if (!response.ok) throw new Error(`source fetch HTTP ${response.status}`);
      const payload = await response.json();
      const source = payload?.source;
      if (typeof source !== 'string' || source.length === 0) throw new Error('source unavailable');
      const hash = crypto.createHash('sha256').update(Buffer.from(source, 'utf8')).digest('hex');
      if (hash !== meta.sourceSha256) {
        throw new Error(`SOURCE_CHANGED expected=${meta.sourceSha256} actual=${hash}`);
      }
      return { source, payload };
    } catch (error) {
      lastError = error;
      if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, 750 * (2 ** attempt)));
    }
  }
  throw lastError ?? new Error('source fetch failed');
}

function universeFromFeather(root) {
  const suffix = '_USDT_USDT-15m-futures.feather';
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith(suffix))
    .map((d) => d.name.slice(0, -suffix.length).replaceAll('_', '') + 'USDT')
    .sort();
}

function parseCsv(file) {
  const raw = fs.readFileSync(file, 'utf8').trim();
  if (!raw) return [];
  const lines = raw.split(/\r?\n/);
  const out = new Array(Math.max(0, lines.length - 1));
  let n = 0;
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',');
    if (parts.length < 6) continue;
    const t = Number(parts[0]);
    const open = Number(parts[1]);
    const high = Number(parts[2]);
    const low = Number(parts[3]);
    const close = Number(parts[4]);
    const volume = Number(parts[5]);
    if (![t, open, high, low, close, volume].every(Number.isFinite)) continue;
    out[n++] = { openTime: t, open, high, low, close, volume };
  }
  out.length = n;
  return out;
}

function exportCsv(symbol, timeframe) {
  const file = path.join(persistentCsv, `${symbol}-${timeframe}.csv`);
  if (fs.existsSync(file) && fs.statSync(file).size > 32) return file;

  const turboStrict = !['0', 'false', 'off'].includes(String(process.env.TURBO_STRICT_CACHE ?? '0').toLowerCase());
  if (turboStrict) {
    throw new Error(`TURBO_CACHE_MISS ${symbol} ${timeframe}: ${file}`);
  }

  const reuseRoots = [
    process.env.EXACT_REUSE_CSV_ROOT,
    path.resolve('artifacts/sr25-2026-full/csv'),
    path.resolve('artifacts/algo9-2026-full/csv'),
  ].filter(Boolean);
  for (const root of reuseRoots) {
    const candidate = path.join(root, `${symbol}-${timeframe}.csv`);
    if (fs.existsSync(candidate) && fs.statSync(candidate).size > 32) {
      fs.copyFileSync(candidate, file);
      return file;
    }
  }

  const python = process.env.DATAHUB_PYTHON
    ?? process.env.SYSTEM_PYTHON
    ?? (process.platform === 'win32' ? 'python.exe' : 'python3');
  const bridge = path.resolve('scripts/export-freqtrade-feather.py');
  const run = spawnSync(python, [
    bridge,
    '--root', dataRoot,
    '--symbol', symbol,
    '--timeframe', timeframe,
    '--start', new Date(START_MS).toISOString(),
    '--end', new Date(END_MS).toISOString(),
    '--output', file,
  ], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (run.status !== 0) {
    throw new Error(`DATA_EXPORT_FAILED ${symbol} ${timeframe}: ${(run.stderr || run.stdout || '').slice(-1500)}`);
  }
  return file;
}

async function runSource(source, candles) {
  const pine = new PineTS(candles);
  return await pine.run(source);
}

function pf(profits) {
  let wins = 0;
  let losses = 0;
  for (const p of profits) {
    if (p > 0) wins += p;
    else if (p < 0) losses += p;
  }
  if (losses < 0) return wins / Math.abs(losses);
  return wins > 0 ? 999 : 0;
}

function segmentPositive(trades, start, end) {
  const width = (end - start) / 3;
  const sums = [0, 0, 0];
  for (const t of trades) {
    const xt = Number(t.exit_time ?? t.exitTime);
    if (!Number.isFinite(xt) || xt < start || xt >= end) continue;
    const index = Math.min(2, Math.max(0, Math.floor((xt - start) / width)));
    sums[index] += Number(t.profit ?? 0);
  }
  return { posseg: sums.filter((x) => x > 0).length, segProfit: sums };
}

function monthWindows(start, end) {
  const rows = [];
  let cursor = start;
  while (cursor < end) {
    const d = new Date(cursor);
    const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    const stop = Math.min(end, next);
    rows.push({ key: new Date(cursor).toISOString().slice(0, 7), start: cursor, end: stop });
    cursor = stop;
  }
  return rows;
}

function exactMetrics(ctx, start, end, minTrades) {
  const s = ctx?.strategy;
  if (!s) throw new Error('PineTS returned no strategy state');
  const trades = Array.isArray(s.closedtrades) ? s.closedtrades : [];
  const profits = trades.map((t) => Number(t.profit ?? 0)).filter(Number.isFinite);
  const grossProfit = profits.filter((x) => x > 0).reduce((a, b) => a + b, 0);
  const grossLoss = profits.filter((x) => x < 0).reduce((a, b) => a + b, 0);
  const initialCapital = Number(s.initial_capital ?? s.config?.initial_capital ?? 0);
  const netProfit = Number.isFinite(Number(s.netprofit))
    ? Number(s.netprofit)
    : profits.reduce((a, b) => a + b, 0);
  const winCount = profits.filter((x) => x > 0).length;
  const seg = segmentPositive(trades, start, end);
  const profitFactor = grossLoss < 0 ? grossProfit / Math.abs(grossLoss) : grossProfit > 0 ? 999 : 0;
  const pass = trades.length >= minTrades && netProfit > 0 && profitFactor > 1.05 && seg.posseg >= 2;

  const ddCurrency = Number(s.max_drawdown);
  const ddPctState = Number(s.max_drawdown_percent);
  const maxDrawdownPct = Number.isFinite(ddPctState)
    ? ddPctState
    : (Number.isFinite(ddCurrency) && initialCapital > 0 ? (ddCurrency / initialCapital) * 100 : null);

  return {
    trades: trades.length,
    winRate: trades.length ? winCount / trades.length : 0,
    initialCapital,
    netProfit,
    netPct: initialCapital > 0 ? (netProfit / initialCapital) * 100 : null,
    grossProfit,
    grossLoss,
    profitFactor,
    maxDrawdownCurrency: Number.isFinite(ddCurrency) ? ddCurrency : null,
    maxDrawdownPct,
    posseg: seg.posseg,
    segProfit: seg.segProfit,
    pass,
    rawTrades: trades,
  };
}

function monthlyFromTrades(trades, initialCapital) {
  const windows = monthWindows(START_MS, END_MS);
  const sorted = [...trades].sort((a, b) => Number(a.exit_time ?? a.exitTime ?? 0) - Number(b.exit_time ?? b.exitTime ?? 0));
  let realizedBefore = 0;
  const out = [];
  for (const w of windows) {
    const monthTrades = sorted.filter((t) => {
      const xt = Number(t.exit_time ?? t.exitTime);
      return Number.isFinite(xt) && xt >= w.start && xt < w.end;
    });
    const profits = monthTrades.map((t) => Number(t.profit ?? 0)).filter(Number.isFinite);
    const netProfit = profits.reduce((a, b) => a + b, 0);
    const monthStartEquity = initialCapital + realizedBefore;
    const profitFactor = pf(profits);
    const seg = segmentPositive(monthTrades, w.start, w.end);
    const pass = monthTrades.length >= MONTHLY_MIN_TRADES
      && netProfit > 0
      && profitFactor > 1.05
      && seg.posseg >= 2;
    out.push({
      month: w.key,
      trades: monthTrades.length,
      netProfit,
      netPctOnRealizedStartEquity: monthStartEquity > 0 ? (netProfit / monthStartEquity) * 100 : null,
      profitFactor,
      posseg: seg.posseg,
      segProfit: seg.segProfit,
      pass,
    });
    realizedBefore += netProfit;
  }
  return out;
}

function taskCoverage(candles, timeframe) {
  if (candles.length < 2) return { coverage: 0, historyDays: 0 };
  const first = candles[0].openTime;
  const last = candles[candles.length - 1].openTime;
  const historyDays = (last - first + TF_MS[timeframe]) / 86_400_000;
  const expected = Math.max(1, Math.floor((Math.min(END_MS, last + TF_MS[timeframe]) - Math.max(START_MS, first)) / TF_MS[timeframe]));
  return { coverage: candles.length / expected, historyDays };
}

function taskFile(symbol, timeframe) {
  return path.join(checkpointDir, `${symbol}-${timeframe}.json`);
}

async function smoke(source) {
  const file = exportCsv('BTCUSDT', '15m');
  const candles = parseCsv(file).slice(0, 4000);
  if (candles.length < 200) throw new Error('BTCUSDT 15m smoke data unavailable');
  await runSource(source, candles);
}

function csvEscape(value) {
  const s = value == null ? '' : String(value);
  return /[",\n]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s;
}

function writeAcceptedCsv(rows) {
  const fields = ['grade','symbol','timeframe','name','author','sourceSha256','trades','winRate','netPct','profitFactor','maxDrawdownPct','passMonths','positiveMonths'];
  const lines = [fields.join(',')];
  for (const r of rows) {
    lines.push(fields.map((f) => csvEscape(r[f])).join(','));
  }
  fs.writeFileSync(path.join(outDir, 'accepted-9of9-8of9.csv'), lines.join('\n') + '\n', 'utf8');
}

async function main() {
  const fetched = await fetchExactSource();
  const source = fetched.source;

  const sourceRecord = {
    ...meta,
    publicationVersion: fetched.payload?.version ?? null,
    facadeAccess: fetched.payload?.scriptAccess ?? null,
    sourceBytes: Buffer.byteLength(source, 'utf8'),
    exactSourceMutated: false,
    runtime: 'PineTS 0.10.0',
  };
  safeJsonWrite(path.join(outDir, 'source-proof.json'), sourceRecord);

  try {
    await smoke(source);
  } catch (error) {
    safeJsonWrite(path.join(outDir, 'runtime-skip.json'), {
      ...sourceRecord,
      status: 'SKIP_RUNTIME_UNSUPPORTED',
      error: String(error?.stack ?? error),
    });
    console.log(JSON.stringify({ status: 'SKIP_RUNTIME_UNSUPPORTED', key: meta.key, error: String(error?.message ?? error) }));
    return;
  }

  const symbols = universeFromFeather(dataRoot);
  if (symbols.length !== 725) {
    throw new Error(`exact universe guard failed: expected 725 symbols, found ${symbols.length}`);
  }
  const timeframes = ['1m', '5m', '15m', '1h', '4h'];
  const tasks = [];
  for (const symbol of symbols) for (const timeframe of timeframes) tasks.push({ symbol, timeframe });
  const selectedTasks = tasks.filter((_, index) => index % shardCount === shardIndex);
  const totalTasks = selectedTasks.length;
  let done = 0;
  let failures = 0;

  for (const { symbol, timeframe } of selectedTasks) {
      const checkpoint = taskFile(symbol, timeframe);
      if (fs.existsSync(checkpoint)) {
        done += 1;
        continue;
      }

      let row;
      try {
        const csv = exportCsv(symbol, timeframe);
        const candles = parseCsv(csv);
        const qc = taskCoverage(candles, timeframe);
        if (qc.historyDays < MIN_HISTORY_DAYS) {
          row = {
            status: 'SKIP_TOO_SHORT_HISTORY',
            symbol,
            timeframe,
            rows: candles.length,
            ...qc,
          };
        } else if (qc.coverage < MIN_COVERAGE) {
          row = {
            status: 'SKIP_PARTIAL_COVERAGE',
            symbol,
            timeframe,
            rows: candles.length,
            ...qc,
          };
        } else {
          const ctx = await runSource(source, candles);
          const full = exactMetrics(ctx, START_MS, END_MS, MIN_TRADES[timeframe]);
          const monthly = monthlyFromTrades(full.rawTrades, full.initialCapital);
          const passMonths = monthly.filter((m) => m.pass).length;
          const positiveMonths = monthly.filter((m) => m.netProfit > 0).length;
          const grade = full.pass && passMonths === 9
            ? 'A_9_OF_9'
            : full.pass && passMonths === 8
              ? 'B_8_OF_9'
              : 'REJECT';
          row = {
            status: 'OK',
            symbol,
            timeframe,
            rows: candles.length,
            ...qc,
            full: {
              trades: full.trades,
              winRate: full.winRate,
              initialCapital: full.initialCapital,
              netProfit: full.netProfit,
              netPct: full.netPct,
              grossProfit: full.grossProfit,
              grossLoss: full.grossLoss,
              profitFactor: full.profitFactor,
              maxDrawdownCurrency: full.maxDrawdownCurrency,
              maxDrawdownPct: full.maxDrawdownPct,
              posseg: full.posseg,
              segProfit: full.segProfit,
              pass: full.pass,
            },
            monthly,
            passMonths,
            positiveMonths,
            grade,
          };
        }
      } catch (error) {
        failures += 1;
        row = {
          status: 'ERROR',
          symbol,
          timeframe,
          error: String(error?.stack ?? error),
        };
      }

      safeJsonWrite(checkpoint, row);
      done += 1;
      if (done % 25 === 0 || done === totalTasks) {
        console.log(JSON.stringify({
          key: meta.key,
          progress: `${done}/${totalTasks}`,
          failures,
        }));
      }
  }

  const rows = [];
  for (const { symbol, timeframe } of selectedTasks) {
    const file = taskFile(symbol, timeframe);
    if (!fs.existsSync(file)) continue;
    rows.push(JSON.parse(fs.readFileSync(file, 'utf8')));
  }

  const accepted = rows
    .filter((r) => r.status === 'OK' && ['A_9_OF_9', 'B_8_OF_9'].includes(r.grade))
    .map((r) => ({
      grade: r.grade,
      symbol: r.symbol,
      timeframe: r.timeframe,
      name: meta.name,
      author: meta.author,
      sourceSha256: meta.sourceSha256,
      trades: r.full.trades,
      winRate: r.full.winRate,
      netPct: r.full.netPct,
      profitFactor: r.full.profitFactor,
      maxDrawdownPct: r.full.maxDrawdownPct,
      passMonths: r.passMonths,
      positiveMonths: r.positiveMonths,
      monthly: r.monthly,
    }))
    .sort((a, b) =>
      (a.grade === b.grade ? 0 : a.grade === 'A_9_OF_9' ? -1 : 1)
      || Number(b.netPct ?? -Infinity) - Number(a.netPct ?? -Infinity)
    );

  const summary = {
    schemaVersion: 1,
    policy: {
      source: 'EXACT_TRADINGVIEW_PINE',
      sourceMutation: false,
      inputOverrides: false,
      strategyOverrides: false,
      indicatorConversion: false,
      executionRuntime: 'PineTS 0.10.0',
      monthlyScoring: 'exact closed-trade realized PnL by exit month; no synthetic stress-cost override',
    },
    strategy: sourceRecord,
    window: {
      start: new Date(START_MS).toISOString(),
      end: new Date(END_MS).toISOString(),
    },
    universe: {
      symbols: symbols.length,
      timeframes,
      tasks: rows.length,
      shardIndex,
      shardCount,
    },
    counts: {
      ok: rows.filter((r) => r.status === 'OK').length,
      errors: rows.filter((r) => r.status === 'ERROR').length,
      tooShortHistory: rows.filter((r) => r.status === 'SKIP_TOO_SHORT_HISTORY').length,
      partialCoverage: rows.filter((r) => r.status === 'SKIP_PARTIAL_COVERAGE').length,
      nineOfNine: accepted.filter((r) => r.grade === 'A_9_OF_9').length,
      eightOfNine: accepted.filter((r) => r.grade === 'B_8_OF_9').length,
    },
    accepted,
  };

  safeJsonWrite(path.join(outDir, 'summary.json'), summary);
  writeAcceptedCsv(accepted);
  fs.writeFileSync(
    path.join(outDir, 'task-results.ndjson'),
    rows.map((r) => JSON.stringify(r)).join('\n') + '\n',
    'utf8',
  );
  console.log(JSON.stringify({ status: 'DONE', key: meta.key, counts: summary.counts }));
}

await main();
