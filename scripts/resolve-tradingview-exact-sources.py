#!/usr/bin/env python3
"""Resolve TradingView publications to exact, unmodified Pine sources.

Policy: never reconstruct, translate, repair, upgrade, or infer source logic.
The source text is fetched only to classify/hash it; it is not committed.
Open-source strategy publications become READY_SOURCE. Everything else is
explicitly skipped with a machine-readable reason.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0 Safari/537.36"
)
SUGGEST = "https://www.tradingview.com/pubscripts-suggest-json/?search={q}"
FACADE = "https://pine-facade.tradingview.com/pine-facade/get/{sid}/last?no_4xx=true"
SID_RE = re.compile(r'"script_id_part"\s*:\s*"(PUB;[0-9a-f]+)"', re.I)
STRATEGY_RE = re.compile(r"(?m)^\s*strategy\s*\(")
INDICATOR_RE = re.compile(r"(?m)^\s*(?:indicator|study)\s*\(")
VERSION_RE = re.compile(r"(?m)^\s*//@version\s*=\s*(\d+)")
PUBLIC_ID_RE = re.compile(r"/script/([^/\-?]+)", re.I)

_last_request = 0.0
_search_cache: dict[str, list[dict[str, Any]]] = {}


def norm(value: str | None) -> str:
    text = unicodedata.normalize("NFKD", value or "")
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def slug(value: str) -> str:
    x = re.sub(r"[^a-z0-9]+", "-", norm(value)).strip("-")
    return x[:80] or "script"


def get_bytes(url: str, *, tries: int = 3, gap: float = 0.55) -> bytes:
    global _last_request
    last: Exception | None = None
    for attempt in range(tries):
        wait = gap - (time.monotonic() - _last_request)
        if wait > 0:
            time.sleep(wait)
        _last_request = time.monotonic()
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": UA,
                "Accept": "application/json,text/html;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=40) as response:
                return response.read()
        except urllib.error.HTTPError as exc:
            last = exc
            if exc.code == 429 and attempt < tries - 1:
                time.sleep(8 * (attempt + 1))
                continue
            raise
        except Exception as exc:  # noqa: BLE001
            last = exc
            if attempt < tries - 1:
                time.sleep(1.5 * (attempt + 1))
                continue
            raise
    raise RuntimeError(str(last))


def get_json(url: str) -> dict[str, Any]:
    raw = get_bytes(url)
    payload = json.loads(raw)
    if not isinstance(payload, dict):
        raise RuntimeError("expected JSON object")
    return payload


def public_id_from_url(url: str | None) -> str | None:
    if not url:
        return None
    m = PUBLIC_ID_RE.search(url)
    return m.group(1) if m else None


def page_sid(url: str) -> str | None:
    try:
        html = get_bytes(url).decode("utf-8", "replace")
    except Exception:
        return None
    m = SID_RE.search(html)
    return m.group(1) if m else None


def search_cards(query: str, pages: int = 2) -> list[dict[str, Any]]:
    key = query.strip()
    if key in _search_cache:
        return _search_cache[key]
    cards: list[dict[str, Any]] = []
    url = SUGGEST.format(q=urllib.parse.quote(key))
    for _ in range(pages):
        try:
            payload = get_json(url)
        except Exception:
            break
        for row in payload.get("results") or []:
            if not isinstance(row, dict):
                continue
            cards.append(row)
        nxt = payload.get("next")
        if not nxt:
            break
        url = nxt if str(nxt).startswith("http") else "https://www.tradingview.com" + str(nxt)
    _search_cache[key] = cards
    return cards


def choose_card(name: str, author: str | None, url: str | None) -> tuple[dict[str, Any] | None, str | None]:
    cards = search_cards(name)
    wanted_public = norm(public_id_from_url(url))
    wanted_name = norm(name)
    wanted_author = norm(author)

    if wanted_public:
        exact_public = [
            row
            for row in cards
            if norm(str(row.get("imageUrl") or row.get("image_url") or "")) == wanted_public
        ]
        if len(exact_public) == 1:
            return exact_public[0], None

    def author_of(row: dict[str, Any]) -> str:
        a = row.get("author") or row.get("user") or {}
        if isinstance(a, dict):
            return norm(str(a.get("username") or a.get("display_name") or ""))
        return norm(str(a))

    def name_of(row: dict[str, Any]) -> str:
        return norm(str(row.get("scriptName") or row.get("name") or row.get("title") or ""))

    exact = [
        row for row in cards
        if name_of(row) == wanted_name and (not wanted_author or author_of(row) == wanted_author)
    ]
    if len(exact) == 1:
        return exact[0], None

    prefix = [
        row for row in cards
        if (name_of(row).startswith(wanted_name) or wanted_name.startswith(name_of(row)))
        and (not wanted_author or author_of(row) == wanted_author)
    ]
    if len(prefix) == 1:
        return prefix[0], None

    if not cards:
        return None, "SKIP_NOT_FOUND"
    return None, "SKIP_AMBIGUOUS"


def sid_from_card(card: dict[str, Any]) -> str | None:
    return str(card.get("scriptIdPart") or card.get("script_id_part") or "").strip() or None


def card_url(card: dict[str, Any]) -> str | None:
    direct = str(card.get("chart_url") or card.get("chartUrl") or "").strip()
    if direct:
        if direct.startswith("http"):
            return direct
        return "https://www.tradingview.com" + (direct if direct.startswith("/") else "/" + direct)
    image = str(card.get("imageUrl") or card.get("image_url") or "").strip()
    if image:
        return f"https://www.tradingview.com/script/{image}/"
    return None


def card_access(card: dict[str, Any]) -> Any:
    return card.get("access", card.get("script_access"))


def card_kind(card: dict[str, Any]) -> str:
    extra = card.get("extra") or {}
    if isinstance(extra, dict) and extra.get("kind"):
        return str(extra["kind"])
    value = card.get("type", card.get("script_type"))
    if value == 2 or str(value).lower() == "strategy":
        return "strategy"
    if value == 1 or str(value).lower() in {"indicator", "study"}:
        return "indicator"
    return "unknown"


def fetch_source(sid: str) -> dict[str, Any]:
    return get_json(FACADE.format(sid=urllib.parse.quote(sid, safe="")))


def resolve_item(item: dict[str, Any], index: int) -> dict[str, Any]:
    name = str(item.get("name") or "").strip()
    author = str(item.get("author") or "").strip()
    source_url = item.get("url")
    record: dict[str, Any] = {
        "index": index,
        "origin": item.get("origin"),
        "group": item.get("group"),
        "name": name,
        "author": author,
        "requestedUrl": source_url,
        "status": "PENDING",
    }

    sid = page_sid(str(source_url)) if source_url else None
    card = None
    card_error = None
    if not sid:
        card, card_error = choose_card(name, author, str(source_url) if source_url else None)
        if card is None:
            record["status"] = card_error or "SKIP_NOT_FOUND"
            return record
        sid = sid_from_card(card)
        if not sid:
            record["status"] = "SKIP_NOT_FOUND"
            return record

    record["scriptIdPart"] = sid
    if card is not None:
        record["resolvedUrl"] = card_url(card) or source_url
        record["catalogAccess"] = card_access(card)
        record["catalogKind"] = card_kind(card)
    else:
        record["resolvedUrl"] = source_url
        record["catalogAccess"] = None
        record["catalogKind"] = "unknown"

    try:
        payload = fetch_source(sid)
    except urllib.error.HTTPError as exc:
        record["status"] = "SKIP_SOURCE_UNAVAILABLE"
        record["error"] = f"HTTP {exc.code}"
        return record
    except Exception as exc:  # noqa: BLE001
        record["status"] = "SKIP_SOURCE_UNAVAILABLE"
        record["error"] = str(exc)
        return record

    source = payload.get("source")
    access = payload.get("scriptAccess")
    record["facadeAccess"] = access
    record["publicationVersion"] = payload.get("version")
    record["publicationName"] = payload.get("scriptName")

    if not isinstance(source, str) or not source:
        record["status"] = "SKIP_SOURCE_UNAVAILABLE"
        record["error"] = str(payload.get("detail") or payload.get("message") or "source empty")
        return record

    raw = source.encode("utf-8")
    record["sourceSha256"] = hashlib.sha256(raw).hexdigest()
    record["sourceBytes"] = len(raw)
    vm = VERSION_RE.search(source)
    record["pineVersion"] = int(vm.group(1)) if vm else None
    is_strategy = bool(STRATEGY_RE.search(source))
    is_indicator = bool(INDICATOR_RE.search(source))
    record["sourceDecl"] = "strategy" if is_strategy else "indicator" if is_indicator else "unknown"

    if not is_strategy:
        record["status"] = "SKIP_NOT_STRATEGY"
        return record

    record["status"] = "READY_SOURCE"
    record["key"] = f"{index:03d}-{slug(name)}"
    return record


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("manifest")
    ap.add_argument("--out-dir", default="artifacts/exact-source-audit")
    args = ap.parse_args()

    manifest = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
    items = manifest.get("items") or []
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    resolved: list[dict[str, Any]] = []
    for index, item in enumerate(items, 1):
        try:
            row = resolve_item(item, index)
        except Exception as exc:  # noqa: BLE001
            row = {
                "index": index,
                "origin": item.get("origin"),
                "group": item.get("group"),
                "name": item.get("name"),
                "author": item.get("author"),
                "requestedUrl": item.get("url"),
                "status": "SKIP_RESOLUTION_ERROR",
                "error": str(exc),
            }
        resolved.append(row)
        print(f"[{index:03d}/{len(items):03d}] {row['status']:24s} {row.get('name','')}", flush=True)

    ready = [row for row in resolved if row.get("status") == "READY_SOURCE"]
    counts: dict[str, int] = {}
    for row in resolved:
        counts[row["status"]] = counts.get(row["status"], 0) + 1

    report = {
        "schemaVersion": 1,
        "policy": manifest.get("policy"),
        "inputCount": len(items),
        "readyCount": len(ready),
        "counts": counts,
        "resolved": resolved,
    }
    (out_dir / "resolved-manifest.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    matrix = {
        "include": [
            {
                "key": row["key"],
                "index": row["index"],
                "name": row["name"],
                "author": row["author"],
                "origin": row["origin"],
                "group": row["group"],
                "script_id_part": row["scriptIdPart"],
                "source_sha256": row["sourceSha256"],
                "pine_version": row.get("pineVersion"),
                "publication_version": row.get("publicationVersion"),
                "url": row.get("resolvedUrl") or row.get("requestedUrl"),
            }
            for row in ready
        ]
    }
    (out_dir / "matrix.json").write_text(
        json.dumps(matrix, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8"
    )

    gh_output = Path(str(Path.cwd() / ".github-output-placeholder"))
    import os
    if os.environ.get("GITHUB_OUTPUT"):
        gh_output = Path(os.environ["GITHUB_OUTPUT"])
        with gh_output.open("a", encoding="utf-8", newline="\n") as fh:
            fh.write("matrix=" + json.dumps(matrix, ensure_ascii=False, separators=(",", ":")) + "\n")
            fh.write(f"ready_count={len(ready)}\n")

    print(json.dumps({"ready": len(ready), "counts": counts}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
