#!/usr/bin/env python3
import json, math, sys, time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError

BASE="https://fapi.binance.com"

def get_json(path, params=None, retries=4):
    url=BASE+path
    if params:
        url += "?" + urlencode(params)
    last=None
    for attempt in range(retries):
        try:
            req=Request(url, headers={"User-Agent":"TradingView-Research-Lab/1.0"})
            with urlopen(req, timeout=20) as r:
                return json.loads(r.read().decode("utf-8"))
        except HTTPError as e:
            try:
                body=e.read().decode("utf-8","replace")[:300]
            except Exception:
                body=""
            last=RuntimeError(f"HTTP {e.code}: {body}")
            if attempt+1<retries:
                retry_after=e.headers.get("Retry-After")
                wait=float(retry_after) if retry_after and retry_after.replace(".","",1).isdigit() else 2.0*(attempt+1)
                time.sleep(min(wait,15.0))
        except Exception as e:
            last=e
            if attempt+1<retries:
                time.sleep(2.0*(attempt+1))
    raise RuntimeError(f"GET {url} failed: {last}")

def depth_notional(levels, mid, side, max_bps):
    total=0.0
    for ps,qs in levels:
        p=float(ps); q=float(qs)
        d=((mid-p)/mid*10000.0) if side=="bid" else ((p-mid)/mid*10000.0)
        if d <= max_bps:
            total += p*q
    return total

def main():
    if len(sys.argv)<3:
        raise SystemExit("Usage: fetch-live-market-snapshot.py CROSS_BOARD.json OUT.json")
    board=json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    out=Path(sys.argv[2]); out.parent.mkdir(parents=True, exist_ok=True)
    source=board.get("deploymentCandidates") or board.get("managementWatchlist") or []
    symbols=sorted({s for x in source for s in x.get("contracts",[])})
    def fetch_symbol(symbol):
        ticker=get_json("/fapi/v1/ticker/24hr", {"symbol":symbol})
        book=get_json("/fapi/v1/depth", {"symbol":symbol,"limit":50})
        oi=get_json("/fapi/v1/openInterest", {"symbol":symbol})
        bids=book.get("bids",[]); asks=book.get("asks",[])
        if not bids or not asks:
            raise RuntimeError("empty order book")
        bid=float(bids[0][0]); ask=float(asks[0][0]); mid=(bid+ask)/2.0
        oi_base=float(oi.get("openInterest",0.0))
        return {
            "symbol":symbol,
            "quoteVolume24h":float(ticker.get("quoteVolume",0.0)),
            "trades24h":int(ticker.get("count",0)),
            "last":float(ticker.get("lastPrice",mid)),
            "bid":bid,
            "ask":ask,
            "spreadBps":((ask-bid)/mid*10000.0) if mid else math.inf,
            "bidDepth10bps":depth_notional(bids,mid,"bid",10),
            "askDepth10bps":depth_notional(asks,mid,"ask",10),
            "bidDepth25bps":depth_notional(bids,mid,"bid",25),
            "askDepth25bps":depth_notional(asks,mid,"ask",25),
            "openInterestBase":oi_base,
            "openInterestNotional":oi_base*mid
        }

    rows=[]
    failures=[]
    workers=max(1,min(3,len(symbols)))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        future_map={pool.submit(fetch_symbol,symbol):symbol for symbol in symbols}
        for future in as_completed(future_map):
            symbol=future_map[future]
            try:
                rows.append(future.result())
            except Exception as e:
                failures.append({"symbol":symbol,"error":str(e)})
    rows.sort(key=lambda x:x["symbol"])
    failures.sort(key=lambda x:x["symbol"])
    payload={
        "schemaVersion":1,
        "snapshotAt":time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source":"Binance USDⓈ-M Futures public REST",
        "requestedContracts":len(symbols),
        "dataAvailable":len(rows)>0,
        "allFailed":len(symbols)>0 and len(rows)==0,
        "contracts":rows,
        "failures":failures
    }
    out.write_text(json.dumps(payload,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
    print(json.dumps({
        "requested":len(symbols),"ok":len(rows),"failed":len(failures),
        "allFailed":len(symbols)>0 and len(rows)==0,
        "failureSample":failures[:3]
    },ensure_ascii=False))
    if not rows:
        print("Market snapshot unavailable; downstream will carry forward previous shadow state.",file=sys.stderr)

if __name__=="__main__":
    main()
