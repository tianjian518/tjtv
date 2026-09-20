import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';

/**
 * tjtv 源管理接口。
 *
 * 设计目标：内置源开箱可用，新增源不用改代码、不用重新构建。
 * 所有的源都存在 app/data/tjtv-sources.json 里，
 * 通过 /api/tjtv/sources 增删改查，改动立即生效（重启服务后仍然保留）。
 *
 * 与 LibreTV 原生「源管理」的区别：那是浏览器端的，换台设备就没了；
 * 这里是服务端落盘的，所有设备共享同一份源清单。
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 数据目录：容器内固定 /app/data，本地开发用项目根 data */
function resolveDataDir(): string {
  if (process.env.TJTV_DATA_DIR) return process.env.TJTV_DATA_DIR;
  if (fs.existsSync('/app/data')) return '/app/data';
  return path.join(process.cwd(), 'data');
}

const DATA_DIR = resolveDataDir();
const DATA_FILE = path.join(DATA_DIR, 'tjtv-sources.json');
const BUILTIN_FILE = path.join(DATA_DIR, 'builtin-sources.json');

export interface TjtvSource {
  key: string;
  name: string;
  url: string;
  /** 内置源不允许通过接口删除，避免误操作把开箱可用的源清空 */
  builtin?: boolean;
  /** 备注，方便自己标记这个源是干嘛的 */
  note?: string;
  /** 是否启用（停用后不参与搜索） */
  enabled?: boolean;
  /** 记录加入时间 */
  addedAt?: string;
}

interface Store {
  version: number;
  sources: TjtvSource[];
}

/** 内置源清单（随包发布，删了也会自动补回来） */
function builtinSources(): TjtvSource[] {
  try {
    const raw = JSON.parse(fs.readFileSync(BUILTIN_FILE, 'utf8')) as { sources?: TjtvSource[] };
    return (raw.sources || []).map((s) => ({ ...s, builtin: true, enabled: s.enabled !== false }));
  } catch {
    return [];
  }
}

function readStore(): Store {
  try {
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) as Store;
    if (Array.isArray(raw.sources)) return { version: raw.version || 1, sources: raw.sources };
  } catch {
    /* 文件不存在或损坏，走默认 */
  }
  return { version: 1, sources: [] };
}

function writeStore(store: Store): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), 'utf8');
}

/** 合并内置源与用户自建源：内置源始终在前，用户源按加入时间 */
function merged(): TjtvSource[] {
  const store = readStore();
  const builtins = builtinSources();
  const builtinUrls = new Set(builtins.map((b) => b.url.replace(/\/+$/, '')));
  const userSources = store.sources
    .filter((s) => !builtinUrls.has(s.url.replace(/\/+$/, '')))
    .map((s) => ({ ...s, builtin: false }));
  return [...builtins, ...userSources];
}

/** 拉取上游：确认这个源真的能用，避免存进去一堆死链 */
async function validateSource(url: string, keyword = '测试'): Promise<{ ok: boolean; reason?: string; sample?: string }> {
  try {
    const api = `${url.replace(/\/+$/, '')}?ac=videolist&wd=${encodeURIComponent(keyword)}&pg=1`;
    const res = await fetch(api, {
      signal: AbortSignal.timeout(12000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        Accept: 'application/json',
      },
    });
    if (!res.ok) return { ok: false, reason: `上游返回 HTTP ${res.status}` };
    const data = (await res.json()) as { list?: { vod_name?: string; vod_play_url?: string }[] };
    const list = data.list || [];
    if (list.length === 0) return { ok: true, reason: '可以连通（该关键词无结果）' };
    const first = list.find((i) => i.vod_play_url) || list[0];
    return { ok: true, reason: `连通正常`, sample: String(first.vod_name || '') };
  } catch (e) {
    return { ok: false, reason: `连不上：${e instanceof Error ? e.message : '未知错误'}` };
  }
}

/** GET /api/tjtv/sources —— 列出全部源 */
export async function GET() {
  const sources = merged();
  return NextResponse.json({
    count: sources.length,
    enabled: sources.filter((s) => s.enabled !== false).length,
    dataFile: DATA_FILE,
    sources,
  });
}

