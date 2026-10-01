from __future__ import annotations
import json
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import polars as pl

BASES = [
    "https://fapi.binance.com",
    "https://fapi1.binance.com",
    "https://fapi2.binance.com",
]
START_MS = int(datetime(2026, 9, 30, tzinfo=timezone.utc).timestamp() * 1000)
END_MS = int(datetime(2026, 10, 1, tzinfo=timezone.utc).timestamp() * 1000)
TF_MS = {"1m": 60_000, "5m": 300_000, "15m": 900_000, "1h": 3_600_000, "4h": 14_400_000}

def get_klines(symbol: str):
    params = {"symbol": symbol, "interval": "1m", "startTime": START_MS, "endTime": END_MS - 1, "limit": 1500}
    last = None
    for base in BASES:
        url = base + "/fapi/v1/klines?" + urlencode(params)
        for attempt in range(4):
            try:
                req = Request(url, headers={"User-Agent": "NightResearch/20261001", "Accept": "application/json"})
                with urlopen(req, timeout=30) as r:
                    return json.loads(r.read().decode("utf-8"))
            except HTTPError as e:
                last = RuntimeError(f"HTTP {e.code}")
                wait = e.headers.get("Retry-After")
                if e.code == 429 and wait:
                    time.sleep(min(30, float(wait)))
                elif attempt < 3:
                    time.sleep(1.5 * (attempt + 1))
            except Exception as e:
                last = e
                if attempt < 3:
                    time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"{symbol}: {last}")

def normalize(raw):
    rows = []
    for k in raw:
        t = int(k[0])
        if START_MS <= t < END_MS:
            rows.append((t, float(k[1]), float(k[2]), float(k[3]), float(k[4]), float(k[5])))
    return pl.DataFrame(rows, schema=["t", "o", "h", "l", "c", "v"], orient="row").sort("t")
def derive(base: pl.DataFrame, tf: str) -> pl.DataFrame:
    if tf == "1m":
        return base
    bucket = TF_MS[tf]
    return (
        base.with_columns(((pl.col("t") // bucket) * bucket).alias("_bucket"))
        .group_by("_bucket", maintain_order=True)
        .agg(
            pl.col("o").first().alias("o"),
            pl.col("h").max().alias("h"),
            pl.col("l").min().alias("l"),
            pl.col("c").last().alias("c"),
            pl.col("v").sum().alias("v"),
        )
        .rename({"_bucket": "t"})
        .sort("t")
    )

def last_csv_t(path: Path) -> int:
    if not path.exists() or path.stat().st_size < 10:
        return -1
    with path.open("rb") as f:
        f.seek(max(0, path.stat().st_size - 4096))
        tail = f.read().decode("utf-8", "ignore").strip().splitlines()
    if not tail:
        return -1
    try:
        return int(tail[-1].split(",", 1)[0])
    except Exception:
        return -1

def append_frame(path: Path, frame: pl.DataFrame):
    if frame.is_empty():
        return
    text = frame.write_csv(include_header=False)
    with path.open("a", encoding="utf-8", newline="") as f:
        f.write(text)

def main():
    root = Path(__file__).resolve().parents[1] / "research" / "full-reset-20261001"
    cache = root / "cache-6m"
    symbols = (root / "eligible_6m_symbols.txt").read_text(encoding="utf-8").splitlines()
    report_path = root / "sep30-patch-report.json"
    report = {"requested": len(symbols), "ok": 0, "skipped": 0, "failed": 0, "results": []}
    for i, symbol in enumerate(symbols, 1):
        try:
            one_min = cache / f"{symbol}-1m.csv"
            if last_csv_t(one_min) >= END_MS - 60_000:
                report["skipped"] += 1
                report["results"].append({"symbol": symbol, "status": "ALREADY_COMPLETE"})
                continue
            raw = get_klines(symbol)
            frame = normalize(raw)
            if frame.height != 1440:
                raise RuntimeError(f"SEP30_BARS={frame.height}, expected 1440")
            for tf in TF_MS:
                target = cache / f"{symbol}-{tf}.csv"
                if not target.exists():
                    raise FileNotFoundError(str(target))
                if last_csv_t(target) < START_MS:
                    append_frame(target, derive(frame, tf))
            report["ok"] += 1
            report["results"].append({"symbol": symbol, "status": "PATCHED", "bars1m": frame.height})
        except Exception as e:
            report["failed"] += 1
            report["results"].append({"symbol": symbol, "status": "ERROR", "error": str(e)})
        if i == 1 or i % 10 == 0 or i == len(symbols):
            report_path.write_text(json.dumps(report, ensure_ascii=True, indent=2), encoding="utf-8")
            print(json.dumps({"progress": f"{i}/{len(symbols)}", "ok": report["ok"], "failed": report["failed"], "skipped": report["skipped"]}), flush=True)
        time.sleep(0.4)
    report_path.write_text(json.dumps(report, ensure_ascii=True, indent=2), encoding="utf-8")
    return 1 if report["failed"] else 0

if __name__ == "__main__":
    raise SystemExit(main())
