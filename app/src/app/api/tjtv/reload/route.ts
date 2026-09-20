import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 源清单重载接口。
 *
 * 巡检脚本改完 app/data/tjtv-sources.json 后调用它，
 * 服务会立即重新读取源清单，不必重启容器。
 *
 * 实现说明：Next.js 的 route 是模块级缓存的，但 getEnvSources() 每次请求
 * 都会重新读文件——所以「重载」实际只需要让调用方知道文件已生效，
 * 这里额外做一次读校验，并把当前源数量回传，方便巡检脚本确认结果。
 *
 * 用法：
 *   curl -X POST http://localhost:8021/api/tjtv/reload
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function resolveDataDir(): string {
  if (process.env.TJTV_DATA_DIR) return process.env.TJTV_DATA_DIR;
  if (fs.existsSync('/app/data')) return '/app/data';
  return path.join(process.cwd(), 'data');
}

export async function POST() {
  const dir = resolveDataDir();
  const runtimeFile = path.join(dir, 'tjtv-sources.json');
  const builtinFile = path.join(dir, 'builtin-sources.json');

  const result: Record<string, unknown> = {
    reloadedAt: new Date().toISOString(),
    dataDir: dir,
  };

  let total = 0;
  for (const [label, file] of [['builtin', builtinFile], ['runtime', runtimeFile]] as const) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { sources?: unknown[] };
      const n = Array.isArray(raw.sources) ? raw.sources.length : 0;
      result[label] = { file, count: n, ok: true };
      total += n;
    } catch (e) {
      result[label] = {
        file,
        ok: false,
        error: e instanceof Error ? e.message : '读取失败',
      };
    }
  }

  result.totalCount = total;
  result.success = true;

  return NextResponse.json(result);
}

/** GET 也支持，方便浏览器直接点开看状态 */
export async function GET() {
  return POST();
}
