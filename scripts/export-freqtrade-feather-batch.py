from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import polars as pl


TF_MS = {
    "1m": 60_000,
    "5m": 300_000,
    "15m": 900_000,
    "1h": 3_600_000,
    "4h": 14_400_000,
}


def iso_ms(value: str) -> int:
    text = value.replace("Z", "+00:00")
    dt = datetime.fromisoformat(text)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return int(dt.timestamp() * 1000)


def candidate_path(root: Path, symbol: str) -> Path:
    s = symbol.upper().replace("/", "").replace(":", "")
    if not s.endswith("USDT"):
        raise ValueError(f"Only USDT futures symbols are supported: {symbol}")
    base = s[:-4]
    return root / f"{base}_USDT_USDT-1m-futures.feather"


def to_ms_expr(column: str, dtype: pl.DataType) -> pl.Expr:
    col = pl.col(column)
    if isinstance(dtype, pl.Datetime):
        return col.dt.epoch(time_unit="ms").alias("t")
    if dtype == pl.Date:
        return col.cast(pl.Datetime("ms")).dt.epoch(time_unit="ms").alias("t")
    if dtype in (pl.Int64, pl.Int32, pl.UInt64, pl.UInt32):
        return col.cast(pl.Int64).alias("t")
    return col.str.to_datetime(strict=False, time_zone="UTC").dt.epoch(time_unit="ms").alias("t")


def normalize_frame(df: pl.DataFrame) -> pl.DataFrame:
    lower = {c.lower(): c for c in df.columns}
    time_col = next((lower[x] for x in ("date", "timestamp", "time", "t") if x in lower), None)
    if not time_col:
        raise ValueError(f"No time column found. Columns: {df.columns}")

    required: dict[str, str] = {}
    for want in ("open", "high", "low", "close", "volume"):
        src = lower.get(want)
        if not src:
            raise ValueError(f"Missing column {want}. Columns: {df.columns}")
        required[want] = src

    dtype = df.schema[time_col]
    out = df.select(
        to_ms_expr(time_col, dtype),
        pl.col(required["open"]).cast(pl.Float64).alias("o"),
        pl.col(required["high"]).cast(pl.Float64).alias("h"),
        pl.col(required["low"]).cast(pl.Float64).alias("l"),
        pl.col(required["close"]).cast(pl.Float64).alias("c"),
        pl.col(required["volume"]).cast(pl.Float64).alias("v"),
    )

    if out.height:
        sample = int(out["t"][0])
        if sample < 10_000_000_000:
            out = out.with_columns((pl.col("t") * 1000).alias("t"))
        elif sample > 10_000_000_000_000_000:
            out = out.with_columns((pl.col("t") // 1_000_000).alias("t"))
        elif sample > 10_000_000_000_000:
            out = out.with_columns((pl.col("t") // 1000).alias("t"))

    return out.sort("t")


def derive(base: pl.DataFrame, timeframe: str) -> pl.DataFrame:
    if timeframe == "1m":
        return base
    bucket = TF_MS[timeframe]
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


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write_json_atomic(path: Path, value: dict) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(value, sort_keys=True) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def cache_valid(csv_path: Path, meta_path: Path, expected: dict) -> bool:
    if not csv_path.exists() or csv_path.stat().st_size <= 32 or not meta_path.exists():
        return False
    try:
        actual = read_json(meta_path)
    except Exception:
        return False
    return actual == expected


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Prepare cached CSVs from canonical 1m Freqtrade Feather data with one source read per symbol."
    )
    ap.add_argument("--root", required=True)
    ap.add_argument("--plan", required=True)
    ap.add_argument("--output-dir", required=True)
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--strict", action="store_true")
    args = ap.parse_args()

    started = time.perf_counter()
    root = Path(args.root)
    plan_path = Path(args.plan)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    plan = read_json(plan_path)
    symbols = sorted(set(plan.get("symbols") or []))
    timeframes = sorted(set(plan.get("timeframes") or []), key=lambda tf: TF_MS.get(tf, 10**18))
    if not symbols:
        raise ValueError("Plan symbols must be non-empty")
    if not timeframes or any(tf not in TF_MS for tf in timeframes):
        raise ValueError(f"Unsupported timeframes: {timeframes}")

    start = str(plan["start"])
    end = str(plan["end"])
    start_ms = iso_ms(start)
    end_ms = iso_ms(end)
    if start_ms >= end_ms:
        raise ValueError("Plan start must be earlier than end")

    exported = 0
    cache_hits = 0
    source_reads = 0
    missing: list[str] = []
    errors: list[dict[str, str]] = []

    for index, symbol in enumerate(symbols, start=1):
        source = candidate_path(root, symbol)
        if not source.exists():
            missing.append(symbol)
            if args.strict:
                errors.append({"symbol": symbol, "error": f"LOCAL_DATA_MISSING: {source}"})
            continue

        stat = source.stat()
        pending: list[tuple[str, Path, Path, dict]] = []
        for timeframe in timeframes:
            csv_path = output_dir / f"{symbol}-{timeframe}.csv"
            meta_path = output_dir / f"{symbol}-{timeframe}.meta.json"
            expected = {
                "schemaVersion": 1,
                "symbol": symbol,
                "timeframe": timeframe,
                "start": start,
                "end": end,
                "source": str(source.resolve()),
                "sourceSize": stat.st_size,
                "sourceMtimeNs": stat.st_mtime_ns,
            }
            if not args.force and cache_valid(csv_path, meta_path, expected):
                cache_hits += 1
            else:
                pending.append((timeframe, csv_path, meta_path, expected))

        if not pending:
            if index % 25 == 0 or index == len(symbols):
                print(json.dumps({"progress": index, "symbols": len(symbols), "sourceReads": source_reads, "cacheHits": cache_hits, "exported": exported}))
            continue

        try:
            raw = pl.read_ipc(source)
            source_reads += 1
            base = normalize_frame(raw).filter((pl.col("t") >= start_ms) & (pl.col("t") < end_ms))
            for timeframe, csv_path, meta_path, expected in pending:
                frame = derive(base, timeframe)
                tmp_csv = csv_path.with_suffix(csv_path.suffix + ".tmp")
                frame.write_csv(tmp_csv)
                os.replace(tmp_csv, csv_path)
                write_json_atomic(meta_path, expected)
                exported += 1
        except Exception as exc:
            errors.append({"symbol": symbol, "error": str(exc)})
            if args.strict:
                print(str(exc), file=sys.stderr)

        if index % 25 == 0 or index == len(symbols):
            print(json.dumps({"progress": index, "symbols": len(symbols), "sourceReads": source_reads, "cacheHits": cache_hits, "exported": exported}))

    elapsed = time.perf_counter() - started
    summary = {
        "status": "READY" if not errors else "PARTIAL",
        "symbols": len(symbols),
        "timeframes": timeframes,
        "tasks": len(symbols) * len(timeframes),
        "sourceReads": source_reads,
        "exported": exported,
        "cacheHits": cache_hits,
        "missingSymbols": missing,
        "errors": errors,
        "elapsedSeconds": round(elapsed, 3),
        "outputDir": str(output_dir),
    }
    print(json.dumps(summary))

    if args.strict and errors:
        return 2
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(2)
