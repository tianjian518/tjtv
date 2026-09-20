#!/usr/bin/env node
/**
 * tjtv 源自动巡检（Node.js 版）
 *
 * 为什么用 Node 而不是 Python：
 *   容器镜像本来就带 Node，用 Node 写巡检就不用往镜像里额外装 python3，
 *   构建更快、体积更小、也少一层系统依赖。逻辑与 Python 版完全一致。
 *
 * 策略：替补制（挂一个补一个）
 *   1. 先测清单里已有的源
 *   2. 连续 3 次探不活的 → 删除
 *   3. 删几个就补几个，补到目标数量
 *   4. 没源挂掉 → 什么都不做
 *
 * 用法：
 *   node scripts/auto-update.mjs                    # 巡检并更新
 *   node scripts/auto-update.mjs --dry-run          # 只报告不改文件
 *   node scripts/auto-update.mjs --target 20        # 保持 20 个源
 *   node scripts/auto-update.mjs --verbose          # 打印探测细节
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------- 路径解析 ----------------
// 兼容两种环境：
//   本地开发：tjtv/{app/data, data, scripts}
//   容器内：  /app/{data, scripts}（TJTV_DATA_DIR 指定）
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolvePaths() {
  const envDir = process.env.TJTV_DATA_DIR;
  if (envDir) {
    return { appData: envDir, workData: envDir };
  }
  const root = path.resolve(__dirname, '..');
  const appData = path.join(root, 'app', 'data');
  if (fs.existsSync(appData)) {
    return { appData, workData: path.join(root, 'data') };
  }
  const local = path.join(__dirname, 'data');
  return { appData: local, workData: local };
}

const { appData: APP_DATA, workData: DATA } = resolvePaths();
const SOURCES_FILE = path.join(APP_DATA, 'tjtv-sources.json');
const STATE_FILE = path.join(DATA, 'probe-state.json');
const POOL_FILE = path.join(DATA, 'source-pool.txt');
const REPORT_FILE = path.join(DATA, 'last-report.md');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

/** 测试关键词，中一个就算通过 */
const TEST_KEYWORDS = ['庆余年', '流浪地球', '哪吒'];

/** 连续失败多少次判定该源已死 */
const FAIL_THRESHOLD = 3;

// ---------------- 工具 ----------------
function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
}

async function fetchJson(url, timeoutMs = 12000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json, */*' },
      signal: ac.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 解析 vod_play_url，返回可播放地址列表。
 * 格式：第1集$http://x/a.m3u8#第2集$http://x/b.m3u8$$$备用线路$...
 */
function parseEpisodes(playUrl) {
  if (!playUrl) return [];
  const first = String(playUrl).split('$$$')[0];
  const out = [];
  for (const ep of first.split('#')) {
    const idx = ep.indexOf('$');
    if (idx < 0) continue;
    const u = ep.slice(idx + 1).trim();
    if (u.startsWith('http://') || u.startsWith('https://')) out.push(u);
  }
  return out;
}

// ---------------- 探活 ----------------
/**
 * 三层校验：
 *   L1 能连上并返回 JSON
 *   L2 能搜到内容
 *   L3 能拿到 m3u8 播放地址（唯一算「可用」的标准）
 */
async function probeOne(name, base) {
  const url = base.replace(/\/+$/, '');
  const r = { name, url, ok: false, level: 0, reason: '', count: 0, eps: 0, ms: 0, apiOk: false };
  const t0 = Date.now();

  let found = null;
  let lastErr = '';

  for (const kw of TEST_KEYWORDS) {
    const api = `${url}?ac=videolist&wd=${encodeURIComponent(kw)}&pg=1`;
    try {
      const data = await fetchJson(api);
      r.apiOk = true;
      const list = data?.list || [];
      if (list.length > 0) {
        found = { kw, list };
        break;
      }
    } catch (e) {
      lastErr = e.name === 'AbortError' ? '请求超时' : (e.message || '请求失败');
    }
  }

  if (!found) {
    r.level = r.apiOk ? 1 : 0;
    r.reason = r.apiOk
      ? `接口正常，但 ${TEST_KEYWORDS.join('/')} 都搜不到结果`
      : (lastErr || '连不上');
    r.ms = Date.now() - t0;
    return r;
  }

  r.count = found.list.length;
  r.level = 2;

  // L3：先看搜索接口本身是否带了播放地址
  for (const item of found.list) {
    const eps = parseEpisodes(item?.vod_play_url);
    if (eps.length > 0) {
      r.ok = true; r.level = 3; r.eps = eps.length;
      r.reason = `命中《${found.kw}》，${eps.length} 集可播`;
      r.ms = Date.now() - t0;
      return r;
    }
  }

  // 再查一次详情接口
  const vid = found.list[0]?.vod_id;
  if (vid) {
    try {
      const detail = await fetchJson(`${url}?ac=videolist&ids=${encodeURIComponent(vid)}`, 15000);
      for (const item of detail?.list || []) {
        const eps = parseEpisodes(item?.vod_play_url);
        if (eps.length > 0) {
          r.ok = true; r.level = 3; r.eps = eps.length;
          r.reason = `详情接口命中，${eps.length} 集可播`;
          r.ms = Date.now() - t0;
          return r;
        }
      }
    } catch { /* 详情失败不影响判定 */ }
  }

  r.reason = '有搜索结果但没有拿到 m3u8 播放地址';
  r.ms = Date.now() - t0;
  return r;
}

// ---------------- 候选池 ----------------
function loadPool() {
  let raw;
  try {
    raw = fs.readFileSync(POOL_FILE, 'utf8');
  } catch {
    console.error(`❌ 找不到候选池：${POOL_FILE}`);
    process.exit(1);
  }
  const items = [];
  for (const line of raw.split('\n')) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const i = s.indexOf('|');
    if (i < 0) continue;
    const n = s.slice(0, i).trim();
    const u = s.slice(i + 1).trim();
    if (n && (u.startsWith('http://') || u.startsWith('https://'))) items.push([n, u]);
  }
  return items;
}

