#!/usr/bin/env python3
"""Build recovery variants for one TradingView publication.

This belongs to RECOVERY_LAB, not the exact-source pipeline. Modifications are
allowed here, but every mutation is recorded. The original source is preserved
when obtainable.

Variant order:
  1. original source (no mutation)
  2. compatibility-patched source
  3. indicator->strategy signal wrapper using the publication's own alert /
     plotshape / named signal conditions

No recovery artifact is ever relabeled as SOURCE_EXACT.
"""
from __future__ import annotations

import argparse, hashlib, json, os, re, time, unicodedata
import urllib.error, urllib.parse, urllib.request
from pathlib import Path
from typing import Any

UA=("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/154 Safari/537.36")
FACADE="https://pine-facade.tradingview.com/pine-facade/get/{sid}/last?no_4xx=true"
SUGGEST="https://www.tradingview.com/pubscripts-suggest-json/?search={q}"
STRATEGY_RE=re.compile(r"(?m)^\s*strategy\s*\(")
INDICATOR_RE=re.compile(r"(?m)^\s*(indicator|study)\s*\(")
VERSION_RE=re.compile(r"(?m)^\s*//@version\s*=\s*(\d+)")
_last=0.0

def norm(s:str|None)->str:
    x=unicodedata.normalize("NFKD",s or "")
    x="".join(c for c in x if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+"," ",x.lower()).strip()

def get(url:str,tries:int=6,gap:float=.7,headers:dict[str,str]|None=None)->bytes:
    global _last
    last=None
    for i in range(tries):
        wait=gap-(time.monotonic()-_last)
        if wait>0: time.sleep(wait)
        _last=time.monotonic()
        h={"User-Agent":UA,"Accept":"application/json,text/plain,*/*","Accept-Language":"en-US,en;q=.9"}
        if headers: h.update(headers)
        try:
            with urllib.request.urlopen(urllib.request.Request(url,headers=h),timeout=45) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            last=e
            if e.code in (408,425,429,500,502,503,504) and i<tries-1:
                time.sleep(min(20,1.5*(2**i))); continue
            raise
        except Exception as e:
            last=e
            if i<tries-1:
                time.sleep(min(12,1.25*(2**i))); continue
            raise
    raise RuntimeError(str(last))

def get_json(url:str,**kw)->dict[str,Any]:
    j=json.loads(get(url,**kw))
    if not isinstance(j,dict): raise RuntimeError("expected object")
    return j

def fetch_facade(sid:str)->tuple[str,dict[str,Any]]|None:
    try:
        j=get_json(FACADE.format(sid=urllib.parse.quote(sid,safe="")))
    except Exception:
        return None
    s=j.get("source")
    if isinstance(s,str) and s.strip(): return s,j
    return None

def search_open(name:str,author:str)->tuple[str,str,dict[str,Any]]|None:
    try: j=get_json(SUGGEST.format(q=urllib.parse.quote(name)))
    except Exception: return None
    wn,wa=norm(name),norm(author)
    rows=[]
    for r in j.get("results") or []:
        if not isinstance(r,dict): continue
        rn=norm(str(r.get("scriptName") or r.get("name") or r.get("title") or ""))
        a=r.get("author") or r.get("user") or {}
        ra=norm(str(a.get("username") or a.get("display_name") or "") if isinstance(a,dict) else str(a))
        access=r.get("access",r.get("script_access"))
        if access not in (1,"open_no_auth",None): continue
        score=(rn==wn)*100 + (ra==wa and bool(wa))*30 + (wn in rn or rn in wn)*10
        sid=str(r.get("scriptIdPart") or r.get("script_id_part") or "")
        if sid and score: rows.append((score,sid,r))
    for _,sid,r in sorted(rows,reverse=True):
        got=fetch_facade(sid)
        if got:
            return got[0],sid,{"catalog":r,"facade":got[1],"provenance":"TRADINGVIEW_SEARCH"}
    return None

def github_mirror(name:str,author:str)->tuple[str,str,dict[str,Any]]|None:
    token=os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if not token: return None
    q=f'\"{name}\" language:Pine'
    url="https://api.github.com/search/code?q="+urllib.parse.quote(q)+"&per_page=10"
    headers={"Authorization":f"Bearer {token}","Accept":"application/vnd.github+json"}
    try: j=get_json(url,headers=headers,tries=2,gap=.2)
    except Exception: return None
    wn,wa=norm(name),norm(author)
    for item in j.get("items") or []:
        api=item.get("url")
        if not api: continue
        try:
            c=get_json(api,headers=headers,tries=2,gap=.2)
            import base64
            if c.get("encoding")!="base64": continue
            src=base64.b64decode(c.get("content","")).decode("utf-8","replace")
        except Exception:
            continue
        head=norm(src[:6000])
        if wn and not all(tok in head for tok in wn.split()[:3]): continue
        if wa and wa not in head and norm(str(item.get("repository",{}).get("full_name","")))!=wa:
            pass
        return src,str(item.get("html_url") or ""),{"provenance":"GITHUB_MIRROR","item":item}
    return None

def sha(s:str)->str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()

TA_FUNCS=[
"sma","ema","wma","rma","vwma","alma","hma","rsi","atr","macd","stoch","cci","mfi","roc","mom",
"stdev","variance","correlation","linreg","highest","lowest","highestbars","lowestbars","crossover",
"crossunder","cross","change","valuewhen","barssince","pivothigh","pivotlow","sar","supertrend","bb","bbw"
]
MATH_FUNCS=["abs","max","min","pow","sqrt","log","exp","round","floor","ceil"]

def compat_patch(src:str)->tuple[str,list[str]]:
    patches=[]
    out=src
    vm=VERSION_RE.search(out)
    v=int(vm.group(1)) if vm else None
    if v is not None and v<5:
        out=VERSION_RE.sub("//@version=5",out,count=1); patches.append(f"version_{v}_to_5")
    if re.search(r"(?m)^\s*study\s*\(",out):
        out=re.sub(r"(?m)^(\s*)study\s*\(",r"\1indicator(",out,count=1); patches.append("study_to_indicator")
    if re.search(r"(?<![\w.])security\s*\(",out):
        out=re.sub(r"(?<![\w.])security\s*\(","request.security(",out); patches.append("security_to_request.security")
    for fn in TA_FUNCS:
        pat=rf"(?<![\w.]){re.escape(fn)}\s*\("
        if re.search(pat,out):
            out=re.sub(pat,f"ta.{fn}(",out); patches.append(f"{fn}_to_ta")
    for fn in MATH_FUNCS:
        pat=rf"(?<![\w.]){re.escape(fn)}\s*\("
        if re.search(pat,out):
            out=re.sub(pat,f"math.{fn}(",out); patches.append(f"{fn}_to_math")
    return out,patches

def scan_calls(src:str,fn:str)->list[str]:
    calls=[]; i=0
    needle=fn+"("
    while True:
        p=src.find(needle,i)
        if p<0: break
        if p>0 and (src[p-1].isalnum() or src[p-1] in "_."): i=p+len(needle); continue
        start=p+len(fn); depth=0; quote=None; esc=False; j=start
        while j<len(src):
            ch=src[j]
            if quote:
                if esc: esc=False
                elif ch=="\\": esc=True
                elif ch==quote: quote=None
            else:
                if ch in "'\"": quote=ch
                elif ch=="(": depth+=1
                elif ch==")":
                    depth-=1
                    if depth==0:
                        calls.append(src[start+1:j]); j+=1; break
            j+=1
        i=max(j,p+len(needle))
    return calls

def split_args(body:str)->list[str]:
    out=[]; cur=[]; depth=0; quote=None; esc=False
    for ch in body:
        if quote:
            cur.append(ch)
            if esc: esc=False
            elif ch=="\\": esc=True
            elif ch==quote: quote=None
            continue
        if ch in "'\"": quote=ch; cur.append(ch)
        elif ch in "([{": depth+=1; cur.append(ch)
        elif ch in ")]}": depth=max(0,depth-1); cur.append(ch)
        elif ch=="," and depth==0: out.append("".join(cur).strip()); cur=[]
        else: cur.append(ch)
    if cur: out.append("".join(cur).strip())
    return out

def title_from_args(args:list[str])->str:
    for a in args[1:]:
        m=re.match(r"\s*(?:title|text|message)\s*=\s*['\"]([^'\"]+)",a,re.I)
        if m:return m.group(1)
    if len(args)>1:
        m=re.match(r"\s*['\"]([^'\"]+)['\"]\s*$",args[1])
        if m:return m.group(1)
    return ""

def side_from(text:str,args:list[str])->str|None:
    t=norm(text+" "+" ".join(args[1:]))
    long_words=("buy","long","bull","up","entry long","go long","bullish")
    short_words=("sell","short","bear","down","entry short","go short","bearish")
    ls=sum(w in t for w in long_words); ss=sum(w in t for w in short_words)
    if ls>ss:return "long"
    if ss>ls:return "short"
    return None

def extract_signals(src:str)->tuple[list[str],list[str],list[str]]:
    longs=[]; shorts=[]; evidence=[]
    for fn in ("alertcondition","plotshape","plotchar"):
        for body in scan_calls(src,fn):
            args=split_args(body)
            if not args: continue
            cond=args[0].strip()
            if not cond or cond.lower() in ("true","false"): continue
            title=title_from_args(args)
            side=side_from(title,args)
            if side=="long": longs.append(cond); evidence.append(f"{fn}:LONG:{title or cond[:50]}")
            elif side=="short": shorts.append(cond); evidence.append(f"{fn}:SHORT:{title or cond[:50]}")
    # named top-level signal variables as last resort
    assignments=re.findall(r"(?m)^\s*([A-Za-z_]\w*)\s*=\s*([^\n]+)$",src)
    for name,_expr in assignments:
        n=norm(name)
        if n in {"buy","buysignal","longcondition","longsignal","bullish","long"} and name not in longs:
            longs.append(name); evidence.append(f"named:LONG:{name}")
        if n in {"sell","sellsignal","shortcondition","shortsignal","bearish","short"} and name not in shorts:
            shorts.append(name); evidence.append(f"named:SHORT:{name}")
    # dedupe preserving order
    longs=list(dict.fromkeys(longs)); shorts=list(dict.fromkeys(shorts))
    return longs,shorts,evidence

def convert_decl_to_strategy(src:str)->tuple[str,list[str]]:
    patches=[]
    out=src
    m=INDICATOR_RE.search(out)
    if not m:return out,patches
    out=out[:m.start(1)]+"strategy"+out[m.end(1):]
    patches.append(f"{m.group(1)}_declaration_to_strategy")
    return out,patches

def wrapper_variant(src:str)->tuple[str,list[str],dict[str,Any]]|None:
    base,patches=compat_patch(src)
    base,p2=convert_decl_to_strategy(base); patches+=p2
    if not STRATEGY_RE.search(base): return None
    longs,shorts,evidence=extract_signals(base)
    if not longs and not shorts:return None
    suffix=["","// --- RECOVERY_LAB strategy wrapper; original signal expressions above ---"]
    if longs:
        lc=" or ".join(f"({x})" for x in longs[:8])
        suffix += [f"__recovery_long = {lc}","if __recovery_long",'    strategy.entry("REC_L", strategy.long)']
    if shorts:
        sc=" or ".join(f"({x})" for x in shorts[:8])
        suffix += [f"__recovery_short = {sc}","if __recovery_short",'    strategy.entry("REC_S", strategy.short)']
    if longs and not shorts:
        suffix += ['// No explicit short signal was found; wrapper is long-only.']
    if shorts and not longs:
        suffix += ['// No explicit long signal was found; wrapper is short-only.']
    suffix.append("")
    return base+"\\n"+"\\n".join(suffix), patches+["append_strategy_entries_from_source_signals"], {"longSignals":longs[:8],"shortSignals":shorts[:8],"evidence":evidence[:20]}

def main()->int:
    ap=argparse.ArgumentParser()
    ap.add_argument("--out-dir",required=True)
    ap.add_argument("--name",required=True)
    ap.add_argument("--author",default="")
    ap.add_argument("--script-id",default="")
    ap.add_argument("--url",default="")
    ap.add_argument("--exact-status",default="")
    ap.add_argument("--expected-sha",default="")
    args=ap.parse_args()
    out=Path(args.out_dir); out.mkdir(parents=True,exist_ok=True)
    provenance=None; source=None; sid=args.script_id; source_meta={}

    if sid:
        got=fetch_facade(sid)
        if got:
            source,source_meta=got; provenance="TRADINGVIEW_FACADE"

    if source is None:
        found=search_open(args.name,args.author)
        if found:
            source,sid,source_meta=found; provenance=source_meta.get("provenance","TRADINGVIEW_SEARCH")

    if source is None:
        mirror=github_mirror(args.name,args.author)
        if mirror:
            source,mirror_url,source_meta=mirror; provenance="GITHUB_MIRROR"
            if not args.url: args.url=mirror_url

    meta={
        "name":args.name,"author":args.author,"requestedScriptId":args.script_id,
        "resolvedScriptId":sid,"url":args.url,"exactStatus":args.exact_status,
        "provenance":provenance,"expectedExactSha256":args.expected_sha or None,
        "variants":[]
    }

    if source is None:
        meta["status"]="RECOVERY_NO_SOURCE"
        (out/"recovery-meta.json").write_text(json.dumps(meta,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
        print(json.dumps({"status":meta["status"],"name":args.name},ensure_ascii=False))
        return 0

    original_sha=sha(source); meta["originalSha256"]=original_sha
    meta["exactHashMatch"]=bool(args.expected_sha and original_sha==args.expected_sha)
    (out/"original.pine").write_text(source,encoding="utf-8",newline="\n")
    meta["variants"].append({"file":"original.pine","type":"ORIGINAL_RETRY","sha256":original_sha,"patches":[]})

    compat,patches=compat_patch(source)
    if compat!=source:
        csha=sha(compat); (out/"compat.pine").write_text(compat,encoding="utf-8",newline="\n")
        meta["variants"].append({"file":"compat.pine","type":"COMPAT_PATCH","sha256":csha,"patches":patches})

    if not STRATEGY_RE.search(source):
        w=wrapper_variant(source)
        if w:
            wrapped,wpatch,evidence=w; wsha=sha(wrapped)
            (out/"wrapper.pine").write_text(wrapped,encoding="utf-8",newline="\n")
            meta["variants"].append({"file":"wrapper.pine","type":"SIGNAL_WRAPPER","sha256":wsha,"patches":wpatch,"signalEvidence":evidence})

    meta["status"]="RECOVERY_VARIANTS_READY" if meta["variants"] else "RECOVERY_NO_VARIANT"
    (out/"recovery-meta.json").write_text(json.dumps(meta,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(json.dumps({"status":meta["status"],"variants":[v["type"] for v in meta["variants"]],"name":args.name},ensure_ascii=False))
    return 0

if __name__=="__main__":
    raise SystemExit(main())
