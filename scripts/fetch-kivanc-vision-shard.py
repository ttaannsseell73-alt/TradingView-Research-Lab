#!/usr/bin/env python3
import argparse, csv, io, json, time, urllib.error, urllib.request, urllib.parse, zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from pathlib import Path

START_MS = 1782259200000
END_MS = 1790208000000
BASE = "https://data.binance.vision/data/futures/um"
UA = "TradingView-Research-Lab/2.0"
TF_MS = {"1m":60000,"5m":300000,"1h":3600000,"4h":14400000,"1d":86400000}

def month_labels(fetch_start_ms):
    start=datetime.fromtimestamp(fetch_start_ms/1000,tz=timezone.utc)
    end=datetime.fromtimestamp(END_MS/1000,tz=timezone.utc)
    cur=datetime(start.year,start.month,1,tzinfo=timezone.utc)
    end_month=datetime(end.year,end.month,1,tzinfo=timezone.utc)
    out=[]
    while cur<end_month:
        out.append(cur.strftime("%Y-%m"))
        cur=datetime(cur.year+1,1,1,tzinfo=timezone.utc) if cur.month==12 else datetime(cur.year,cur.month+1,1,tzinfo=timezone.utc)
    return out

def day_labels(fetch_start_ms):
    start=datetime.fromtimestamp(fetch_start_ms/1000,tz=timezone.utc)
    end=datetime.fromtimestamp(END_MS/1000,tz=timezone.utc)
    cur=max(datetime(end.year,end.month,1,tzinfo=timezone.utc),datetime(start.year,start.month,start.day,tzinfo=timezone.utc))
    out=[]
    while cur<end:
        out.append(cur.strftime("%Y-%m-%d"))
        cur+=timedelta(days=1)
    return out

def urls(symbol,timeframe,fetch_start_ms):
    enc=urllib.parse.quote(symbol,safe="")
    out=[(f"{BASE}/monthly/klines/{enc}/{timeframe}/{enc}-{timeframe}-{m}.zip",m) for m in month_labels(fetch_start_ms)]
    out += [(f"{BASE}/daily/klines/{enc}/{timeframe}/{enc}-{timeframe}-{d}.zip",d) for d in day_labels(fetch_start_ms)]
    return out

def download(url,tries=4):
    for attempt in range(tries):
        try:
            req=urllib.request.Request(url,headers={"User-Agent":UA})
            with urllib.request.urlopen(req,timeout=30) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code==404:
                return None
            if attempt==tries-1:
                raise
        except Exception:
            if attempt==tries-1:
                raise
        time.sleep(0.5*(attempt+1))
    return None

def parse_zip(blob,fetch_start_ms):
    if not blob:
        return []
    rows=[]
    with zipfile.ZipFile(io.BytesIO(blob)) as zf:
        for name in zf.namelist():
            if name.endswith("/"):
                continue
            with zf.open(name) as fh:
                text=io.TextIOWrapper(fh,encoding="utf-8",errors="replace",newline="")
                for r in csv.reader(text):
                    if len(r)<6:
                        continue
                    try:
                        ts=int(r[0]); o,h,l,c,v=map(float,r[1:6])
                    except Exception:
                        continue
                    if fetch_start_ms<=ts<END_MS:
                        rows.append((ts,o,h,l,c,v))
    return rows

def fetch_symbol(meta,out_dir,timeframe,fetch_start_ms):
    symbol=meta["symbol"]
    parts=[]; errors=[]
    with ThreadPoolExecutor(max_workers=8) as ex:
        futs={ex.submit(download,u):(u,label) for u,label in urls(symbol,timeframe,fetch_start_ms)}
        for f in as_completed(futs):
            _,label=futs[f]
            try:
                blob=f.result()
                if blob:
                    parts.extend(parse_zip(blob,fetch_start_ms))
            except Exception as e:
                errors.append(f"{label}:{type(e).__name__}:{e}")
    dedup={r[0]:r for r in parts}
    rows=[dedup[k] for k in sorted(dedup)]
    p=Path(out_dir)/f"{symbol}.csv"
    if rows:
        with p.open("w",newline="",encoding="utf-8") as fh:
            w=csv.writer(fh); w.writerow(["timestamp","open","high","low","close","volume"]); w.writerows(rows)
    test_candles=sum(1 for r in rows if START_MS<=r[0]<END_MS)
    return {"symbol":symbol,"timeframe":timeframe,"rawCandles":len(rows),"testCandles":test_candles,"errors":errors[:5],"file":str(p) if rows else None}

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--shard",type=int,required=True)
    ap.add_argument("--shards",type=int,required=True)
    ap.add_argument("--out",required=True)
    ap.add_argument("--timeframe",choices=TF_MS.keys(),default="1h")
    ap.add_argument("--warmup-bars",type=int,default=200)
    args=ap.parse_args()
    fetch_start_ms=START_MS-args.warmup_bars*TF_MS[args.timeframe]
    Path(args.out).mkdir(parents=True,exist_ok=True)
    snap=json.loads(Path("research/kivanc_symbols_2026-09-24.json").read_text(encoding="utf-8"))
    selected=[s for i,s in enumerate(snap["symbols"]) if i%args.shards==args.shard]
    manifest=[]
    with ThreadPoolExecutor(max_workers=3) as ex:
        futs={ex.submit(fetch_symbol,s,args.out,args.timeframe,fetch_start_ms):s["symbol"] for s in selected}
        for n,f in enumerate(as_completed(futs),1):
            try:
                item=f.result()
            except Exception as e:
                item={"symbol":futs[f],"timeframe":args.timeframe,"rawCandles":0,"testCandles":0,"errors":[repr(e)],"file":None}
            manifest.append(item)
            print(json.dumps({"shard":args.shard,"done":n,"total":len(selected),"fetchStartMs":fetch_start_ms,**item},ensure_ascii=False),flush=True)
    manifest.sort(key=lambda x:x["symbol"])
    Path(args.out,"manifest.json").write_text(json.dumps({
        "timeframe":args.timeframe,"warmupBars":args.warmup_bars,"fetchStartMs":fetch_start_ms,
        "testStartMs":START_MS,"testEndMs":END_MS,"symbols":manifest
    },indent=2,ensure_ascii=False)+"\n",encoding="utf-8")

if __name__=="__main__":
    main()