/** 并发池：控制同时在跑的探测数量 */
async function runPool(tasks, limit) {
  const results = new Array(tasks.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= tasks.length) return;
      results[i] = await tasks[i]();
    }
  });
  await Promise.all(workers);
  return results;
}

/** 源质量打分，越小越好 */
function scoreOf(r) {
  const eps = r?.eps ?? 0;
  const epsTier = eps >= 20 ? 0 : eps >= 2 ? 1 : 2;
  const ms = r?.ms ?? 99999;
  const msTier = ms < 8000 ? 0 : 1;
  return [epsTier, msTier, ms];
}

function cmpScore(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

// ---------------- 主流程 ----------------
function parseArgs() {
  const argv = process.argv.slice(2);
  const get = (flag, def) => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
  };
  return {
    dryRun: argv.includes('--dry-run'),
    verbose: argv.includes('--verbose'),
    target: parseInt(get('--target', '15'), 10) || 15,
    minOk: parseInt(get('--min-ok', '3'), 10) || 3,
    workers: parseInt(get('--workers', '12'), 10) || 12,
  };
}

async function main() {
  const args = parseArgs();
  const now = new Date();
  const stamp = now.toISOString().slice(0, 19).replace('T', ' ');

  console.log('='.repeat(64));
  console.log(`  tjtv 源自动巡检   ${stamp}`);
  console.log('='.repeat(64));

  const pool = loadPool();
  console.log(`\n📋 候选池：${pool.length} 个待测源`);
  console.log('🔍 正在并发探活...\n');

  const results = await runPool(
    pool.map(([n, u]) => () => probeOne(n, u).catch((e) => ({
      name: n, url: u, ok: false, level: 0, reason: String(e), count: 0, eps: 0, ms: 0,
    }))),
    args.workers
  );

  const alive = results.filter((r) => r.ok).sort((a, b) => cmpScore(scoreOf(a), scoreOf(b)));
  const dead = results.filter((r) => !r.ok);

  console.log('─'.repeat(64));
  console.log(`✅ 可用源 ${alive.length} 个（能拿到 m3u8 直链）`);
  console.log('─'.repeat(64));
  for (const r of alive) {
    console.log(`  ${r.name.padEnd(9)} ${String(r.ms).padStart(6)}ms ${String(r.eps).padStart(4)}集  ${r.reason}`);
  }

  if (dead.length && args.verbose) {
    console.log(`\n❌ 不可用 ${dead.length} 个`);
    for (const r of dead.slice().sort((a, b) => a.name.localeCompare(b.name, 'zh'))) {
      console.log(`  ${r.name.padEnd(9)} [${r.level}] ${r.reason.slice(0, 50)}`);
    }
  } else if (dead.length) {
    console.log(`\n❌ 不可用 ${dead.length} 个（加 --verbose 看明细）`);
  }

  // ---- 读清单与状态 ----
  const store = readJson(SOURCES_FILE, { version: 1, sources: [] });
  const existing = store.sources || [];
  const state = readJson(STATE_FILE, { failStreak: {}, history: [], retired: [] });
  const failStreak = state.failStreak || {};
  const retired = state.retired || [];

  const aliveByUrl = new Map(alive.map((r) => [r.url, r]));

  // ---- 1) 盘点谁挂了 ----
  const toRemove = [];
  for (const s of existing) {
    const u = s.url.replace(/\/+$/, '');
    if (aliveByUrl.has(u)) {
      failStreak[u] = 0;
      continue;
    }
    failStreak[u] = (failStreak[u] || 0) + 1;
    if (failStreak[u] >= FAIL_THRESHOLD) {
      toRemove.push(s);
      if (!retired.includes(u)) retired.push(u);
    }
  }

  // 安全闸
  let removeList = toRemove;
  if (toRemove.length > 0 && alive.length < args.minOk) {
    console.log(`\n⚠️  只有 ${alive.length} 个活源（低于 ${args.minOk}），本次不执行删除`);
    removeList = [];
  }

  // ---- 2) 保留没挂的 ----
  const removedUrls = new Set(removeList.map((s) => s.url.replace(/\/+$/, '')));
  let kept = existing.filter((s) => !removedUrls.has(s.url.replace(/\/+$/, '')));

  // ---- 3) 补位 ----
  const keptUrls = new Set(kept.map((s) => s.url.replace(/\/+$/, '')));
  const candidates = alive
    .filter((r) => !keptUrls.has(r.url) && !retired.includes(r.url))
    .sort((a, b) => cmpScore(scoreOf(a), scoreOf(b)));

  const toAdd = [];
  for (const r of candidates) {
    if (kept.length >= args.target) break;
    toAdd.push(r);
    kept.push({
      key: `auto_${Date.now()}_${toAdd.length}`,
      name: r.name,
      url: r.url,
      enabled: true,
      builtin: false,
      note: `自动巡检补入 ${stamp.slice(0, 10)}`,
      addedAt: new Date().toISOString(),
    });
  }

  // ---- 4) 汇总 ----
  const tag = (name, url) => `${name}(${url.split('//')[1]?.split('/')[0]?.slice(0, 22) || ''})`;

  console.log('\n' + '─'.repeat(64));
  console.log('  本次变动');
  console.log('─'.repeat(64));
  console.log(`  补入：${toAdd.length} 个` + (toAdd.length ? `  ${toAdd.map((r) => tag(r.name, r.url)).join('; ')}` : ''));
  console.log(`  移除：${removeList.length} 个` + (removeList.length ? `  ${removeList.map((s) => tag(s.name, s.url)).join('; ')}` : ''));
  if (!toAdd.length && !removeList.length) console.log('  → 所有源都在线，无需变动');
  console.log(`  清单：${existing.length} → ${kept.length} 个源`);

  // ---- 5) 写回 ----
  if (args.dryRun) {
    console.log('\n🔸 --dry-run 模式，未修改任何文件');
    return 0;
  }

  store.sources = kept;
  writeJson(SOURCES_FILE, store);

  const finalUrls = new Set(kept.map((s) => s.url.replace(/\/+$/, '')));
  const newFail = {};
  for (const [k, v] of Object.entries(failStreak)) {
    if (v > 0 || finalUrls.has(k)) newFail[k] = v;
  }
  state.failStreak = newFail;
  state.retired = retired.slice(-100);
  state.history = (state.history || []).concat([{
    time: stamp, alive: alive.length, total: results.length,
    added: toAdd.length, removed: removeList.length, final: kept.length,
  }]).slice(-60);
  writeJson(STATE_FILE, state);

  console.log(`\n✅ 已更新 ${SOURCES_FILE}`);
  console.log('   （服务会自动重载，无需重启）');

  // ---- 6) 报告 ----
  const lines = [
    '# tjtv 源巡检报告', '',
    `巡检时间：${stamp}`,
    `候选池：${results.length} 个 ｜ 可用：${alive.length} 个`, '',
    '## 可用源（按资源完整度排序）', '',
    '| 源 | 响应 | 集数 | 说明 |',
    '| --- | --- | --- | --- |',
  ];
  for (const r of alive) lines.push(`| ${r.name} | ${r.ms}ms | ${r.eps} | ${r.reason} |`);
  lines.push('', '## 本次变动', '',
    `- 补入 ${toAdd.length} 个：${toAdd.map((r) => r.name).join('、') || '无'}`,
    `- 移除 ${removeList.length} 个：${removeList.map((s) => s.name).join('、') || '无'}`,
    `- 清单大小：${existing.length} → ${kept.length}`);
  if (dead.length) {
    lines.push('', '## 不可用', '');
    for (const r of dead.slice().sort((a, b) => a.name.localeCompare(b.name, 'zh'))) {
      lines.push(`- ${r.name}：${r.reason.slice(0, 60)}`);
    }
  }
  fs.writeFileSync(REPORT_FILE, lines.join('\n'), 'utf8');
  console.log(`✅ 报告已写入 ${REPORT_FILE}`);
  console.log('');
  return 0;
}

main().then((code) => process.exit(code)).catch((e) => {
  console.error('巡检异常：', e);
  process.exit(1);
});
