#!/usr/bin/env python3
"""Build the independent RECOVERY_LAB matrix from the exact-source audit.

Every publication is admitted to the recovery lab. A recovery job first tries
its source as published; only sources that are not directly runnable, or
indicator-only publications, are modified. The exact-source workflow remains
untouched and its results are never mixed with recovery results.
"""
from __future__ import annotations

import argparse, json, os
from pathlib import Path

def main() -> int:
    ap=argparse.ArgumentParser()
    ap.add_argument("resolved_manifest")
    ap.add_argument("--out", default="artifacts/recovery-audit/matrix.json")
    ap.add_argument("--exclude-summary-root", default="")
    args=ap.parse_args()
    data=json.loads(Path(args.resolved_manifest).read_text(encoding="utf-8"))
    exclude=set()
    if args.exclude_summary_root:
        root=Path(args.exclude_summary_root)
        if root.exists():
            for p in root.rglob("summary.json"):
                try:
                    s=json.loads(p.read_text(encoding="utf-8")).get("strategy",{})
                    key=s.get("key")
                    if key: exclude.add(str(key))
                except Exception:
                    pass
    include=[]
    for row in data.get("resolved",[]):
        key=f"{int(row['index']):03d}-" + "".join(
            c if c.isalnum() else "-" for c in str(row.get("name") or "").lower()
        ).strip("-")[:72]
        if key in exclude:
            continue
        include.append({
            "key": key,
            "index": row.get("index"),
            "origin": row.get("origin"),
            "group": row.get("group"),
            "name": row.get("name"),
            "author": row.get("author"),
            "exact_status": row.get("status"),
            "script_id_part": row.get("scriptIdPart") or "",
            "source_sha256": row.get("sourceSha256") or "",
            "pine_version": row.get("pineVersion") or "",
            "url": row.get("resolvedUrl") or row.get("requestedUrl") or "",
        })
    matrix={"include":include}
    p=Path(args.out); p.parent.mkdir(parents=True,exist_ok=True)
    p.write_text(json.dumps(matrix,ensure_ascii=False,separators=(",",":"))+"\n",encoding="utf-8")
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"],"a",encoding="utf-8",newline="\n") as f:
            f.write("matrix="+json.dumps(matrix,ensure_ascii=False,separators=(",",":"))+"\n")
            f.write(f"count={len(include)}\n")
    print(json.dumps({"count":len(include),"excludedSuccessfulExact":len(exclude)},ensure_ascii=False))
    return 0

if __name__=="__main__":
    raise SystemExit(main())
