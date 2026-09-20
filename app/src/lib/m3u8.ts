/**
 * m3u8 处理：代理路径重写与广告分片过滤
 *
 * 鉴权说明：重构后代理走同源 httpOnly cookie 鉴权，
 * hls.js 拉取重写后的分片时浏览器自动携带 cookie，无需再往 URL 上拼接 token，
 * 从根本上修复旧版「重写分片丢失鉴权参数导致 401」的问题。
 */

export const PROXY_PREFIX = '/api/proxy/';

export function makeAbsolute(url: string, base: string): string {
  try {
    return new URL(url, base).href;
  } catch {
    return url;
  }
}

/** 将 m3u8 中的地址改写为经过本站代理的地址（分片/key/map 同样改写）。
 *  prefix 可指定代理前缀（直播流走 /api/live/stream/，点播默认 /api/proxy/） */
export function rewriteM3u8(
  content: string,
  baseUrl: string,
  depth = 0,
  prefix: string = PROXY_PREFIX
): string {
  if (depth > 5) return content;
  const lines = content.split('\n');
  const out = lines.map((line) => {
    if (line.startsWith('#EXT-X-KEY') || line.startsWith('#EXT-X-MAP')) {
      return line.replace(/(URI=")([^"]+)(")/g, (m, p1: string, uri: string, p2: string) => {
        if (uri.startsWith(prefix)) return m;
        return p1 + prefix + encodeURIComponent(makeAbsolute(uri, baseUrl)) + p2;
      });
    }
    if (line.startsWith('#') || line.trim() === '') return line;
    if (line.startsWith(prefix)) return line;
    return prefix + encodeURIComponent(makeAbsolute(line, baseUrl));
  });
  return out.join('\n');
}

/**
 * 过滤 m3u8 中的广告分片：移除 #EXT-X-DISCONTINUITY 之后紧邻的插入片段。
 * 采集站广告的典型特征是 DISCONTINUITY 包裹的短时片段组，这里保留与旧版一致
 * 的保守策略：直接剔除 DISCONTINUITY 标记本身，避免误伤正常多码流内容。
 */
export function filterAdsFromM3u8(m3u8Content: string): string {
  if (!m3u8Content) return '';
  return m3u8Content
    .split('\n')
    .filter((line) => !line.includes('#EXT-X-DISCONTINUITY'))
    .join('\n');
}
