import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { replayScalpSuite } from "../research/scalp_replay.mjs";

const symbol = (process.argv[2] ?? "BTCUSDT").toUpperCase();
const onePath = process.argv[3];
const fivePath = process.argv[4];
const output = process.argv[5] ?? `artifacts/scalp/${symbol}.json`;

if (!onePath || !fivePath) {
  console.error("Usage: node scripts/run-scalp-replay.mjs SYMBOL 1M.csv 5M.csv [OUTPUT.json]");
  process.exit(2);
}

function readCsv(file) {
  const lines = fs.readFileSync(file, "utf8").trim().split(/\r?\n/);
  const rows = [];
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const [t, o, h, l, c, v] = line.split(",").map(Number);
    if (![t, o, h, l, c, v].every(Number.isFinite)) continue;
    rows.push({ t, o, h, l, c, v });
  }
  rows.sort((a, b) => a.t - b.t);
  return rows;
}

const candles1m = readCsv(onePath);
const candles5m = readCsv(fivePath);

if (candles1m.length < 200) throw new Error("Need at least 200 one-minute candles");
if (candles5m.length < 50) throw new Error("Need at least 50 five-minute candles");

const results = replayScalpSuite({
  candles1m,
  candles5m,
  leverage: 5,
  feePctPerSide: 0.04,
  slippagePctPerSide: 0.02,
  activationNetRoePct: 1.0,
  hardRealiseNetRoePct: 5.0,
  stopNetRoePct: -2.5,
  maxGivebackFraction: 0.35,
  minGivebackPctPoints: 0.35,
  maxHoldBars: 12,
  requireContextAlignment: true,
});

const compact = results.map(r => ({
  setup: r.setupId,
  status: r.candidate.status,
  score: r.candidate.score,
  reasons: r.candidate.reasons,
  trades: r.all.trades,
  expectancyNetRoePct: r.all.netExpectancyPct,
  profitFactor: r.all.profitFactor,
  netPct: r.all.netPct,
  maxDrawdownPct: r.all.maxDrawdownPct,
  validationPF: r.validation.profitFactor,
  validationNetPct: r.validation.netPct,
  holdoutPF: r.holdout.profitFactor,
  holdoutNetPct: r.holdout.netPct,
  winRate: r.all.winRate,
  exitReasons: r.trades.reduce((acc, t) => {
    acc[t.exitReason] = (acc[t.exitReason] ?? 0) + 1;
    return acc;
  }, {}),
}));

compact.sort((a, b) =>
  (b.status === "PASS") - (a.status === "PASS") ||
  b.score - a.score ||
  b.expectancyNetRoePct - a.expectancyNetRoePct
);

const out = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  symbol,
  bars: { oneMinute: candles1m.length, fiveMinute: candles5m.length },
  assumptions: {
    leverage: 5,
    feePctPerSide: 0.04,
    slippagePctPerSide: 0.02,
    activationNetRoePct: 1.0,
    hardRealiseNetRoePct: 5.0,
    stopNetRoePct: -2.5,
    maxHoldBars: 12,
    note: "Smoke research only. PASS requires later broader universe, longer history and stressed execution validation.",
  },
  results: compact,
};

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out, null, 2));
