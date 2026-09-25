import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const symbol = (process.argv[2] ?? "BTCUSDT").toUpperCase();
const bars1m = Number(process.argv[3] ?? 10000);
const bars5m = Number(process.argv[4] ?? 3000);
const outDir = process.argv[5] ?? "artifacts/scalp-smoke";

fs.mkdirSync(outDir, { recursive: true });

const one = path.join(outDir, `${symbol}-1m.csv`);
const five = path.join(outDir, `${symbol}-5m.csv`);
const result = path.join(outDir, `${symbol}-SCALP.json`);
const diagnostics = path.join(outDir, `${symbol}-DIAGNOSTICS.json`);

function run(args) {
  const x = spawnSync(process.execPath, args, {
    stdio: "inherit",
    env: process.env,
  });
  if (x.status !== 0) process.exit(x.status ?? 1);
}

run(["scripts/fetch-binance.mjs", symbol, "1m", String(bars1m), one]);
run(["scripts/fetch-binance.mjs", symbol, "5m", String(bars5m), five]);
run(["scripts/run-scalp-replay.mjs", symbol, one, five, result]);
run(["scripts/run-scalp-diagnostics.mjs", symbol, one, five, diagnostics]);

console.log(JSON.stringify({ symbol, result, diagnostics }, null, 2));