/** POST /api/tjtv/sources —— 新增源
 *  body: { name, url, note?, skipCheck? }
 */
export async function POST(req: Request) {
  let body: { name?: string; url?: string; note?: string; skipCheck?: boolean };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }

  const name = (body.name || '').trim();
  const url = (body.url || '').trim();

  if (!name) return NextResponse.json({ error: '缺少 name（源名称）' }, { status: 400 });
  if (!/^https?:\/\//i.test(url)) {
    return NextResponse.json({ error: 'url 必须是 http:// 或 https:// 开头' }, { status: 400 });
  }
  try { new URL(url); } catch {
    return NextResponse.json({ error: 'url 格式不合法' }, { status: 400 });
  }

  const normalized = url.replace(/\/+$/, '');
  const existing = merged();
  if (existing.some((s) => s.url.replace(/\/+$/, '') === normalized)) {
    return NextResponse.json({ error: '这个源已经存在了' }, { status: 409 });
  }

  // 默认先探活，确认能用才写入；加 skipCheck:true 可跳过（比如源暂时不可达但想先存着）
  let check: { ok: boolean; reason?: string; sample?: string } = { ok: true };
  if (!body.skipCheck) {
    check = await validateSource(normalized);
    if (!check.ok) {
      return NextResponse.json(
        { error: `源不可用，未添加：${check.reason}`, hint: '如确认要强行加入，请在请求体里加 "skipCheck": true' },
        { status: 400 }
      );
    }
  }

  const store = readStore();
  const key = `user_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const item: TjtvSource = {
    key, name, url: normalized,
    note: body.note, enabled: true,
    builtin: false, addedAt: new Date().toISOString(),
  };
  store.sources.push(item);
  writeStore(store);

  return NextResponse.json({ success: true, added: item, check }, { status: 201 });
}

/** DELETE /api/tjtv/sources —— 删除源
 *  body: { key } 或 { url }
 */
export async function DELETE(req: Request) {
  let body: { key?: string; url?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }

  const store = readStore();
  const before = store.sources.length;

  if (body.key) {
    const hit = merged().find((s) => s.key === body.key);
    if (hit?.builtin) {
      return NextResponse.json(
        { error: '内置源不能删除。如需停用，请用 PATCH 把 enabled 设为 false' },
        { status: 403 }
      );
    }
    store.sources = store.sources.filter((s) => s.key !== body.key);
  } else if (body.url) {
    const n = body.url.replace(/\/+$/, '');
    if (builtinSources().some((b) => b.url.replace(/\/+$/, '') === n)) {
      return NextResponse.json({ error: '内置源不能删除' }, { status: 403 });
    }
    store.sources = store.sources.filter((s) => s.url.replace(/\/+$/, '') !== n);
  } else {
    return NextResponse.json({ error: '请提供 key 或 url' }, { status: 400 });
  }

  if (store.sources.length === before) {
    return NextResponse.json({ error: '没找到这个源' }, { status: 404 });
  }

  writeStore(store);
  return NextResponse.json({ success: true, remaining: store.sources.length });
}

/** PATCH /api/tjtv/sources —— 启用/停用、改名、加备注
 *  body: { key, enabled?, name?, note? }
 */
export async function PATCH(req: Request) {
  let body: { key?: string; enabled?: boolean; name?: string; note?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }

  if (!body.key) return NextResponse.json({ error: '缺少 key' }, { status: 400 });

  const store = readStore();
  const item = store.sources.find((s) => s.key === body.key);
  if (!item) {
    return NextResponse.json(
      { error: '只能修改自建源（内置源固定启用）' },
      { status: 404 }
    );
  }

  if (typeof body.enabled === 'boolean') item.enabled = body.enabled;
  if (typeof body.name === 'string' && body.name.trim()) item.name = body.name.trim();
  if (typeof body.note === 'string') item.note = body.note;

  writeStore(store);
  return NextResponse.json({ success: true, updated: item });
}
