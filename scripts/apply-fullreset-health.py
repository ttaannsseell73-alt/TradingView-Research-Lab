from __future__ import annotations
import csv
import json
import time
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

BASES = ["https://fapi.binance.com", "https://fapi1.binance.com", "https://fapi2.binance.com"]
TH = {
    "minQuoteVolume24h": 3_000_000.0,
    "maxSpreadBps": 8.0,
    "minSideDepth10bps": 1_000.0,
    "minOpenInterestNotional": 2_000_000.0,
}

def get_json(path: str, params=None):
    last = None
    for base in BASES:
        url = base + path + (("?" + urlencode(params)) if params else "")
        for attempt in range(3):
            try:
                req = Request(url, headers={"User-Agent": "NightResearch/20261001", "Accept": "application/json"})
                with urlopen(req, timeout=20) as r:
                    return json.loads(r.read().decode("utf-8"))
            except Exception as e:
                last = e
                if attempt < 2:
                    time.sleep(1.0 * (attempt + 1))
    raise RuntimeError(f"{path}: {last}")
def depth10bps(symbol: str, mid: float):
    book = get_json("/fapi/v1/depth", {"symbol": symbol, "limit": 100})
    low = mid * 0.999
    high = mid * 1.001
    bid = sum(float(p) * float(q) for p, q in book.get("bids", []) if float(p) >= low)
    ask = sum(float(p) * float(q) for p, q in book.get("asks", []) if float(p) <= high)
    return bid, ask

def read_csv(path: Path):
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))

def write_csv(path: Path, rows: list[dict]):
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    fields = list(rows[0].keys())
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)

def main():
    root = Path(__file__).resolve().parents[1] / "research" / "full-reset-20261001"
    candidates = read_csv(root / "RECENT_6M_PASS.csv")
    baseline = json.loads((root / "current_market_baseline.json").read_text(encoding="utf-8"))
    market = {x["symbol"]: x for x in baseline["rows"]}
    symbols = sorted({x["symbol"] for x in candidates})
    health = {}
    for i, symbol in enumerate(symbols, 1):
        base = market.get(symbol, {})
        qv = float(base.get("quoteVolume24h") or 0)
        spread = base.get("spreadBps")
        bid = float(base.get("bid") or 0)
        ask = float(base.get("ask") or 0)
        mid = (bid + ask) / 2 if bid and ask else 0
        reasons = []
        if qv < TH["minQuoteVolume24h"]:
            reasons.append("LOW_24H_QUOTE_VOLUME")
        if spread is None or float(spread) > TH["maxSpreadBps"]:
            reasons.append("WIDE_SPREAD")
        oi_notional = None
        bid_depth = None
        ask_depth = None
        if not reasons and mid > 0:
            try:
                oi = get_json("/fapi/v1/openInterest", {"symbol": symbol})
                oi_notional = float(oi.get("openInterest") or 0) * mid
                bid_depth, ask_depth = depth10bps(symbol, mid)
                if oi_notional < TH["minOpenInterestNotional"]:
                    reasons.append("LOW_OPEN_INTEREST")
                if min(bid_depth, ask_depth) < TH["minSideDepth10bps"]:
                    reasons.append("THIN_10BPS_BOOK")
            except Exception as e:
                reasons.append("MARKET_SNAPSHOT_ERROR")
                base["snapshotError"] = str(e)
        health[symbol] = {
            "symbol": symbol,
            "quoteVolume24h": qv,
            "spreadBps": spread,
            "openInterestNotional": oi_notional,
            "bidDepth10bps": bid_depth,
            "askDepth10bps": ask_depth,
            "pass": len(reasons) == 0,
            "reasons": reasons,
        }
        if i % 20 == 0 or i == len(symbols):
            print(json.dumps({"health": f"{i}/{len(symbols)}"}), flush=True)
        time.sleep(0.08)

    passed = []
    rejected = []
    for row in candidates:
        h = health.get(row["symbol"], {"pass": False, "reasons": ["NO_HEALTH_RECORD"]})
        out = dict(row)
        out.update({
            "quoteVolume24h": h.get("quoteVolume24h"),
            "spreadBps": h.get("spreadBps"),
            "openInterestNotional": h.get("openInterestNotional"),
            "bidDepth10bps": h.get("bidDepth10bps"),
            "askDepth10bps": h.get("askDepth10bps"),
            "currentHealthPass": h.get("pass"),
            "healthRejectReason": ";".join(h.get("reasons") or []),
        })
        (passed if h.get("pass") else rejected).append(out)

    write_csv(root / "PROMOTABLE_CURRENT.csv", passed)
    write_csv(root / "REJECTED_COIN_HEALTH.csv", rejected)
    (root / "coin_health.json").write_text(
        json.dumps({"thresholds": TH, "symbols": health}, ensure_ascii=True, indent=2),
        encoding="utf-8",
    )
    print(json.dumps({
        "candidateRows": len(candidates),
        "uniqueSymbols": len(symbols),
        "promotableRows": len(passed),
        "rejectedRows": len(rejected),
    }))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
