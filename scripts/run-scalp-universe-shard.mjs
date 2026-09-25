import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";

import { SCALP_SETUPS } from "../research/scalp_signal_engine.mjs";
import { STRATEGIES } from "../research/strategy_engine_v2.mjs";
import { replayScalpSetup } from "../research/scalp_replay.mjs";
import {
  replayStrategyAsScalp,
  summarizeCandidateTrades,
} from "../research/scalp_strategy_replay.mjs";

const universePath = process.argv[2];
const shardIndex = Number(process.argv[3] ?? 0);
const shardCount = Number(process.argv[4] ?? 1);
const bars1m = Number(process.argv[5] ?? 10000);
const bars5m = Number(process.argv[6] ?? 3000);
const outDir =
  process.argv[7] ?? "artifacts/scalp-universe/shard-" + shardIndex;

if (!universePath) {
  throw new Error(
    "Usage: node scripts/run-scalp-universe-shard.mjs universe.json shardIndex shardCount [bars1m] [bars5m] [outDir]",
  );
}
if (
  !Number.isInteger(shardIndex) ||
  !Number.isInteger(shardCount) ||
  shardIndex < 0 ||
  shardIndex >= shardCount
) {
  throw new Error("Invalid shard args");
}

function readCsv(file) {
  return fs
    .readFileSync(file, "utf8")
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .filter(Boolean)
    .map(line => {
      const [t, o, h, l, c, v] = line.split(",").map(Number);
      return { t, o, h, l, c, v };
    })
    .filter(b =>
      [b.t, b.o, b.h, b.l, b.c, b.v].every(Number.isFinite),
    )
    .sort((a, b) => a.t - b.t);
}

function candidateRow(
  symbol,
  systemId,
  sourceType,
  direction,
  trades,
  allResult = null,
) {
  const stats =
    direction === "ALL" && allResult
      ? {
          all: allResult.all,
          train: allResult.train,
          validation: allResult.validation,
          holdout: allResult.holdout,
          candidate: allResult.candidate,
        }
      : summarizeCandidateTrades(trades);

  return {
    symbol,
    systemId,
    sourceType,
    direction,
    trades: stats.all.trades,
    grossExpectancyPct: stats.all.grossExpectancyPct,
    netExpectancyPct: stats.all.netExpectancyPct,
    profitFactor: stats.all.profitFactor,
    netPct: stats.all.netPct,
    maxDrawdownPct: stats.all.maxDrawdownPct,
    winRate: stats.all.winRate,
    avgMfeGrossRoePct: stats.all.avgMfeGrossRoePct,
    avgMaeGrossRoePct: stats.all.avgMaeGrossRoePct,
    avgHoldingBars: stats.all.avgHoldingBars,
    validationNetPct: stats.validation.netPct,
    validationPF: stats.validation.profitFactor,
    holdoutNetPct: stats.holdout.netPct,
    holdoutPF: stats.holdout.profitFactor,
    status: stats.candidate.status,
    score: stats.candidate.score,
    reasons: stats.candidate.reasons,
  };
}

function rowsForResult(symbol, systemId, sourceType, result) {
  return [
    candidateRow(
      symbol,
      systemId,
      sourceType,
      "ALL",
      result.trades,
      result,
    ),
    candidateRow(
      symbol,
      systemId,
      sourceType,
      "LONG",
      result.trades.filter(t => t.side === "LONG"),
    ),
    candidateRow(
      symbol,
      systemId,
      sourceType,
      "SHORT",
      result.trades.filter(t => t.side === "SHORT"),
    ),
  ];
}

function mdForSymbol(symbol, rows) {
  const statusRank = { PASS: 3, EVIDENCE_REVIEW: 2, REJECT: 1 };
  const rank = [...rows].sort(
    (a, b) =>
      (statusRank[b.status] ?? 0) - (statusRank[a.status] ?? 0) ||
      b.score - a.score ||
      b.holdoutNetPct - a.holdoutNetPct ||
      b.netExpectancyPct - a.netExpectancyPct,
  );

  const lines = [
    "# " + symbol + " scalp universe report",
    "",
    "Canonical screen: 1m trigger + closed 5m structural context, x5 leverage, base estimated fee/slippage, balanced dynamic exit, chronological 60/20/20 split.",
    "",
    "| System | Dir | Trades | Status | Score | Exp ROE % | Val PF | Hold PF | Hold Net % | DD % |",
    "|---|---:|---:|---|---:|---:|---:|---:|---:|---:|",
  ];

  for (const r of rank) {
    lines.push(
      "| " +
        r.systemId +
        " | " +
        r.direction +
        " | " +
        r.trades +
        " | " +
        r.status +
        " | " +
        Number(r.score).toFixed(2) +
        " | " +
        Number(r.netExpectancyPct).toFixed(4) +
        " | " +
        Number(r.validationPF).toFixed(3) +
        " | " +
        Number(r.holdoutPF).toFixed(3) +
        " | " +
        Number(r.holdoutNetPct).toFixed(2) +
        " | " +
        Number(r.maxDrawdownPct).toFixed(2) +
        " |",
    );
  }
  lines.push("");
  return lines.join("\n");
}

