import argparse
import csv
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx

from datahub.ingest import Vision


def ms(value: str) -> int:
    return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1000)


def month_start(value: int) -> int:
    dt = datetime.fromtimestamp(value / 1000, UTC)
    return int(datetime(dt.year, dt.month, 1, tzinfo=UTC).timestamp() * 1000)


def next_month(value: int) -> int:
    dt = datetime.fromtimestamp(value / 1000, UTC)
    if dt.month == 12:
        nxt = datetime(dt.year + 1, 1, 1, tzinfo=UTC)
    else:
        nxt = datetime(dt.year, dt.month + 1, 1, tzinfo=UTC)
    return int(nxt.timestamp() * 1000)


def missing_archive(exc: Exception) -> bool:
    return isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code in (403, 404)


def append_table(rows, table):
    for row in table.to_pylist():
        rows.append([
            int(row["timestamp"].timestamp() * 1000),
            row["open"],
            row["high"],
            row["low"],
            row["close"],
            row["volume"],
        ])


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--symbol", required=True)
    p.add_argument("--timeframe", required=True)
    p.add_argument("--start", required=True)
    p.add_argument("--end", required=True)
    p.add_argument("--output", required=True)
    args = p.parse_args()

    start, end = ms(args.start), ms(args.end)
    if start >= end:
        raise SystemExit("start must be before end")

    vision = Vision()
    rows = []
    cursor = start
    skipped = 0

    while cursor < end:
        m0 = month_start(cursor)
        m1 = next_month(cursor)
        if cursor == m0 and m1 <= end:
            try:
                table, _ = vision.fetch_month("ohlcv", args.symbol, args.timeframe, cursor, m1)
                append_table(rows, table)
            except Exception as exc:
                if missing_archive(exc):
                    skipped += 1
                else:
                    raise
            cursor = m1
            continue

        stop = min(end, m1)
        day = cursor
        while day < stop:
            day_end = min(day + 86_400_000, stop)
            if day_end - day != 86_400_000 or day % 86_400_000:
                raise SystemExit("Sparse Vision adapter requires UTC day-aligned ranges")
            try:
                table, _ = vision.fetch("ohlcv", args.symbol, args.timeframe, day, day_end)
                append_table(rows, table)
            except Exception as exc:
                if missing_archive(exc):
                    skipped += 1
                else:
                    raise
            day = day_end
        cursor = stop

    rows.sort(key=lambda r: r[0])
    dedup = []
    seen = set()
    for row in rows:
        if row[0] in seen:
            continue
        seen.add(row[0])
        dedup.append(row)

    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["timestamp", "open", "high", "low", "close", "volume"])
        w.writerows(dedup)

    first = dedup[0][0] if dedup else None
    last = dedup[-1][0] if dedup else None
    print({
        "symbol": args.symbol,
        "timeframe": args.timeframe,
        "rows": len(dedup),
        "skipped_archives": skipped,
        "first": first,
        "last": last,
    })


if __name__ == "__main__":
    main()
