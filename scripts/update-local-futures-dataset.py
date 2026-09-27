from __future__ import annotations

import argparse
import io
import json
import os
import time
import urllib.error
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from pathlib import Path

import polars as pl

VISION = "https://data.binance.vision/data/futures/um"
TF_MS = {"1m": 60_000, "5m": 300_000, "15m": 900_000, "4h": 14_400_000}
CSV_COLS = [
    "open_time", "open", "high", "low", "close", "volume",
    "close_time", "quote_volume", "count", "taker_buy_volume",
    "taker_buy_quote_volume", "ignore",
]

def parse_day(s: str) -> datetime:
    return datetime.strptime(s, "%Y-%m-%d").replace(tzinfo=timezone.utc)

def utc_today() -> datetime:
    now = datetime.now(timezone.utc)
    return datetime(now.year, now.month, now.day, tzinfo=timezone.utc)

def month_iter(start: datetime, end: datetime):
    cur = datetime(start.year, start.month, 1, tzinfo=timezone.utc)
    stop = datetime(end.year, end.month, 1, tzinfo=timezone.utc)
    while cur <= stop:
        yield cur
        if cur.month == 12:
            cur = datetime(cur.year + 1, 1, 1, tzinfo=timezone.utc)
        else:
            cur = datetime(cur.year, cur.month + 1, 1, tzinfo=timezone.utc)

def day_iter(start: datetime, end_exclusive: datetime):
    cur = datetime(start.year, start.month, start.day, tzinfo=timezone.utc)
    while cur < end_exclusive:
        yield cur
        cur += timedelta(days=1)

def archive_url(symbol: str, dt: datetime, monthly: bool) -> str:
    if monthly:
        key = dt.strftime("%Y-%m")
        return f"{VISION}/monthly/klines/{symbol}/1m/{symbol}-1m-{key}.zip"
    key = dt.strftime("%Y-%m-%d")
    return f"{VISION}/daily/klines/{symbol}/1m/{symbol}-1m-{key}.zip"

def fetch_zip(url: str, retries: int = 3):
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=45) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if attempt + 1 >= retries:
                raise
        except Exception:
            if attempt + 1 >= retries:
                raise
        time.sleep(1.5 * (attempt + 1))
    return None

def parse_archive(blob: bytes | None) -> pl.DataFrame | None:
    if not blob:
        return None
    with zipfile.ZipFile(io.BytesIO(blob)) as zf:
        names = [n for n in zf.namelist() if not n.endswith("/")]
        if not names:
            return None
        raw = zf.read(names[0])
    first = raw.splitlines()[0].decode("utf-8", "ignore").lower() if raw else ""
    has_header = "open_time" in first or first.startswith("open")
    df = pl.read_csv(
        io.BytesIO(raw),
        has_header=has_header,
        new_columns=None if has_header else CSV_COLS,
        infer_schema_length=100,
        ignore_errors=True,
    )
    lower = {c.lower(): c for c in df.columns}
    def src(*names):
        for n in names:
            if n in lower:
                return lower[n]
        raise ValueError(f"Missing CSV column {names}; got {df.columns}")
    return df.select(
        pl.col(src("open_time")).cast(pl.Int64, strict=False).alias("t"),
        pl.col(src("open")).cast(pl.Float64, strict=False).alias("o"),
        pl.col(src("high")).cast(pl.Float64, strict=False).alias("h"),
        pl.col(src("low")).cast(pl.Float64, strict=False).alias("l"),
        pl.col(src("close")).cast(pl.Float64, strict=False).alias("c"),
        pl.col(src("volume")).cast(pl.Float64, strict=False).alias("v"),
    ).drop_nulls()

