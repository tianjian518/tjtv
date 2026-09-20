import fs from 'node:fs';
import path from 'node:path';
import type { SourceConfig } from './types';

/**
 * tjtv 内置源 + 用户自建源。
 *
 * 加载顺序（后者覆盖前者，按 url 去重）：
 *   1. data/builtin-sources.json —— 随包发布的内置源，开箱可用
 *   2. data/tjtv-sources.json    —— 通过 /api/tjtv/sources 或管理页添加的源
 *   3. DEFAULT_SOURCES 环境变量   —— 部署时可选的额外预置
 *
 * 内置清单删掉不影响运行，只是没有预置源而已。
 */

interface RawItem {
  name?: unknown;
  url?: unknown;
  detail?: unknown;
  isAdult?: unknown;
  key?: unknown;
  enabled?: unknown;
  builtin?: unknown;
}

interface SrcFile {
  sources?: RawItem[];
}

/**
 * 代码内置的保底源。
 *
 * 作用：builtin-sources.json 万一丢失（挂载卷被清空、被误删），
 * 服务也不会变成"一个源都没有"。这份清单是最后一道兜底。
 */
const FALLBACK_SOURCES: { name: string; url: string }[] = [
  { name: '天堂', url: 'http://caiji.dyttzyapi.com/api.php/provide/vod' },
  { name: '非凡', url: 'http://api.ffzyapi.com/api.php/provide/vod' },
  { name: '火狐', url: 'http://hhzyapi.com/api.php/provide/vod' },
  { name: '360资源', url: 'http://360zyzz.com/api.php/provide/vod' },
  { name: '红牛', url: 'http://www.hongniuzy2.com/api.php/provide/vod' },
  { name: '量子', url: 'http://cj.lziapi.com/api.php/provide/vod' },
  { name: '虎牙', url: 'http://www.huyaapi.com/api.php/provide/vod' },
  { name: '暴风', url: 'http://bfzyapi.com/api.php/provide/vod' },
  { name: '金鹰', url: 'http://jyzyapi.com/api.php/provide/vod' },
  { name: '百度', url: 'http://api.apibdzy.com/api.php/provide/vod' },
  { name: '爱奇艺', url: 'http://www.iqiyizyapi.com/api.php/provide/vod' },
  { name: '新浪', url: 'http://api.xinlangapi.com/api.php/provide/vod' },
  { name: '速播', url: 'http://subocaiji.com/api.php/provide/vod' },
  { name: '光速', url: 'http://api.guangsuapi.com/api.php/provide/vod' },
  { name: '极速', url: 'http://jszyapi.com/api.php/provide/vod' },
];

/** 数据目录：容器内固定 /app/data，本地开发用项目根 data */
function dataDir(): string {
  if (process.env.TJTV_DATA_DIR) return process.env.TJTV_DATA_DIR;
  if (fs.existsSync('/app/data')) return '/app/data';
  return path.join(process.cwd(), 'data');
}

function readJsonFile<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

/** 清洗一条源配置，非法则返回 null */
function normalize(item: RawItem, keyFallback: string, builtin: boolean): SourceConfig | null {
  const name = typeof item.name === 'string' ? item.name.trim() : '';
  const url = typeof item.url === 'string' ? item.url.trim() : '';
  if (!name || !/^https?:\/\//i.test(url)) return null;
  const key = typeof item.key === 'string' && item.key.trim() ? item.key.trim() : keyFallback;
  return {
    key: builtin ? key : `user_${keyFallback}`,
    name,
    url: url.replace(/\/+$/, ''),
    detail: typeof item.detail === 'string' && item.detail.trim() ? item.detail.trim() : undefined,
    isAdult: item.isAdult === true,
  };
}

/** 读内置源清单；文件缺失时退回代码内置的保底源 */
function builtinList(): SourceConfig[] {
  const raw = readJsonFile<SrcFile>(path.join(dataDir(), 'builtin-sources.json'));
  if (!raw?.sources || !Array.isArray(raw.sources) || raw.sources.length === 0) {
    return FALLBACK_SOURCES.map((it, i) => normalize(it, `builtin_${i}`, true)).filter(
      (x): x is SourceConfig => x !== null,
    );
  }
  return raw.sources
    .map((it, i) => normalize(it, `builtin_${i}`, true))
    .filter((x): x is SourceConfig => x !== null);
}

/** 读用户自建源（只取启用的） */
function userList(): SourceConfig[] {
  const raw = readJsonFile<SrcFile>(path.join(dataDir(), 'tjtv-sources.json'));
  if (!raw?.sources) return [];
  return raw.sources
    .filter((it) => it.enabled !== false)
    .map((it, i) => normalize(it, `${i}_${Date.now().toString(36)}`, false))
    .filter((x): x is SourceConfig => x !== null);
}

/** 环境变量预置源 */
function envList(): SourceConfig[] {
  const raw = process.env.DEFAULT_SOURCES;
  if (!raw || !raw.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('必须是 JSON 数组');
    return (parsed as RawItem[])
      .map((item, i) => normalize(item, `env_${i}`, false))
      .filter((x): x is SourceConfig => x !== null);
  } catch (err) {
    console.warn('[tjtv] DEFAULT_SOURCES 解析失败，已忽略：', err instanceof Error ? err.message : err);
    return [];
  }
}

/**
 * 汇总所有源的入口：内置 → 用户 → 环境变量，按 url 去重。
 * /api/status 调用它把源下发给前端，前端首次访问自动勾选。
 */
export function getEnvSources(): SourceConfig[] {
  const all = [...builtinList(), ...userList(), ...envList()];
  const seen = new Set<string>();
  const out: SourceConfig[] = [];
  for (const s of all) {
    const k = s.url.replace(/\/+$/, '');
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

/** 仅供源管理接口使用：区分内置与自建 */
export function getBuiltinSources(): SourceConfig[] {
  return builtinList();
}
