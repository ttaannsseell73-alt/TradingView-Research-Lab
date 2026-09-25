#!/usr/bin/env python3
import json, math, sys, time
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

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
        except Exception as e:
            last=e
            if attempt+1<retries:
                time.sleep(1.5*(attempt+1))
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
    rows=[]
    failures=[]
    for i,symbol in enumerate(symbols,1):
        try:
            ticker=get_json("/fapi/v1/ticker/24hr", {"symbol":symbol})
            book=get_json("/fapi/v1/depth", {"symbol":symbol,"limit":50})
            oi=get_json("/fapi/v1/openInterest", {"symbol":symbol})
            bids=book.get("bids",[]); asks=book.get("asks",[])
            if not bids or not asks:
                raise RuntimeError("empty order book")
            bid=float(bids[0][0]); ask=float(asks[0][0]); mid=(bid+ask)/2.0
            oi_base=float(oi.get("openInterest",0.0))
            rows.append({
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
            })
        except Exception as e:
            failures.append({"symbol":symbol,"error":str(e)})
        if i % 10 == 0:
            time.sleep(0.2)
    payload={
        "schemaVersion":1,
        "snapshotAt":time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source":"Binance USDⓈ-M Futures public REST",
        "requestedContracts":len(symbols),
        "contracts":rows,
        "failures":failures
    }
    out.write_text(json.dumps(payload,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
    print(json.dumps({"requested":len(symbols),"ok":len(rows),"failed":len(failures)}))
    if not rows:
        raise SystemExit("No market snapshot rows fetched")

if __name__=="__main__":
    main()