def normalize_existing(path: Path) -> pl.DataFrame:
    df = pl.read_ipc(path)
    lower = {c.lower(): c for c in df.columns}
    tc = next((lower[x] for x in ("date", "timestamp", "time", "t") if x in lower), None)
    if not tc:
        raise ValueError(f"No time column in {path.name}")
    dtype = df.schema[tc]
    if isinstance(dtype, pl.Datetime):
        texpr = pl.col(tc).dt.epoch("ms")
    elif dtype == pl.Date:
        texpr = pl.col(tc).cast(pl.Datetime("ms")).dt.epoch("ms")
    elif dtype.is_integer():
        texpr = pl.col(tc).cast(pl.Int64)
    else:
        texpr = pl.col(tc).str.to_datetime(strict=False, time_zone="UTC").dt.epoch("ms")
    out = df.select(
        texpr.alias("t"),
        pl.col(lower["open"]).cast(pl.Float64).alias("o"),
        pl.col(lower["high"]).cast(pl.Float64).alias("h"),
        pl.col(lower["low"]).cast(pl.Float64).alias("l"),
        pl.col(lower["close"]).cast(pl.Float64).alias("c"),
        pl.col(lower["volume"]).cast(pl.Float64).alias("v"),
    )
    if out.height:
        sample = int(out["t"][0])
        if sample < 10_000_000_000:
            out = out.with_columns((pl.col("t") * 1000).alias("t"))
        elif sample > 10_000_000_000_000_000:
            out = out.with_columns((pl.col("t") // 1_000_000).alias("t"))
        elif sample > 10_000_000_000_000:
            out = out.with_columns((pl.col("t") // 1000).alias("t"))
    return out.drop_nulls().sort("t")

def to_feather_frame(df: pl.DataFrame) -> pl.DataFrame:
    return df.select(
        pl.from_epoch(pl.col("t"), time_unit="ms").dt.replace_time_zone("UTC").alias("date"),
        pl.col("o").alias("open"),
        pl.col("h").alias("high"),
        pl.col("l").alias("low"),
        pl.col("c").alias("close"),
        pl.col("v").alias("volume"),
    )

def resample(df: pl.DataFrame, tf: str) -> pl.DataFrame:
    bucket = TF_MS[tf]
    return (
        df.with_columns(((pl.col("t") // bucket) * bucket).alias("_b"))
        .group_by("_b", maintain_order=True)
        .agg(
            pl.col("o").first().alias("o"),
            pl.col("h").max().alias("h"),
            pl.col("l").min().alias("l"),
            pl.col("c").last().alias("c"),
            pl.col("v").sum().alias("v"),
        )
        .rename({"_b": "t"})
        .sort("t")
    )

def atomic_ipc(df: pl.DataFrame, path: Path):
    tmp = path.with_suffix(path.suffix + ".tmp")
    df.write_ipc(tmp)
    os.replace(tmp, path)

def base_from_path(path: Path) -> tuple[str, str]:
    suffix = "_USDT_USDT-1m-futures.feather"
    name = path.name
    if not name.endswith(suffix):
        raise ValueError(name)
    base = name[:-len(suffix)]
    symbol = base.replace("_", "") + "USDT"
    return base, symbol

def file_for(root: Path, base: str, tf: str) -> Path:
    return root / f"{base}_USDT_USDT-{tf}-futures.feather"

def download_many(urls: list[str], workers: int) -> list[pl.DataFrame]:
    frames: list[pl.DataFrame] = []
    if not urls:
        return frames
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {ex.submit(fetch_zip, u): u for u in urls}
        for fut in as_completed(futs):
            blob = fut.result()
            if blob:
                frame = parse_archive(blob)
                if frame is not None and frame.height:
                    frames.append(frame)
    return frames

def update_symbol(path1m: Path, target_start: datetime, target_end: datetime, workers: int):
    root = path1m.parent
    base, symbol = base_from_path(path1m)
    current = normalize_existing(path1m)
    if not current.height:
        return {"symbol": symbol, "status": "EMPTY_EXISTING"}

    min_ms = int(current["t"].min())
    max_ms = int(current["t"].max())
    min_dt = datetime.fromtimestamp(min_ms / 1000, timezone.utc)
    max_dt = datetime.fromtimestamp(max_ms / 1000, timezone.utc)
    target_start_ms = int(target_start.timestamp() * 1000)
    target_end_ms = int(target_end.timestamp() * 1000)

    urls: list[str] = []
    if min_ms > target_start_ms:
        month_end = datetime(min_dt.year, min_dt.month, 1, tzinfo=timezone.utc)
        for m in month_iter(target_start, month_end):
            urls.append(archive_url(symbol, m, True))

    if max_ms < target_end_ms - 60_000:
        start_day = datetime(max_dt.year, max_dt.month, max_dt.day, tzinfo=timezone.utc)
        for d in day_iter(start_day, target_end):
            urls.append(archive_url(symbol, d, False))

    frames = download_many(urls, workers)
    if frames:
        merged = pl.concat([current, *frames], how="vertical_relaxed")
        merged = (
            merged.filter((pl.col("t") >= target_start_ms) & (pl.col("t") < target_end_ms))
            .unique(subset=["t"], keep="last")
            .sort("t")
        )
    else:
        merged = current.filter((pl.col("t") >= target_start_ms) & (pl.col("t") < target_end_ms))

    changed = (
        merged.height != current.height
        or int(merged["t"].min()) != min_ms
        or int(merged["t"].max()) != max_ms
    )

    if changed:
        atomic_ipc(to_feather_frame(merged), path1m)

    return {
        "symbol": symbol,
        "status": "UPDATED" if changed else "CURRENT",
        "urls": len(urls),
        "downloaded_archives": len(frames),
        "rows": merged.height,
        "min": datetime.fromtimestamp(int(merged["t"].min()) / 1000, timezone.utc).isoformat(),
        "max": datetime.fromtimestamp(int(merged["t"].max()) / 1000, timezone.utc).isoformat(),
    }

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", required=True)
    ap.add_argument("--start", default="2024-09-19")
    ap.add_argument("--end", default=None, help="exclusive UTC day; default today UTC")
    ap.add_argument("--symbols", nargs="*", default=None)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--workers", type=int, default=4, help="archive downloads per symbol")
    ap.add_argument("--symbol-workers", type=int, default=8, help="symbols updated concurrently")
    ap.add_argument("--report", default="dataset-update-report.json")
    args = ap.parse_args()

    root = Path(args.root)
    target_start = parse_day(args.start)
    target_end = parse_day(args.end) if args.end else utc_today()

    files = sorted(root.glob("*_USDT_USDT-1m-futures.feather"))
    if args.symbols:
        wanted = {s.upper().replace("/", "").replace(":", "") for s in args.symbols}
        files = [p for p in files if base_from_path(p)[1] in wanted]
    if args.limit:
        files = files[: args.limit]

    report = {
        "root": str(root),
        "target_start": target_start.isoformat(),
        "target_end_exclusive": target_end.isoformat(),
        "symbols": len(files),
        "started_at": datetime.now(timezone.utc).isoformat(),
        "results": [],
    }

    errors = 0
    completed = 0
    with ThreadPoolExecutor(max_workers=max(1, args.symbol_workers)) as pool:
        futures = {
            pool.submit(update_symbol, p, target_start, target_end, args.workers): p
            for p in files
        }
        for fut in as_completed(futures):
            p = futures[fut]
            try:
                item = fut.result()
            except Exception as exc:
                errors += 1
                item = {"symbol": p.name, "status": "ERROR", "error": str(exc)}
            report["results"].append(item)
            completed += 1
            if completed == 1 or completed % 10 == 0 or completed == len(files):
                print(json.dumps({"progress": f"{completed}/{len(files)}", "errors": errors, "last": item}), flush=True)
                Path(args.report).write_text(json.dumps(report, indent=2), encoding="utf-8")

    report["results"].sort(key=lambda x: x.get("symbol", ""))
    report["finished_at"] = datetime.now(timezone.utc).isoformat()
    report["errors"] = errors
    report["updated"] = sum(1 for r in report["results"] if r.get("status") == "UPDATED")
    report["current"] = sum(1 for r in report["results"] if r.get("status") == "CURRENT")
    Path(args.report).write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({k: report[k] for k in ("symbols","errors","updated","current","finished_at")}, indent=2))
    return 1 if errors else 0

if __name__ == "__main__":
    raise SystemExit(main())