const universe = JSON.parse(fs.readFileSync(universePath, "utf8"));
const symbols = universe.symbols.filter(
  (_, i) => i % shardCount === shardIndex,
);

fs.mkdirSync(outDir, { recursive: true });
const rows = [];
const processed = [];
const skipped = [];

for (const symbol of symbols) {
  const cache = path.join(outDir, "cache", symbol);
  fs.mkdirSync(cache, { recursive: true });
  const one = path.join(cache, "1m.csv");
  const five = path.join(cache, "5m.csv");

  try {
    execFileSync(
      process.execPath,
      ["scripts/fetch-binance.mjs", symbol, "1m", String(bars1m), one],
      { stdio: "pipe" },
    );
    execFileSync(
      process.execPath,
      ["scripts/fetch-binance.mjs", symbol, "5m", String(bars5m), five],
      { stdio: "pipe" },
    );

    const candles1m = readCsv(one);
    const candles5m = readCsv(five);
    if (candles1m.length < 500 || candles5m.length < 150) {
      throw new Error(
        "insufficient bars " +
          candles1m.length +
          "/" +
          candles5m.length,
      );
    }

    const symbolRows = [];

    for (const setupId of SCALP_SETUPS) {
      const r = replayScalpSetup({
        candles1m,
        candles5m,
        setupId,
        leverage: 5,
        feePctPerSide: 0.04,
        slippagePctPerSide: 0.02,
        activationNetRoePct: 0.6,
        hardRealiseNetRoePct: 2.5,
        stopNetRoePct: -1.6,
        maxGivebackFraction: 0.33,
        minGivebackPctPoints: 0.25,
        maxHoldBars: 8,
        requireContextAlignment: true,
      });
      symbolRows.push(
        ...rowsForResult(symbol, setupId, "PA_NATIVE", r),
      );
    }

    for (const strategy of STRATEGIES) {
      const r = replayStrategyAsScalp({
        candles1m,
        candles5m,
        strategyId: strategy.id,
        leverage: 5,
        feePctPerSide: 0.04,
        slippagePctPerSide: 0.02,
        activationNetRoePct: 0.6,
        hardRealiseNetRoePct: 2.5,
        stopNetRoePct: -1.6,
        maxGivebackFraction: 0.33,
        minGivebackPctPoints: 0.25,
        maxHoldBars: 8,
        requireContextAlignment: true,
      });
      symbolRows.push(
        ...rowsForResult(
          symbol,
          strategy.id,
          "TV_KIVANC_ADAPTER",
          r,
        ),
      );
    }

    rows.push(...symbolRows);
    fs.writeFileSync(
      path.join(outDir, symbol + ".json"),
      JSON.stringify(
        {
          symbol,
          bars: {
            oneMinute: candles1m.length,
            fiveMinute: candles5m.length,
          },
          rows: symbolRows,
        },
        null,
        2,
      ) + "\n",
    );
    fs.writeFileSync(
      path.join(outDir, symbol + ".md"),
      mdForSymbol(symbol, symbolRows),
    );
    processed.push(symbol);
  } catch (error) {
    skipped.push({
      symbol,
      error: String(error?.message ?? error),
    });
  } finally {
    fs.rmSync(cache, { recursive: true, force: true });
  }
}

fs.writeFileSync(
  path.join(outDir, "rows.jsonl"),
  rows.map(x => JSON.stringify(x)).join("\n") +
    (rows.length ? "\n" : ""),
);

fs.writeFileSync(
  path.join(outDir, "summary.json"),
  JSON.stringify(
    {
      shardIndex,
      shardCount,
      bars1m,
      bars5m,
      executableSystems: SCALP_SETUPS.length + STRATEGIES.length,
      assigned: symbols.length,
      processed: processed.length,
      skipped: skipped.length,
      processedSymbols: processed,
      skippedSymbols: skipped,
      generatedAt: new Date().toISOString(),
    },
    null,
    2,
  ) + "\n",
);

console.log(
  JSON.stringify(
    {
      shardIndex,
      assigned: symbols.length,
      processed: processed.length,
      skipped: skipped.length,
      rows: rows.length,
      outDir,
    },
    null,
    2,
  ),
);
