from __future__ import annotations

import argparse
import json
import sys
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


def candidate_path(root: Path, symbol: str, timeframe: str) -> Path:
    s = symbol.upper().replace("/", "").replace(":", "")
    if not s.endswith("USDT"):
        raise ValueError(f"Only USDT futures symbols are supported: {symbol}")
    base = s[:-4]
    return root / f"{base}_USDT_USDT-{timeframe}-futures.feather"


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

    required = {}
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


def resample_1h(df: pl.DataFrame) -> pl.DataFrame:
    bucket = TF_MS["1h"]
    return (
        df.with_columns(((pl.col("t") // bucket) * bucket).alias("_bucket"))
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


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", required=True)
    ap.add_argument("--symbol", required=True)
    ap.add_argument("--timeframe", required=True, choices=TF_MS)
    ap.add_argument("--start", required=True)
    ap.add_argument("--end", required=True)
    ap.add_argument("--output", required=True)
    args = ap.parse_args()

    root = Path(args.root)
    source = candidate_path(root, args.symbol, "1m")
    if not source.exists():
        raise FileNotFoundError(f"LOCAL_DATA_MISSING: canonical 1m source {source}")

    start_ms = iso_ms(args.start)
    end_ms = iso_ms(args.end)

    base = normalize_frame(pl.read_ipc(source))
    base = base.filter((pl.col("t") >= start_ms) & (pl.col("t") < end_ms))

    derived = args.timeframe != "1m"
    if args.timeframe == "1m":
        df = base
    else:
        bucket = TF_MS[args.timeframe]
        df = (
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

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    df.write_csv(output)

    print(json.dumps({
        "status": "READY_LOCAL",
        "symbol": args.symbol,
        "timeframe": args.timeframe,
        "rows": df.height,
        "source": str(source),
        "derived": derived,
        "output": str(output),
    }))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(2)
