import fs from 'node:fs';
import process from 'node:process';
import { inflateRawSync } from 'node:zlib';

const symbol = (process.argv[2] ?? 'BTCUSDT').toUpperCase();
const interval = process.argv[3] ?? '1m';
const target = Number(process.argv[4] ?? 5000);
const output = process.argv[5] ?? `${symbol}-${interval}.csv`;

if (!/^[A-Z0-9]+$/.test(symbol)) throw new Error('Invalid symbol');
if (!/^\d+[mhdwM]$/.test(interval)) throw new Error('Invalid Binance interval');
if (!Number.isInteger(target) || target < 30 || target > 100000) throw new Error('bars must be an integer between 30 and 100000');

function parseKlineCsv(text, collected) {
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cols = line.split(',');
    const timestamp = Number(cols[0]);
    if (!Number.isFinite(timestamp)) continue;
    const row = [
      timestamp,
      Number(cols[1]),
      Number(cols[2]),
      Number(cols[3]),
      Number(cols[4]),
      Number(cols[5]),
    ];
    if (!row.every(Number.isFinite)) continue;
    collected.set(timestamp, row);
  }
}

function extractFirstZipEntry(buffer) {
  const CENTRAL = 0x02014b50;
  let central = -1;
  for (let i = buffer.length - 46; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === CENTRAL) {
      central = i;
      break;
    }
  }
  if (central < 0) throw new Error('ZIP central directory not found');

  const method = buffer.readUInt16LE(central + 10);
  const compressedSize = buffer.readUInt32LE(central + 20);
  const localOffset = buffer.readUInt32LE(central + 42);

  if (buffer.readUInt32LE(localOffset) !== 0x04034b50) {
    throw new Error('ZIP local header not found');
  }

  const fileNameLength = buffer.readUInt16LE(localOffset + 26);
  const extraLength = buffer.readUInt16LE(localOffset + 28);
  const dataStart = localOffset + 30 + fileNameLength + extraLength;
  const compressed = buffer.subarray(dataStart, dataStart + compressedSize);

  if (method === 0) return compressed;
  if (method === 8) return inflateRawSync(compressed);
  throw new Error(`Unsupported ZIP compression method: ${method}`);
}

async function fetchFromRest() {
  const collected = new Map();
  let endTime = Date.now();

  while (collected.size < target) {
    const limit = Math.min(1500, target - collected.size);
    const params = new URLSearchParams({
      symbol,
      interval,
      limit: String(limit),
      endTime: String(endTime),
    });
    const response = await fetch(`https://fapi.binance.com/fapi/v1/klines?${params}`);

    if (!response.ok) {
      const body = await response.text();
      const error = new Error(`Binance HTTP ${response.status}: ${body}`);
      error.status = response.status;
      throw error;
    }

    const page = await response.json();
    if (!Array.isArray(page) || page.length === 0) break;

    for (const row of page) {
      const timestamp = Number(row[0]);
      collected.set(timestamp, [
        timestamp,
        Number(row[1]),
        Number(row[2]),
        Number(row[3]),
        Number(row[4]),
        Number(row[5]),
      ]);
    }

    endTime = Number(page[0][0]) - 1;
    if (page.length < limit) break;
  }

  return collected;
}

function ymd(date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

async function fetchFromVision() {
  const collected = new Map();
  const cursor = new Date();
  cursor.setUTCHours(0, 0, 0, 0);
  cursor.setUTCDate(cursor.getUTCDate() - 1);

  let attempts = 0;
  const maxDays = 120;

  while (collected.size < target && attempts < maxDays) {
    const day = ymd(cursor);
    const filename = `${symbol}-${interval}-${day}.zip`;
    const url = `https://data.binance.vision/data/futures/um/daily/klines/${symbol}/${interval}/${filename}`;

    const response = await fetch(url);
    if (response.ok) {
      const zip = Buffer.from(await response.arrayBuffer());
      const csv = extractFirstZipEntry(zip).toString('utf8');
      parseKlineCsv(csv, collected);
    } else if (response.status !== 404) {
      throw new Error(`Binance Vision HTTP ${response.status}: ${await response.text()}`);
    }

    cursor.setUTCDate(cursor.getUTCDate() - 1);
    attempts++;
  }

  return collected;
}

let collected;
let source = 'fapi-rest';

try {
  collected = await fetchFromRest();
} catch (error) {
  if (![403, 451].includes(Number(error?.status))) throw error;
  source = 'data.binance.vision';
  collected = await fetchFromVision();
}

const rows = [...collected.values()]
  .sort((a, b) => a[0] - b[0])
  .slice(-target);

if (rows.length < 30) throw new Error(`Only ${rows.length} candles returned from ${source}`);

const csv = [
  'timestamp,open,high,low,close,volume',
  ...rows.map((row) => row.join(',')),
].join('\n') + '\n';

fs.writeFileSync(output, csv, 'utf8');
console.log(JSON.stringify({
  symbol,
  interval,
  candles: rows.length,
  output,
  source,
}, null, 2));
