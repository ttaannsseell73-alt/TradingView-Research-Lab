import fs from 'node:fs';
import process from 'node:process';

const symbol = (process.argv[2] ?? 'BTCUSDT').toUpperCase();
const interval = process.argv[3] ?? '1m';
const target = Number(process.argv[4] ?? 5000);
const output = process.argv[5] ?? `${symbol}-${interval}.csv`;

if (!/^[A-Z0-9]+$/.test(symbol)) throw new Error('Invalid symbol');
if (!/^\d+[mhdwM]$/.test(interval)) throw new Error('Invalid Binance interval');
if (!Number.isInteger(target) || target < 30 || target > 100000) throw new Error('bars must be an integer between 30 and 100000');

const collected = new Map();
let endTime = Date.now();
while (collected.size < target) {
  const limit = Math.min(1500, target - collected.size);
  const params = new URLSearchParams({ symbol, interval, limit: String(limit), endTime: String(endTime) });
  const response = await fetch(`https://fapi.binance.com/fapi/v1/klines?${params}`);
  if (!response.ok) throw new Error(`Binance HTTP ${response.status}: ${await response.text()}`);
  const page = await response.json();
  if (!Array.isArray(page) || page.length === 0) break;
  for (const row of page) {
    const timestamp = Number(row[0]);
    collected.set(timestamp, [timestamp, row[1], row[2], row[3], row[4], row[5]]);
  }
  endTime = Number(page[0][0]) - 1;
  if (page.length < limit) break;
}

const rows = [...collected.values()].sort((a, b) => a[0] - b[0]).slice(-target);
if (rows.length < 30) throw new Error(`Only ${rows.length} candles returned`);
const csv = ['timestamp,open,high,low,close,volume', ...rows.map((row) => row.join(','))].join('\n') + '\n';
fs.writeFileSync(output, csv, 'utf8');
console.log(JSON.stringify({ symbol, interval, candles: rows.length, output }, null, 2));
