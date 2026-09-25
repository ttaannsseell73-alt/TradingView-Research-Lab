import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { buildScalpDiagnosticMatrix } from "../research/scalp_diagnostics.mjs";

const symbol = (process.argv[2] ?? "BTCUSDT").toUpperCase();
const onePath = process.argv[3];
const fivePath = process.argv[4];
const output = process.argv[5] ?? `artifacts/scalp/${symbol}-DIAGNOSTICS.json`;

if (!onePath || !fivePath) {
  console.error("Usage: node scripts/run-scalp-diagnostics.mjs SYMBOL 1M.csv 5M.csv [OUTPUT.json]");
  process.exit(2);
}

function readCsv(file) {
  return fs.readFileSync(file, "utf8")
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .filter(Boolean)
    .map(line => {
      const [t, o, h, l, c, v] = line.split(",").map(Number);
      return { t, o, h, l, c, v };
    })
    .filter(b => [b.t,b.o,b.h,b.l,b.c,b.v].every(Number.isFinite))
    .sort((a,b) => a.t-b.t);
}

const candles1m = readCsv(onePath);
const candles5m = readCsv(fivePath);
const matrix = buildScalpDiagnosticMatrix({ candles1m, candles5m, leverage: 5 });

const compact = {
  ...matrix,
  symbol,
  bars: { oneMinute: candles1m.length, fiveMinute: candles5m.length },
  rows: matrix.rows.map(r => ({
    setupId: r.setupId,
    costProfile: r.costProfile,
    exitProfile: r.exitProfile,
    all: r.all,
    train: r.train,
    validation: r.validation,
    holdout: r.holdout,
    side: r.side,
    eventType: r.eventType,
    alignment: r.alignment,
    diagnosticFlags: r.diagnosticFlags,
  })),
};

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(compact, null, 2) + "\n");

console.log(JSON.stringify({
  symbol,
  combinations: matrix.rows.length,
  topDiagnostics: matrix.diagnosticRanking.slice(0, 8),
  output,
}, null, 2));
