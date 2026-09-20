#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tjtv 源自动巡检 —— 从候选池里筛出活的源，自动更新 tjtv 的源清单。

做什么（替补制：挂一个补一个）：
  1. 读候选池 data/source-pool.txt（四十多个候选地址）
  2. 先测清单里已有的源 —— 关注它们是不是还活着
  3. 连续 3 次探不活的源 → 从清单删除
  4. 删掉几个，就从候选池补几个进来，保持清单始终有 N 个源（默认 15）
  5. 一个都没挂 → 什么都不做，清单保持不动
  6. 写巡检报告

挂定时任务（每天凌晨 3 点跑一次）：
  crontab -e
  0 3 * * * cd /你的路径/tjtv && python3 scripts/auto_update.py >> logs/auto.log 2>&1

用法：
  python3 scripts/auto_update.py                 # 正式巡检并更新
  python3 scripts/auto_update.py --dry-run       # 只报告，不改文件
  python3 scripts/auto_update.py --min-ok 3      # 至少要有 3 个活源才允许删死源
  python3 scripts/auto_update.py --max-sources 8 # 清单上限，超了按探活速度择优
"""

import argparse
import concurrent.futures
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path

# ---------- 路径解析 ----------
# 两种运行环境要都能工作：
#
#  ① 本地开发（项目根目录结构）
#       tjtv/
#       ├── app/data/       ← 源清单在这
#       ├── data/           ← 候选池、状态、报告在这
#       └── scripts/
#
#  ② 容器内（Dockerfile 把脚本和源清单都平铺到 /app）
#       /app/
#       ├── data/           ← 源清单 + 候选池 + 状态都在同一个目录
#       └── scripts/
#
# 判定方式：优先看 TJTV_DATA_DIR 环境变量（entrypoint 会设），
# 没设就按目录结构推断。

def _resolve_paths():
    env_dir = os.environ.get("TJTV_DATA_DIR")
    here = Path(__file__).resolve()

    if env_dir:
        # 容器内：数据目录由环境变量指定
        data_dir = Path(env_dir)
        # 容器里 data 目录同时放源清单和候选池
        app_data = data_dir
        work_data = data_dir
    else:
        root = here.parent.parent
        app_data = root / "app" / "data"
        if app_data.exists():
            # 本地开发结构
            work_data = root / "data"
        else:
            # 退路：脚本旁边的 data 目录（容器内没设环境变量时）
            app_data = here.parent / "data"
            work_data = app_data

    return app_data, work_data


APP_DATA, DATA = _resolve_paths()
SOURCES_FILE = APP_DATA / "tjtv-sources.json"
STATE_FILE = DATA / "probe-state.json"
POOL_FILE = DATA / "source-pool.txt"
REPORT_FILE = DATA / "last-report.md"

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36")

# 测试关键词：挑几个热门片名，中一个就算通过
TEST_KEYWORDS = ["庆余年", "流浪地球", "哪吒"]

# 连续失败多少次就判定该源已死、从清单移除
FAIL_THRESHOLD = 3


# ---------- 基础工具 ----------
def http_json(url: str, timeout: int = 12):
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Accept": "application/json, */*",
    })
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


def parse_episodes(play_url: str):
    """
    解析 vod_play_url，返回 m3u8 地址列表。
    格式：第1集$http://x/a.m3u8#第2集$http://x/b.m3u8$$$备用线路$...
    """
    if not play_url:
        return []
    first_line = play_url.split("$$$")[0]
    out = []
    for ep in first_line.split("#"):
        parts = ep.split("$", 1)
        if len(parts) == 2:
            u = parts[1].strip()
            if u.startswith(("http://", "https://")):
                out.append(u)
    return out


# ---------- 探活 ----------
def probe_one(name: str, base: str) -> dict:
    """
    三层校验，一层比一层严：
      L1 能连上并返回 JSON      → 站点活着
      L2 能搜到内容              → 接口没被限制
      L3 能拿到 m3u8 播放地址    → 真能看（这是唯一算「可用」的标准）
    """
    base = base.rstrip("/")
    r = {"name": name, "url": base, "ok": False, "level": 0,
         "reason": "", "count": 0, "eps": 0, "ms": 0}

    top = time.time()
    r = {"name": name, "url": base, "ok": False, "level": 0,
         "reason": "", "count": 0, "eps": 0, "ms": 0,
         "err": "", "keywords_tried": [], "api_ok": False}
    t0 = time.time()

    try:
        # L1 + L2：搜索。多个关键词逐个试，全部失败才算搜不到
        found = None
        last_err = ""
        for kw in TEST_KEYWORDS:
            q = urllib.parse.urlencode({"ac": "videolist", "wd": kw, "pg": 1})
            r["keywords_tried"].append(kw)
            try:
                data = http_json(f"{base}?{q}")
                r["api_ok"] = True          # 能返回合法 JSON，说明接口是活的
            except json.JSONDecodeError:
                last_err = "接口返回的不是 JSON（可能被防火墙拦截或已停用）"
                continue
            except Exception as e:
                last_err = f"{type(e).__name__}: {str(e)[:50]}"
                continue

            lst = (data or {}).get("list") or []
            if lst:
                found = (kw, lst)
                break

        if not found:
            r["level"] = 1 if r["api_ok"] else 0
            if r["api_ok"]:
                r["reason"] = f"接口正常，但 {'/'.join(TEST_KEYWORDS)} 都搜不到结果（可能资源库为空）"
            else:
                r["reason"] = last_err or "连不上"
            r["ms"] = int((time.time() - t0) * 1000)
            return r

        kw, lst = found
        r["count"] = len(lst)
        r["level"] = 2

        # L3：验证能拿到 m3u8。搜索接口本身就常带 vod_play_url，先直接用
        for item in lst:
            eps = parse_episodes(str(item.get("vod_play_url") or ""))
            if eps:
                r.update(ok=True, level=3, eps=len(eps),
                         reason=f"命中《{kw}》，{len(eps)} 集可播")
                r["ms"] = int((time.time() - top) * 1000)
                return r

        # 搜索接口没给，再查一次详情接口
        vid = lst[0].get("vod_id")
        if vid:
            q2 = urllib.parse.urlencode({"ac": "videolist", "ids": vid})
            try:
                detail = http_json(f"{base}?{q2}", timeout=15)
                for item in ((detail or {}).get("list") or []):
                    eps = parse_episodes(str(item.get("vod_play_url") or ""))
                    if eps:
                        r.update(ok=True, level=3, eps=len(eps),
                                 reason=f"详情接口命中，{len(eps)} 集可播")
                        r["ms"] = int((time.time() - top) * 1000)
                        return r
            except Exception:
                pass

        r["reason"] = "有搜索结果但没有拿到 m3u8 播放地址"
        r["ms"] = int((time.time() - top) * 1000)
        return r

    except Exception as e:
        r["reason"] = f"{type(e).__name__}: {str(e)[:60]}"
        r["ms"] = int((time.time() - top) * 1000)
        return r


def load_pool() -> list:
    if not POOL_FILE.exists():
        print(f"❌ 找不到候选池：{POOL_FILE}")
        sys.exit(1)
    items = []
    for line in POOL_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "|" not in line:
            continue
        n, u = line.split("|", 1)
        n, u = n.strip(), u.strip()
        if n and u.startswith(("http://", "https://")):
            items.append((n, u))
    return items


def load_json(p: Path, default):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return default


def save_json(p: Path, obj):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")


# ---------- 主流程 ----------
def main():
    ap = argparse.ArgumentParser(description="tjtv 源自动巡检")
    ap.add_argument("--dry-run", action="store_true", help="只报告，不修改任何文件")
    ap.add_argument("--min-ok", type=int, default=3,
                    help="至少要有这么多个活源，才允许执行删除（默认 3，防误删）")
    ap.add_argument("--target", type=int, default=15,
                    help="清单目标数量，挂一个补一个直到达到这个数（默认 15）")
    ap.add_argument("--workers", type=int, default=12, help="并发数")
    args = ap.parse_args()

    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print("=" * 64)
    print(f"  tjtv 源自动巡检   {now}")
    print("=" * 64)

    # 1) 读候选池
    pool = load_pool()
    print(f"\n📋 候选池：{len(pool)} 个待测源")
    print("🔍 正在并发探活，请稍候...\n")

    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(probe_one, n, u): n for n, u in pool}
        for f in concurrent.futures.as_completed(futs):
            results.append(f.result())

    # 可用源排序：先按资源完整度（集数），再按响应速度
    def rank(r):
        eps = r.get("eps", 0)
        tier = 0 if eps >= 20 else (1 if eps >= 2 else 2)
        return (tier, r["ms"])

    alive = sorted([r for r in results if r["ok"]], key=rank)
    dead = [r for r in results if not r["ok"]]

    # 2) 打印结果
    print("─" * 64)
    print(f"✅ 可用源 {len(alive)} 个（能拿到 m3u8 直链）")
    print("─" * 64)
    for r in alive:
        print(f"  {r['name']:<8} {r['ms']:>5}ms  {r['eps']:>3}集  {r['reason']}")

    if dead:
        print(f"\n❌ 不可用 {len(dead)} 个")
        for r in sorted(dead, key=lambda x: x["name"]):
            print(f"  {r['name']:<8} [{r['level']}] {r['reason'][:52]}")

    # ==================================================================
    # 更新策略：替补制（不是择优制）
    #
    #   1. 先看清单里已有的源，哪些挂了？
    #   2. 挂掉的判定：连续 FAIL_THRESHOLD 次探测失败 → 删除
    #   3. 删掉几个，就从候选池补几个进来
    #   4. 一个都没挂 → 什么都不做（清单保持不动）
    #
    # 这样做的好处：清单稳定，不因网络波动无谓变动；
    # 每次变动的唯一原因就是「确实有源坏了」。
    # ==================================================================

    # 3) 读现有清单与历史状态
    store = load_json(SOURCES_FILE, {"version": 1, "sources": []})
    existing = store.get("sources", [])
    state = load_json(STATE_FILE, {"failStreak": {}, "history": [], "retired": []})
    fail_streak = state.get("failStreak", {})   # url -> 连续失败次数
    retired = state.get("retired", [])          # 淘汰过的 url，避免加了又删来回抖

    alive_by_url = {r["url"].rstrip("/"): r for r in alive}

    def score_of(r):
        """
        补位时挑源的优先级，越小越好。
        集数：>=20集 资源完整(0)｜2-19集(1)｜1集残片(2)
        响应：只分「快」「慢」两档（阈值 8 秒）。
        速度粗分档是刻意的——精确毫秒每轮都在抖，会导致无谓的排序变化。
        """
        eps = r.get("eps", 0)
        eps_tier = 0 if eps >= 20 else (1 if eps >= 2 else 2)
        ms = r.get("ms", 9999)
        ms_tier = 0 if ms < 8000 else 1
        return (eps_tier, ms_tier, ms)

    # 4) 盘点：现有源里谁挂了
    to_remove = []
    for s in existing:
        u = s["url"].rstrip("/")
        if u in alive_by_url:
            fail_streak[u] = 0            # 活着 → 清零
            continue
        fail_streak[u] = fail_streak.get(u, 0) + 1
        if fail_streak[u] >= FAIL_THRESHOLD:
            to_remove.append(s)
            if u not in retired:
                retired.append(u)

    # 安全闸：活源太少就不删（怕把清单掏空）
    if to_remove and len(alive) < args.min_ok:
        print(f"\n⚠️  当前只有 {len(alive)} 个活源（低于 {args.min_ok}），"
              f"为避免清单被清空，本次不执行任何删除。")
        to_remove = []

    # 5) 保留没挂的源
    kept = [s for s in existing if s["url"].rstrip("/") not in
            {x["url"].rstrip("/") for x in to_remove}]

    # 6) 补位：删了几个就补几个，直到清单达到目标数量
    #    候选要求：活着 + 不在清单里 + 不在淘汰名单里
    kept_urls = {s["url"].rstrip("/") for s in kept}
    candidates = sorted(
        [r for r in alive
         if r["url"].rstrip("/") not in kept_urls and r["url"].rstrip("/") not in retired],
        key=score_of,
    )

    to_add = []
    for r in candidates:
        if len(kept) >= args.target:
            break
        to_add.append(r)
        kept.append({
            "key": f"auto_{int(time.time())}_{len(to_add)}",
            "name": r["name"],
            "url": r["url"],
            "enabled": True,
            "builtin": False,
            "note": f"自动巡检补入 {now[:10]}",
            "addedAt": datetime.now().isoformat(),
        })

    final = kept

    # 8) 汇总变动
    print("\n" + "─" * 64)
    print("  本次变动")
    print("─" * 64)
    def tag(name, url):
        """同名源不少（多个站都叫天堂/魔都），带上域名前缀避免看混"""
        host = url.split("//")[-1].split("/")[0][:22]
        return f"{name}({host})"

    print(f"  补入：{len(to_add)} 个" + (
        f"  {'; '.join(tag(r['name'], r['url']) for r in to_add)}" if to_add else ""))
    print(f"  移除：{len(to_remove)} 个" + (
        f"  {'; '.join(tag(s['name'], s['url']) for s in to_remove)}" if to_remove else ""))
    if not to_add and not to_remove:
        print("  → 所有源都在线，无需变动")
    print(f"  清单：{len(existing)} → {len(final)} 个源")

    # 9) 写回
    if args.dry_run:
        print("\n🔸 --dry-run 模式，未修改任何文件")
    else:
        store["sources"] = final
        save_json(SOURCES_FILE, store)

        state["failStreak"] = {k: v for k, v in fail_streak.items() if v > 0 or
                               k in {s["url"].rstrip("/") for s in final}}
        state["retired"] = retired[-100:]   # 淘汰名单只留最近 100 条
        state.setdefault("history", []).append({
            "time": now, "alive": len(alive), "total": len(results),
            "added": len(to_add), "removed": len(to_remove),
            "final": len(final),
        })
        state["history"] = state["history"][-60:]  # 只留最近 60 次
        save_json(STATE_FILE, state)

        print(f"\n✅ 已更新 {SOURCES_FILE}")
        print("   （tjtv 需重启服务生效，或等下次启动自动读取）")

        # 写可读报告
        lines = [
            f"# tjtv 源巡检报告",
            f"",
            f"巡检时间：{now}",
            f"候选池：{len(results)} 个 ｜ 可用：{len(alive)} 个",
            f"",
            f"## 可用源（按响应速度排序）",
            f"",
            f"| 源 | 响应 | 集数 | 说明 |",
            f"| --- | --- | --- | --- |",
        ]
        for r in alive:
            lines.append(f"| {r['name']} | {r['ms']}ms | {r['eps']} | {r['reason']} |")
        lines += ["", "## 本次变动", "",
                  f"- 新增 {len(to_add)} 个：{', '.join(r['name'] for r in to_add) or '无'}",
                  f"- 移除 {len(to_remove)} 个：{', '.join(s['name'] for s in to_remove) or '无'}",
                  f"- 清单大小：{len(existing)} → {len(final)}"]
        if dead:
            lines += ["", "## 不可用", ""]
            for r in sorted(dead, key=lambda x: x["name"]):
                lines.append(f"- {r['name']}：{r['reason'][:60]}")
        REPORT_FILE.write_text("\n".join(lines), encoding="utf-8")
        print(f"✅ 报告已写入 {REPORT_FILE}")

    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
