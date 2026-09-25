import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.argv[2] ?? "artifacts/scalp-universe";
const out = process.argv[3] ?? "artifacts/scalp-universe-report";
fs.mkdirSync(out, { recursive: true });

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, files);
    else if (e.name === "rows.jsonl") files.push(p);
  }
  return files;
}

const rows = [];
for (const f of walk(root)) {
  for (const line of fs
    .readFileSync(f, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)) {
    rows.push(JSON.parse(line));
  }
}

const statusRank = { PASS: 3, EVIDENCE_REVIEW: 2, REJECT: 1 };
rows.sort(
  (a, b) =>
    (statusRank[b.status] ?? 0) - (statusRank[a.status] ?? 0) ||
    b.score - a.score ||
    b.holdoutNetPct - a.holdoutNetPct ||
    b.validationNetPct - a.validationNetPct ||
    b.netExpectancyPct - a.netExpectancyPct,
);

const directional = rows.filter(r => r.direction !== "ALL");
const symbols = [...new Set(rows.map(r => r.symbol))];
const systems = [...new Set(rows.map(r => r.systemId))];
const bestByCoin = symbols
  .map(symbol => directional.find(r => r.symbol === symbol))
  .filter(Boolean);
const bestBySystem = systems
  .map(systemId => directional.find(r => r.systemId === systemId))
  .filter(Boolean);

const cols = [
  "symbol",
  "systemId",
  "sourceType",
  "direction",
  "trades",
  "status",
  "score",
  "netExpectancyPct",
  "profitFactor",
  "netPct",
  "maxDrawdownPct",
  "winRate",
  "validationNetPct",
  "validationPF",
  "holdoutNetPct",
  "holdoutPF",
  "reasons",
];

function esc(x) {
  return '"' + String(x ?? "").replaceAll('"', '""') + '"';
}
function csv(data) {
  return (
    [
      cols.join(","),
      ...data.map(r =>
        cols
          .map(c =>
            esc(
              c === "reasons"
                ? (r.reasons ?? []).join("|")
                : r[c],
            ),
          )
          .join(","),
      ),
    ].join("\n") + "\n"
  );
}

const counts = rows.reduce((acc, r) => {
  acc[r.status] = (acc[r.status] ?? 0) + 1;
  return acc;
}, {});

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  symbols: symbols.length,
  systems: systems.length,
  rows: rows.length,
  statusCounts: counts,
  top: rows.slice(0, 500),
  coinBest: bestByCoin,
  systemBest: bestBySystem,
};

fs.writeFileSync(
  path.join(out, "SCALP_UNIVERSE_REPORT.json"),
  JSON.stringify(report, null, 2) + "\n",
);
fs.writeFileSync(
  path.join(out, "SCALP_UNIVERSE_RANKING.csv"),
  csv(rows),
);
fs.writeFileSync(
  path.join(out, "COIN_BEST.csv"),
  csv(bestByCoin),
);
fs.writeFileSync(
  path.join(out, "SYSTEM_BEST.csv"),
  csv(bestBySystem),
);

const md = [
  "# Binance Futures scalp universe report",
  "",
  "Symbols processed: **" + symbols.length + "**  ",
  "Executable systems: **" + systems.length + "**  ",
  "Directional/all rows: **" + rows.length + "**  ",
  "PASS: **" +
    (counts.PASS ?? 0) +
    "** · EVIDENCE_REVIEW: **" +
    (counts.EVIDENCE_REVIEW ?? 0) +
    "** · REJECT: **" +
    (counts.REJECT ?? 0) +
    "**",
  "",
  "## Top coin × system × direction rows",
  "",
  "| Rank | Coin | System | Dir | Trades | Status | Score | Exp ROE % | Val PF | Hold PF | Hold Net % | DD % |",
  "|---:|---|---|---|---:|---|---:|---:|---:|---:|---:|---:|",
];

for (const [i, r] of rows.slice(0, 200).entries()) {
  md.push(
    "| " +
      (i + 1) +
      " | " +
      r.symbol +
      " | " +
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

md.push(
  "",
  "## Best directional row per coin",
  "",
  "| Coin | System | Dir | Status | Score | Trades | Exp ROE % | Hold PF | Hold Net % |",
  "|---|---|---|---|---:|---:|---:|---:|---:|",
);

for (const r of bestByCoin) {
  md.push(
    "| " +
      r.symbol +
      " | " +
      r.systemId +
      " | " +
      r.direction +
      " | " +
      r.status +
      " | " +
      Number(r.score).toFixed(2) +
      " | " +
      r.trades +
      " | " +
      Number(r.netExpectancyPct).toFixed(4) +
      " | " +
      Number(r.holdoutPF).toFixed(3) +
      " | " +
      Number(r.holdoutNetPct).toFixed(2) +
      " |",
  );
}
md.push("");

fs.writeFileSync(
  path.join(out, "SCALP_UNIVERSE_REPORT.md"),
  md.join("\n"),
);

console.log(
  JSON.stringify(
    {
      symbols: symbols.length,
      systems: systems.length,
      rows: rows.length,
      statusCounts: counts,
      out,
    },
    null,
    2,
  ),
);
