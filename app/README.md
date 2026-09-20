# LibreTV

LibreTV Next.js 迁移版：免费在线视频聚合搜索与观看平台。基于 Next.js 15（App Router）+ TypeScript + Tailwind CSS，播放内核为 ArtPlayer + hls.js，支持亮暗双主题。

> 🌐 **演示站**：[tv.bagiinlink.eu.org](https://tv.bagiinlink.eu.org)（访问密码：`libretv`）
>
> 📖 **完整文档**：[GitHub Wiki](https://github.com/bestZwei/LibreTV-Next/wiki) · [架构](https://github.com/bestZwei/LibreTV-Next/wiki/Architecture) · [部署](https://github.com/bestZwei/LibreTV-Next/wiki/Deployment) · [配置](https://github.com/bestZwei/LibreTV-Next/wiki/Configuration) · [数据源](https://github.com/bestZwei/LibreTV-Next/wiki/Data-Sources) · [首页推荐](https://github.com/bestZwei/LibreTV-Next/wiki/Recommendations) · [播放器](https://github.com/bestZwei/LibreTV-Next/wiki/Player) · [代理与安全](https://github.com/bestZwei/LibreTV-Next/wiki/Proxy-Security) · [FAQ](https://github.com/bestZwei/LibreTV-Next/wiki/FAQ)
>

## 核心特性

- **聚合搜索**：多采集站服务端并行搜索
- **跨源同名聚合**：同名影片合并为一张卡片，展开即可比较和选择各来源
- **HLS 播放**：ArtPlayer + hls.js，广告分片过滤、自动连播、倍速、快捷键、移动端长按 3 倍速
- **直播 / IPTV**：M3U 订阅解析，`/live` 页面按分组浏览、搜索频道并站内播放（HLS + HTTP-FLV），支持 XMLTV 节目单（EPG）与频道收藏；直播流经专用长连接代理（`/api/live/stream`）转发
- **进度同步**：播放进度与观看历史存于本机 IndexedDB，精确到秒的续播
- **换源测速**：跨源搜索同名资源并测速排序，一键切换保留集数位置
- **源测试与订阅**：一键探活点播源与直播源；订阅远程源列表（一份 LibreTV-SourceList JSON 可同时下发点播源与直播源，也可直接填 TVBOX 配置地址，自动导入其中可直接使用的接口），可导出分享
- **首页推荐**：豆瓣（电影/剧集分类浏览）、Bangumi 新番放送表或影视榜单（豆瓣周榜 + 百度热播，经 60s API），设置中切换；均服务端直连 + 缓存，Bangumi/榜单免 key 免配置（`60S_API_BASE` 可指向自部署 60s 实例）
- **PWA**：可安装到桌面 / 主屏幕，亮暗双主题无首屏闪烁

## 部署

### Docker（推荐）

```bash
# 在 .env 中设置 PASSWORD
echo "PASSWORD=your-password" > .env

# 方式一：拉取发布镜像（零构建）
docker compose pull && docker compose up -d

# 方式二：源码构建
docker compose up -d --build
```

### Docker Compose

```yaml
services:
  libretv:
    image: ghcr.io/librespark/libretv:latest
    container_name: libretv
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      - PASSWORD=change-me   # 必填：访问密码，务必修改
      # - PROXY_SECRET=your-secret          # 会话/代理签名密钥，多实例部署建议设置
      # - DEFAULT_SOURCES=[{"name":"示例源","url":"https://example.com/api.php/provide/vod"}]
      # - DEFAULT_LIVE_SOURCES=[{"name":"示例直播源","url":"https://example.com/list.m3u"}]
      # - DEFAULT_SUBSCRIPTIONS=["https://example.com/sources.json"]  # 预置订阅，自动导入点播源+直播源
      # - LIVE_ALLOW_PRIVATE=1              # 自建内网 IPTV 源时开启
```

> 其余可选变量见下方[环境变量](#环境变量)表；仓库内的 `docker-compose.yml` 含完整注释版本（含 `build: .` 源码构建分支）。

```bash
docker compose pull && docker compose up -d
```

> ⚠️ **生产部署必须通过 HTTPS 访问**（localhost 除外）：生产模式下会话 cookie 带 `Secure` 标记，浏览器只在 HTTPS（或 localhost）下保存它。因此用 `http://服务器IP:端口` 访问时，会出现"密码正确却无法登录"的现象——登录请求实际成功，但 cookie 被浏览器丢弃。请通过反向代理（Nginx / Caddy / Traefik）或 Cloudflare 等为站点套上 TLS 后再对外提供服务；本地开发用 `localhost` 不受影响。

镜像发布在 GHCR：`ghcr.io/librespark/libretv`（`latest` / `主.次` / 完整版本号三个 tag，
`linux/amd64` 与 `linux/arm64` 双架构）。需要固定版本时在 `.env` 中设置
`LIBRETV_IMAGE=ghcr.io/librespark/libretv:2.0.1`。

> 版本号以 `package.json` 为单一来源，部署后可用 `/api/status` 返回的 `version` 字段核对。详见[部署文档](https://github.com/bestZwei/LibreTV-Next/wiki/Deployment)。

### 手动运行

```bash
npm install
PASSWORD=your-password npm run build
PASSWORD=your-password npm start   # 监听 8080
```

### 环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `PASSWORD` | 是 | 访问密码；未设置时站点会提示管理员配置 |
| `PROXY_SECRET` | 否 | 会话/代理签名密钥；不设置时从 PASSWORD 派生（多实例部署建议显式设置） |
| `DEFAULT_SOURCES` | 否 | 预置采集站（JSON 数组），用户端自动出现且默认勾选，详见[配置文档](https://github.com/bestZwei/LibreTV-Next/wiki/Configuration) |
| `REQUEST_TIMEOUT` | 否 | 代理上游请求超时（毫秒），默认 8000 |
| `MAX_RETRIES` | 否 | 代理请求重试次数，默认 1 |
| `SEARCH_MAX_PAGES` | 否 | 每个搜索源最多抓取的页数（1-50，默认 5）。第一页会读取源站 `pagecount`，实际页数 = min(源站总页数，该值)；页间并行请求，单页失败只丢该页 |
| `60S_API_BASE` | 否 | 影视榜单推荐源（60s API）实例地址，默认官方公共实例 `https://60s.viki.moe`；有限流，高频使用可[自部署](https://github.com/vikiboss/60s) |
| `DEFAULT_LIVE_SOURCES` | 否 | 预置直播源（M3U 订阅），JSON 数组：`[{"name":"源名","url":"https://.../list.m3u","epg":"https://.../epg.xml.gz"}]`，`epg` 为可选的 XMLTV 节目单地址 |
| `DEFAULT_SUBSCRIPTIONS` | 否 | 预置数据源订阅（LibreTV-SourceList JSON 链接，也接受 TVBOX 配置地址），JSON 数组：`["https://.../sources.json", {"url":"https://.../list.json","name":"名称"}]`。首次访问自动导入点播源与直播源，之后每 24h 静默刷新；用户删除后不再自动加回 |
| `LIVE_ALLOW_PRIVATE` | 否 | 设为 `1` 时允许直播流代理访问内网/保留地址（自建 IPTV 场景），默认关闭以维持 SSRF 防护 |
| `DEBUG` | 否 | 调试日志 |

## 使用说明

1. **添加点播源**：设置 → 源管理 → 点播源 → 添加 API，填入 Apple CMS 采集站地址（如 `https://example.com/api.php/provide/vod`），可选填详情页地址（部分源需要爬详情页提取播放地址）。
2. **搜索**：勾选点播源后输入片名；搜索通过服务端聚合，个别源失败不影响整体结果。
3. **播放**：详情弹窗选择剧集进入 `/watch`；支持快捷键（空格/←→/↑↓/F/Alt+←→）、移动端长按 3 倍速、自动连播、换源测速。
4. **进度与历史**：自动保存在本设备 IndexedDB，仅定位信息入库，播放时自动同步最新剧集。
5. **配置迁移**：设置 → 数据 → 配置导入导出（兼容旧版 LibreTV-Settings JSON 的历史记录迁移）。

## 直播 / IPTV

1. **添加直播源**：设置 → 源管理 → 直播源 → 填入 M3U/M3U8 地址（可选填 XMLTV 节目单地址），添加后自动探活并显示频道数量；也可在「源管理 → 数据源订阅」中与点播源一起订阅导入；部署者还可用 `DEFAULT_LIVE_SOURCES` 环境变量预置。
2. **观看**：进入「直播」页，按分组标签筛选或搜索频道，点击即播；支持 HLS（m3u8）与 HTTP-FLV 两种直播流，直连失败自动走代理通道重试。
3. **节目单**：频道带 `tvg-id` 且订阅配置了 EPG 地址时，展示当前/接下来节目与播放进度。
4. **收藏与导出**：频道可收藏；订阅可一键导出为标准 M3U 文件，供 PotPlayer / VLC 等外部播放器使用。

> ⚠️ 项目不内置任何频道源，也不存储、不制作任何直播内容，仅提供第三方公开播放列表的解析与播放能力，内容的合法性由对应数据源负责。内网自建源默认被 SSRF 防护拦截，自部署者可显式设置 `LIVE_ALLOW_PRIVATE=1` 放行。

## 数据源订阅 / 分享

数据源（点播源 + 直播源）可以 **导出为一份 JSON → 托管到公开 URL → 他人在「设置 → 源管理 → 数据源订阅」里填入该 URL 订阅**。

托管地址没有特殊要求，可用 [npoint.io](https://www.npoint.io/) 免费托管 JSON（粘贴内容即可得到一个公开 URL），Gist、对象存储、任意静态托管同样可用。

### 订阅格式（LibreTV-SourceList JSON）

```json
{
  "name": "我的源列表",
  "version": 2,
  "sources": [
    { "name": "示例点播源", "url": "https://example.com/api.php/provide/vod" }
  ],
  "liveSources": [
    { "name": "示例直播源", "url": "https://example.com/list.m3u", "epg": "https://example.com/epg.xml.gz" }
  ]
}
```

- `sources` 为点播源（Apple CMS 采集站），必填字段只有 `url`；`detail` 为详情页根地址，`isAdult` 为成人内容标记；
- `liveSources` 为直播源（M3U 播放列表），必填字段只有 `url`；`epg` 为可选的 XMLTV 节目单地址；
- 只写 `sources` 的老订阅照常可用（纯点播），只写 `liveSources` 则是纯直播订阅；裸数组 `[{ "name": "...", "url": "..." }]` 视为点播源；
- 按 `url` 去重，点播源最多 100 个、直播源最多 50 个；非 http(s) 地址会被过滤，点播源另需为公网地址（直播源可用 `LIVE_ALLOW_PRIVATE=1` 放行内网自建源）。

### 兼容 TVBOX 配置

订阅地址也可以直接填 **TVBOX 配置**（形如 `{"sites": [...], "lives": [...], "parses": [...]}`）：服务端按内容结构自动识别格式，无需手动选择。

- **点播源**：导入 `sites` 中 `type: 1` 的 JSON 接口（即 Apple CMS 采集站）；部分共享配置省略 `type` 或写成 `0`，但地址命中 `api.php/provide/vod` 时同样导入；站点自身标记 `searchable: 0`（不可搜索）时跳过；
- **直播源**：导入 `lives` 中 `type: 0`（或省略）的 M3U 播放列表，`epg` 字段一并带上；txt 频道列表与单仓 JSON 不支持；
- **Spider 类站点会跳过**：`type: 3` 的 Spider（`csp_*` / `.jar` / `.js` / `.py`）需要 TVBOX 自身的 Spider 引擎才能运行，Node 侧无法执行；XML 接口、外链 JSON 同理。被跳过的条目不影响其余导入，导入结果会如实提示，如「已同步 8 个点播源、2 个直播源（TVBOX 配置）；跳过 96 个不可用条目（Spider 引擎 92、XML 接口 4）」；
- TVBOX 配置常含上百条站点且以 Spider 为主，**只导入个位数到十几个属正常现象**；
- **格式容错**：配置里的 `//` 注释、尾随逗号、字符串内未转义的换行会自动修正后再解析（共享配置中很常见，TVBOX 客户端用的 fastjson 同样容忍这些写法）；
- 其他限制：订阅地址需直接返回 JSON（Base64 / 压缩包装的分享链接不支持）；TVBOX「多仓」配置（顶层为 `urls` 数组）不支持，请填单仓配置；地址公网校验、去重与数量上限与上方格式完全一致。

### 订阅行为

- **订阅**：设置 → 源管理 → 数据源订阅 → 填入订阅地址 → 「订阅」，导入的点播源自动勾选、直播源自动启用，均带「订阅」标识，条目上显示「点播 N · 直播 M」；
- **同步**：订阅条目上的 **⟳** 手动强制同步，整体替换该订阅名下的点播源与直播源；
- **管理边界**：订阅源以远端列表为准，单独编辑会在下次同步时被覆盖，单独移除会在重新同步时恢复；如需调整请改远端列表，或直接删除整个订阅。删除订阅时点播源全部移除；直播源为**多归属共享**——同一 M3U 可被多个订阅引用（名称/EPG 以首次导入为准），删除只移除自己的引用，仅当不再被任何订阅引用时才移除该源，**收藏的频道始终保留**；
- **导出分享**：设置 → 源管理 → 数据源订阅 → 「导出数据源」，把当前全部点播源与直播源（预置 + 手动 + 订阅，按 URL 去重）导出为上述 JSON。

> 订阅由服务端拉取（经过 SSRF 校验），因此订阅地址无需配置 CORS。完整说明见 [数据源文档](https://github.com/bestZwei/LibreTV-Next/wiki/Data-Sources)。

## 开发

```bash
npm install
PASSWORD=dev-password npm run dev   # http://localhost:8080
npm test                            # 核心库单元测试（cms-parser / m3u8 / ssrf）
npm run typecheck
```

## 发布新版本

版本号以 `package.json` 为单一来源，发布镜像由 GitHub Actions 自动完成：

```bash
npm version patch       # 或 minor / major；会更新 package.json 并打 git tag
git push && git push --tags
```

CI 校验通过后自动构建并推送 `ghcr.io/librespark/libretv:<版本>`（详见[部署文档](https://github.com/bestZwei/LibreTV-Next/wiki/Deployment)）。

## 安全说明

- 密码只保存在服务端环境变量中，前端不持有任何可重放凭证。
- 登录接口有 IP 速率限制（10 次 / 10 分钟）。
- 代理内置 SSRF 防护：拒绝内网/保留地址（含 DNS 解析后校验），仅放行 http(s)。
- 未登录会话仅允许代理图片类目标（豆瓣封面防盗链需要）。

## 衍生作品

| 项目 | 说明 |
| --- | --- |
| [OrionTV](https://github.com/orion-lib/OrionTV) | Apple TV / Android TV 客户端（React Native TVOS + Expo），配合 MoonTV 使用 |
| [LunaTV](https://github.com/MoonTechLab/LunaTV) | 影视聚合站（Next.js），支持 Redis / Upstash 等多存储后端 |
| [Selene-TV](https://github.com/MoonTechLab/Selene-TV) | Android TV（Leanback）客户端，Kotlin + Compose，对接 MoonTV / Helios |
| [EchoTV](https://github.com/hoowhoami/EchoTV) | Flutter 全平台客户端（已归档） |
| [WarHutTV](https://github.com/OuOumm/WarHutTV) | Go + React 的自托管影视聚合站 |
| [DecoTV](https://github.com/Decohererk/DecoTV) | 聚合播放站（原 KatelyaTV） |
| [Joyflix](https://github.com/jeffernn/Joyflix-Mac-Objective-C) | macOS 原生影视聚合客户端（Objective-C） |
| [MoonCakeTV](https://github.com/MoonCakeTV/MoonCakeTV) | 影视聚合搜索站（Next.js），文件存储、一键脚本部署 |
| [OrangeTV](https://github.com/djteang/OrangeTV) | 跨平台影视聚合播放器（Next.js），Kvrocks/Redis/Upstash 多存储与多端同步 |

> 旧版 LibreTV（静态 HTML + Express）完整代码见 [backup-2025 分支](https://github.com/LibreSpark/LibreTV/tree/backup-2025)。

## 免责声明

本项目不存储、不制作任何视频内容，仅提供第三方公开接口的聚合与播放能力，内容的合法性由对应数据源负责。

☕ 觉得有用的话，可以到 [AFDIAN](https://afdian.com/a/veehub) 请我喝杯咖啡。