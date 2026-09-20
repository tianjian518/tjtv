#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
采集站体检工具 —— 一键测出哪些源现在能用。

原理：苹果CMS 采集站的标准接口是
    https://站点/api.php/provide/vod?ac=videolist&wd=关键词&pg=1
能搜到东西的才算活；再往深查一层详情接口，能拿到 .m3u8 播放地址的才真能看。

用法：
    python3 probe.py                    # 用内置源清单体检
    python3 probe.py -f mysources.txt   # 用自定义清单（每行 名称|接口地址）
    python3 probe.py -k 流浪地球         # 换关键词
"""

import argparse
import concurrent.futures
import json
import sys
import urllib.parse
import urllib.request

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36")

# 内置候选清单（2026-09 实测，可自行增删）
BUILTIN = """最大|http://zuidazy.me/api.php/provide/vod
百度|https://api.apibdzy.com/api.php/provide/vod
无尽|https://api.wujinapi.com/api.php/provide/vod
速博|https://subocaiji.com/api.php/provide/vod
魔都|https://caiji.moduapi.cc/api.php/provide/vod
火狐|https://hhzyapi.com/api.php/provide/vod
新浪|https://api.xinlangapi.com/xinlangapi.php/provide/vod
飘零|https://p2100.net/api.php/provide/vod
虎牙|https://www.huyaapi.com/api.php/provide/vod
快车|https://caiji.kczyapi.com/api.php/provide/vod
奇虎|https://caiji.qhzyapi.com/api.php/provide/vod
快云|https://www.kuaiyunzy.com/api.php/provide/vod
闪电|http://sdzyapi.com/api.php/provide/vod
樱花|https://m3u8.apiyhzy.com/api.php/provide/vod
卧龙|https://collect.wolongzyw.com/api.php/provide/vod
飘花|http://www.ahjiuman.com/api.php/provide/vod"""


def http_get(url: str, timeout: int = 12) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def probe(name: str, base: str, keyword: str) -> dict:
    """返回 {name, url, status, videos, episodes, sample, note}"""
    out = {"name": name, "url": base, "status": "FAIL", "videos": 0,
           "episodes": 0, "sample": "", "note": ""}
    base = base.rstrip("/")
    try:
        # 第一步：搜索
        q = urllib.parse.urlencode({"ac": "videolist", "wd": keyword, "pg": 1})
        body = http_get(f"{base}?{q}")
        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            out["note"] = "返回的不是 JSON（可能被防火墙拦截或接口已失效）"
            return out

        lst = data.get("list") or []
        if not lst:
            out["note"] = "搜索无结果"
            return out
        out["videos"] = len(lst)
        out["status"] = "搜索可用"

        # 第二步：详情，看能不能拿到 m3u8
        vid = lst[0].get("vod_id")
        if not vid:
            return out
        q2 = urllib.parse.urlencode({"ac": "videolist", "ids": vid})
        detail = json.loads(http_get(f"{base}?{q2}", timeout=15))
        dl = detail.get("list") or []
        if not dl:
            out["note"] = "详情接口无数据"
            return out

        v = dl[0]
        out["sample"] = str(v.get("vod_name", "?"))[:20]
        play = str(v.get("vod_play_url") or "")
        if not play:
            out["note"] = "无播放地址字段"
            return out

        # 格式：第1集$http://x/a.m3u8#第2集$http://x/b.m3u8$$$备用线路$...
        # 注意：$ 是分隔符，必须用 split 取值，不能用正则直接匹配整个串。
        first_line = play.split("$$$")[0]           # 只取第一条线路
        eps = [x for x in first_line.split("#") if x]
        urls = []
        for ep in eps:
            parts = ep.split("$", 1)                # 最多切一刀，防止 URL 内自带 $
            if len(parts) == 2:
                u = parts[1].strip()
                if u.startswith("http://") or u.startswith("https://"):
                    urls.append(u)

        out["episodes"] = len(eps)
        m3u8 = [u for u in urls if ".m3u8" in u.lower()]
        if m3u8:
            out["status"] = "可播放"
            out["note"] = f"《{out['sample']}》{len(eps)}集，m3u8 直链可用"
        elif urls:
            out["status"] = "有地址"
            out["note"] = f"《{out['sample']}》有播放地址但非 m3u8，播放器可能不支持"
        else:
            out["status"] = "无地址"
            out["note"] = "播放地址字段为空，需爬详情页提取"
    except Exception as e:
        out["note"] = f"{type(e).__name__}: {str(e)[:60]}"
    return out


def main():
    ap = argparse.ArgumentParser(description="采集站体检工具")
    ap.add_argument("-f", "--file", help="自定义源清单文件，每行 名称|接口地址")
    ap.add_argument("-k", "--keyword", default="庆余年", help="测试用搜索关键词")
    ap.add_argument("-o", "--output", help="把可播放的源导出为 LibreTV 订阅 JSON")
    args = ap.parse_args()

    raw = open(args.file, encoding="utf-8").read() if args.file else BUILTIN
    items = []
    for line in raw.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "|" in line:
            n, u = line.split("|", 1)
            items.append((n.strip(), u.strip()))
        else:
            items.append((line, line))

    print(f"开始体检 {len(items)} 个采集站，关键词「{args.keyword}」\n")
    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
        futs = {ex.submit(probe, n, u, args.keyword): n for n, u in items}
        for f in concurrent.futures.as_completed(futs):
            r = f.result()
            results.append(r)
            print(f"  {r['name']:<6} {r['status']:<10} {r['note']}")

    RANK = {"可播放": 0, "有地址": 1, "搜索可用": 2, "无地址": 3}
    results.sort(key=lambda r: (RANK.get(r["status"], 9), r["name"]))
    good = [r for r in results if r["status"] == "可播放"]

    print(f"\n{'='*60}")
    print(f"可用源：{len(good)} / {len(items)}")
    print(f"{'='*60}")
    for r in good:
        print(f"  {r['name']}  —  {r['url']}")

    if args.output and good:
        payload = {
            "name": "我的源列表",
            "version": 2,
            "sources": [{"name": r["name"], "url": r["url"]} for r in good],
        }
        with open(args.output, "w", encoding="utf-8") as fp:
            json.dump(payload, fp, ensure_ascii=False, indent=2)
        print(f"\n已导出订阅文件：{args.output}")
        print("在 LibreTV「设置 → 源管理 → 数据源订阅」填入该文件的公开地址即可导入。")

    return 0 if good else 1


if __name__ == "__main__":
    sys.exit(main())
