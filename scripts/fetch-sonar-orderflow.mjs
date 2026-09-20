import fs from 'node:fs';
import process from 'node:process';

const symbol = (process.argv[2] ?? 'BTCUSDT').toUpperCase();
const days = Number(process.argv[3] ?? 29);
const output = process.argv[4] ?? `${symbol}-sonar-orderflow-5m.csv`;

if (!/^[A-Z0-9]+$/.test(symbol)) throw new Error('Invalid symbol');
if (!Number.isFinite(days) || days < 1 || days > 29.5) throw new Error('days must be between 1 and 29.5');

const base = 'https://fapi.binance.com';
const period = '5m';
const periodMs = 5 * 60_000;
const now = Date.now();
const start = now - Math.floor(days * 24 * 60 * 60_000);

async function fetchWindow(path, cursor, endTime) {
  const params = new URLSearchParams({
    symbol,
    period,
    limit: '500',
    startTime: String(cursor),
    endTime: String(endTime),
  });
  const response = await fetch(`${base}${path}?${params}`);
  if (!response.ok) throw new Error(`${path} HTTP ${response.status}: ${await response.text()}`);
  const json = await response.json();
  if (!Array.isArray(json)) throw new Error(`${path} returned non-array`);
  return json;
}

async function collect(path) {
  const rows = new Map();
  let cursor = start;
  while (cursor <= now) {
    const endTime = Math.min(now, cursor + (500 * periodMs) - 1);
    const page = await fetchWindow(path, cursor, endTime);
    for (const row of page) {
      const timestamp = Number(row.timestamp);
      if (Number.isFinite(timestamp)) rows.set(timestamp, row);
    }
    cursor = endTime + 1;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  return rows;
}

const taker = await collect('/futures/data/takerlongshortRatio');
const oi = await collect('/futures/data/openInterestHist');
const timestamps = [...taker.keys()].filter((timestamp) => oi.has(timestamp)).sort((a, b) => a - b);
if (timestamps.length < 1000) throw new Error(`Only ${timestamps.length} merged 5m orderflow rows returned`);

const lines = ['timestamp,buyVol,sellVol,buySellRatio,openInterest,openInterestValue'];
for (const timestamp of timestamps) {
  const t = taker.get(timestamp);
  const o = oi.get(timestamp);
  lines.push([
    timestamp,
    t.buyVol,
    t.sellVol,
    t.buySellRatio,
    o.sumOpenInterest,
    o.sumOpenInterestValue,
  ].join(','));
}
fs.writeFileSync(output, lines.join('\n') + '\n', 'utf8');
console.log(JSON.stringify({
  symbol,
  period,
  days,
  takerRows: taker.size,
  openInterestRows: oi.size,
  mergedRows: timestamps.length,
  firstTimestamp: timestamps[0],
  lastTimestamp: timestamps.at(-1),
  output,
}, null, 2));
