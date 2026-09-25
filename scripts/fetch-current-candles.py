#!/usr/bin/env python3
import json, sys, time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError

BASES=["https://fapi.binance.com","https://fapi1.binance.com","https://fapi2.binance.com","https://fapi3.binance.com","https://fapi4.binance.com"]
LIMIT=350

def get_json(path, params=None, retries=2):
    last=None
    for base in BASES:
        url=base+path
        if params:
            url += "?" + urlencode(params)
        for attempt in range(retries):
            try:
                req=Request(url, headers={"User-Agent":"Mozilla/5.0 TradingView-Research-Lab/1.0","Accept":"application/json"})
                with urlopen(req, timeout=25) as r:
                    return json.loads(r.read().decode("utf-8"))
            except HTTPError as e:
                try:
                    body=e.read().decode("utf-8","replace")[:300]
                except Exception:
                    body=""
                last=RuntimeError(f"{base} HTTP {e.code}: {body}")
                if e.code==451:
                    break
                if attempt+1<retries:
                    retry_after=e.headers.get("Retry-After")
                    wait=float(retry_after) if retry_after and retry_after.replace(".","",1).isdigit() else 1.5*(attempt+1)
                    time.sleep(min(wait,8.0))
            except Exception as e:
                last=e
                if attempt+1<retries:
                    time.sleep(1.5*(attempt+1))
    raise RuntimeError(f"GET {path} failed across {len(BASES)} futures hosts: {last}")

def select_base():
    global BASES
    original=list(BASES)
    diagnostics=[]
    for base in original:
        url=base+"/fapi/v1/ping"
        try:
            req=Request(url, headers={"User-Agent":"Mozilla/5.0 TradingView-Research-Lab/1.0","Accept":"application/json"})
            with urlopen(req, timeout=8) as r:
                json.loads(r.read().decode("utf-8"))
            BASES=[base]
            return base, diagnostics
        except HTTPError as e:
            try:
                body=e.read().decode("utf-8","replace")[:240]
            except Exception:
                body=""
            diagnostics.append({"base":base,"error":f"HTTP {e.code}: {body}"})
        except Exception as e:
            diagnostics.append({"base":base,"error":str(e)})
    BASES=original
    return None, diagnostics

def main():
    if len(sys.argv)<4:
        raise SystemExit("Usage: fetch-current-candles.py CROSS_BOARD.json EXECUTION_WATCHLIST.json OUT_DIR")
    board=json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    execution=json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
    out=Path(sys.argv[3]); out.mkdir(parents=True,exist_ok=True)
    active_base,base_diagnostics=select_base()
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
    if active_base is None:
        reqs=[]
    workers=max(1,min(4,len(reqs)))
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
        "activeBase":active_base,"baseDiagnostics":base_diagnostics,
        "dataAvailable":len(manifest)>0,
        "series":manifest,"failures":failures
    },indent=2)+"\n",encoding="utf-8")
    print(json.dumps({
        "requested":len(requests),"ok":len(manifest),"failed":len(failures),
        "dataAvailable":len(manifest)>0,
        "activeBase":active_base,
        "failureSample":failures[:3]
    },ensure_ascii=False))
    if not manifest:
        print("No fresh candle series; downstream will preserve shadow state.",file=sys.stderr)

if __name__=="__main__":
    main()
