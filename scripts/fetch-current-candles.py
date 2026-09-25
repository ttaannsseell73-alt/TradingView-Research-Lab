#!/usr/bin/env python3
import json, sys, time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

BASE="https://fapi.binance.com"
LIMIT=350

def get_json(path, params=None, retries=4):
    url=BASE+path
    if params:
        url += "?" + urlencode(params)
    last=None
    for attempt in range(retries):
        try:
            req=Request(url, headers={"User-Agent":"TradingView-Research-Lab/1.0"})
            with urlopen(req, timeout=25) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:
            last=e
            if attempt+1<retries:
                time.sleep(1.5*(attempt+1))
    raise RuntimeError(f"GET {url} failed: {last}")

def main():
    if len(sys.argv)<4:
        raise SystemExit("Usage: fetch-current-candles.py CROSS_BOARD.json EXECUTION_WATCHLIST.json OUT_DIR")
    board=json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    execution=json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
    out=Path(sys.argv[3]); out.mkdir(parents=True,exist_ok=True)
    by_under={x.get("underlying"):x for x in (board.get("deploymentCandidates") or board.get("managementWatchlist") or [])}
    requests=set()
    for x in execution.get("candidates",[]):
        if x.get("executionStatus") in ("BLOCK","NO_MARKET_SNAPSHOT"):
            continue
        symbol=x.get("executionContract")
        cand=by_under.get(x.get("underlying")) or {}
        for combo in cand.get("bestClean",[]):
            tf=combo.get("timeframe")
            if symbol and tf in ("5m","1h","4h","1d"):
                requests.add((symbol,tf))
    failures=[]
    manifest=[]
    now_ms=int(time.time()*1000)

    def fetch_series(symbol,tf):
        raw=get_json("/fapi/v1/klines",{"symbol":symbol,"interval":tf,"limit":LIMIT})
        closed=[]
        current_bar=None
        for k in raw:
            open_t=int(k[0]); close_t=int(k[6])
            if close_t >= now_ms:
                current_bar={
                    "t":open_t,
                    "o":float(k[1]),"h":float(k[2]),"l":float(k[3]),"c":float(k[4]),"v":float(k[5]),
                    "closeTime":close_t
                }
                continue
            closed.append({
                "t":open_t,
                "o":float(k[1]),"h":float(k[2]),"l":float(k[3]),"c":float(k[4]),"v":float(k[5]),
                "closeTime":close_t
            })
        return symbol,tf,closed,current_bar

    reqs=sorted(requests)
    workers=max(1,min(8,len(reqs)))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        future_map={pool.submit(fetch_series,symbol,tf):(symbol,tf) for symbol,tf in reqs}
        for future in as_completed(future_map):
            symbol,tf=future_map[future]
            try:
                symbol,tf,closed,current_bar=future.result()
                p=out/f"{symbol}__{tf}.json"
                p.write_text(json.dumps({
                    "symbol":symbol,"timeframe":tf,"snapshotAtMs":now_ms,
                    "candles":closed,"currentBar":current_bar
                },separators=(",",":"))+"\n",encoding="utf-8")
                manifest.append({
                    "symbol":symbol,"timeframe":tf,"bars":len(closed),
                    "hasCurrentBar":current_bar is not None,"path":p.name
                })
            except Exception as e:
                failures.append({"symbol":symbol,"timeframe":tf,"error":str(e)})
    manifest.sort(key=lambda x:(x["symbol"],x["timeframe"]))
    failures.sort(key=lambda x:(x["symbol"],x["timeframe"]))
    (out/"manifest.json").write_text(json.dumps({
        "schemaVersion":1,"snapshotAtMs":now_ms,"requested":len(requests),
        "series":manifest,"failures":failures
    },indent=2)+"\n",encoding="utf-8")
    print(json.dumps({"requested":len(requests),"ok":len(manifest),"failed":len(failures)}))
    if not manifest:
        raise SystemExit("No candle series fetched")

if __name__=="__main__":
    main()
