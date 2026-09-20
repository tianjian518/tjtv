#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把巡检结果同步成 tjtv 的内置源清单。

区别：
  app/data/tjtv-sources.json  —— 运行时清单，接口和管理页维护
  app/data/builtin-sources.json —— 内置清单，随项目发布，开箱可用

本脚本把运行时清单里「当前活着」的源写进内置清单，
这样即使换台机器、删掉运行时清单，服务启动也自带一批可用源。

用法：
    python3 scripts/sync_builtin.py            # 同步
    python3 scripts/sync_builtin.py --limit 10 # 只取前 10 个
"""

import argparse
import json
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP_DATA = ROOT / "app" / "data"
SOURCES_FILE = APP_DATA / "tjtv-sources.json"
BUILTIN_FILE = APP_DATA / "builtin-sources.json"
POOL_FILE = ROOT / "data" / "source-pool.txt"


def host_of(url: str) -> str:
    return url.split("//")[-1].split("/")[0]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="最多写几个（0=全部）")
    args = ap.parse_args()

    try:
        runtime = json.loads(SOURCES_FILE.read_text(encoding="utf-8"))
    except Exception:
        print(f"❌ 读不到 {SOURCES_FILE}，请先跑 auto_update.py")
        return 1

    srcs = [s for s in runtime.get("sources", []) if s.get("enabled", True)]
    if args.limit:
        srcs = srcs[:args.limit]

    if not srcs:
        print("⚠️  运行时清单是空的，没有可同步的源")
        return 1

    # 按域名去重（同站别名只留一个）
    seen, final = set(), []
    for s in srcs:
        h = host_of(s["url"])
        if h in seen:
            continue
        seen.add(h)
        final.append({
            "name": s["name"],
            "url": s["url"],
            "key": s.get("key", f"builtin_{len(final)}"),
            "builtin": True,
        })

    payload = {
        "name": "tjtv 内置源",
        "version": 2,
        "updated": datetime.now().strftime("%Y-%m-%d"),
        "note": ("本文件由 scripts/sync_builtin.py 从巡检结果同步而来。"
                 "收录的是近期实测能搜到内容且能拿到 m3u8 直链的采集站。"
                 "源会失效，建议定期重跑 scripts/auto_update.py 后再次同步。"),
        "sources": final,
        "liveSources": [],
    }

    BUILTIN_FILE.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"✅ 已同步 {len(final)} 个源到内置清单")
    for s in final:
        print(f"   {s['name']:<8} {s['url']}")
    print(f"\n写入：{BUILTIN_FILE.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
