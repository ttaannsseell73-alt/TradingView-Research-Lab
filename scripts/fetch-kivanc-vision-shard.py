#!/usr/bin/env python3
import argparse, csv, io, json, os, time, urllib.error, urllib.request, urllib.parse, zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

START_MS = 1782259200000  # 2026-06-24T00:00:00Z
END_MS = 1790208000000    # 2026-09-24T00:00:00Z
MONTHS = ["2026-06", "2026-07", "2026-08"]
DAYS = [f"2026-09-{d:02d}" for d in range(1, 24)]
BASE = "https://data.binance.vision/data/futures/um"
UA = "TradingView-Research-Lab/1.0"

def urls(symbol):
    out = [(f"{BASE}/monthly/klines/{symbol}/1h/{symbol}-1h-{m}.zip", m) for m in MONTHS]
    out += [(f"{BASE}/daily/klines/{symbol}/1h/{symbol}-1h-{d}.zip", d) for d in DAYS]
    return out

def download(url, tries=4):
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if attempt == tries - 1:
                raise
        except Exception:
            if attempt == tries - 1:
                raise
        time.sleep(0.5 * (attempt + 1))
    return None

def parse_zip(blob):
    if not blob:
        return []
    rows = []
    with zipfile.ZipFile(io.BytesIO(blob)) as zf:
        for name in zf.namelist():
            if name.endswith("/"):
                continue
            with zf.open(name) as fh:
                text = io.TextIOWrapper(fh, encoding="utf-8", errors="replace", newline="")
                for r in csv.reader(text):
                    if len(r) < 6:
                        continue
                    try:
                        ts = int(r[0])
                        o,h,l,c,v = map(float, r[1:6])
                    except Exception:
                        continue
                    if START_MS <= ts < END_MS:
                        rows.append((ts,o,h,l,c,v))
    return rows

def fetch_symbol(meta, out_dir):
    symbol = meta["symbol"]
    parts = []
    errors = []
    with ThreadPoolExecutor(max_workers=8) as ex:
        futs = {ex.submit(download, u): (u,label) for u,label in urls(symbol)}
        for f in as_completed(futs):
            u,label = futs[f]
            try:
                blob = f.result()
                if blob:
                    parts.extend(parse_zip(blob))
            except Exception as e:
                errors.append(f"{label}:{type(e).__name__}:{e}")
    dedup = {r[0]: r for r in parts}
    rows = [dedup[k] for k in sorted(dedup)]
    p = Path(out_dir) / f"{symbol}.csv"
    if rows:
        with p.open("w", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh)
            w.writerow(["timestamp","open","high","low","close","volume"])
            w.writerows(rows)
    return {"symbol": symbol, "candles": len(rows), "errors": errors[:5], "file": str(p) if rows else None}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--shard", type=int, required=True)
    ap.add_argument("--shards", type=int, required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    Path(args.out).mkdir(parents=True, exist_ok=True)
    snap = json.loads(Path("research/kivanc_symbols_2026-09-24.json").read_text(encoding="utf-8"))
    selected = [s for i,s in enumerate(snap["symbols"]) if i % args.shards == args.shard]
    manifest = []
    # modest symbol-level parallelism; each symbol internally caps to 8 archive requests
    with ThreadPoolExecutor(max_workers=3) as ex:
        futs = {ex.submit(fetch_symbol, s, args.out): s["symbol"] for s in selected}
        for n,f in enumerate(as_completed(futs), 1):
            try:
                item = f.result()
            except Exception as e:
                item = {"symbol": futs[f], "candles": 0, "errors": [repr(e)], "file": None}
            manifest.append(item)
            print(json.dumps({"shard": args.shard, "done": n, "total": len(selected), **item}, ensure_ascii=False), flush=True)
    manifest.sort(key=lambda x: x["symbol"])
    Path(args.out, "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False)+"\n", encoding="utf-8")

if __name__ == "__main__":
    main()
