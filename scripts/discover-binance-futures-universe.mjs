import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const output = process.argv[2] ?? "artifacts/scalp-universe/universe.json";

function decodeXml(s) {
  return s
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

function ymd(d) {
  return [
    d.getUTCFullYear(),
    String(d.getUTCMonth() + 1).padStart(2, "0"),
    String(d.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

async function fromExchangeInfo() {
  const r = await fetch("https://fapi.binance.com/fapi/v1/exchangeInfo");
  if (!r.ok) throw new Error("fapi exchangeInfo HTTP " + r.status);
  const j = await r.json();
  return j.symbols
    .filter(x =>
      x.contractType === "PERPETUAL" &&
      x.quoteAsset === "USDT" &&
      x.status === "TRADING"
    )
    .map(x => x.symbol)
    .filter(x => /^[A-Z0-9]+USDT$/.test(x))
    .sort();
}

async function fromVisionFolders() {
  const prefix = "data/futures/um/daily/klines/";
  let token = null;
  const symbols = new Set();

  for (let page = 0; page < 20; page++) {
    const u = new URL("https://data.binance.vision/");
    u.searchParams.set("list-type", "2");
    u.searchParams.set("prefix", prefix);
    u.searchParams.set("delimiter", "/");
    if (token) u.searchParams.set("continuation-token", token);

    const r = await fetch(u);
    if (!r.ok) throw new Error("vision listing HTTP " + r.status);
    const xml = await r.text();

    for (const m of xml.matchAll(/<Prefix>data\/futures\/um\/daily\/klines\/([^/]+)\/<\/Prefix>/g)) {
      const s = decodeXml(m[1]);
      if (/^[A-Z0-9]+USDT$/.test(s)) symbols.add(s);
    }

    const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
    const next = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/)?.[1];
    if (!truncated || !next) break;
    token = decodeXml(next);
  }
  return [...symbols].sort();
}

async function recentArchiveExists(symbol) {
  const dates = [1, 2].map(delta => {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - delta);
    return ymd(d);
  });

  for (const day of dates) {
    const name = symbol + "-1m-" + day + ".zip";
    const url =
      "https://data.binance.vision/data/futures/um/daily/klines/" +
      symbol +
      "/1m/" +
      name;
    const r = await fetch(url, { method: "HEAD" });
    if (r.ok) return true;
    if (![404, 405].includes(r.status)) return true;
  }
  return false;
}

async function filterConcurrent(items, limit, fn) {
  const keep = new Array(items.length).fill(false);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (true) {
        const i = cursor++;
        if (i >= items.length) return;
        try {
          keep[i] = await fn(items[i]);
        } catch {
          keep[i] = true;
        }
      }
    }),
  );
  return items.filter((_, i) => keep[i]);
}

let source = "fapi_exchangeInfo";
let symbols;
try {
  symbols = await fromExchangeInfo();
} catch {
  source = "data.binance.vision_folder_plus_recent_archive";
  const folders = await fromVisionFolders();
  symbols = await filterConcurrent(folders, 24, recentArchiveExists);
}

const payload = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  market: "Binance USD-M perpetual USDT",
  source,
  count: symbols.length,
  symbols,
};

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(payload, null, 2) + "\n");
console.log(
  JSON.stringify(
    {
      output,
      source,
      count: symbols.length,
      first: symbols.slice(0, 10),
      last: symbols.slice(-10),
    },
    null,
    2,
  ),
);
