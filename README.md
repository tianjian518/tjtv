# tjtv

影视聚合搜索与观看平台。**内置 15 个实测可用的源，开箱即用**；自带源自动巡检，挂了会自动补新的；同时提供源管理接口，随时增删源，不用改代码。

> 基于 [LibreTV](https://github.com/LibreSpark/LibreTV)（AGPL-3.0）二次开发。
> 改动内容：内置 15 个可用源、容器内置源自动巡检、服务端源管理接口与图形管理页、端口改 8021、多架构镜像。

**仓库**：https://github.com/tianjian518/tjtv
**镜像**：`tianjian518/tjtv`（Docker Hub） / `ghcr.io/tianjian518/tjtv`（GHCR）

---

## 飞牛上三步跑起来

```bash
# 1) 建目录
mkdir -p /vol1/1000/docker/tjtv

# 2) 用 Docker 面板新建容器，镜像填：
tianjian518/tjtv:latest

# 3) 关键配置
端口映射：8021 → 8021
目录挂载：/vol1/1000/docker/tjtv → /app/data    ← 必须挂
环境变量：PASSWORD=你的密码
```

然后访问 `http://飞牛IP:8021`。

---

## 快速开始

```bash
bash start.sh
```

首次运行会自动装依赖并构建（约 1-2 分钟），然后：

| 地址 | 用途 |
| --- | --- |
| `http://localhost:8021` | 搜索、观看 |
| `http://localhost:8021/tjtv` | **源管理页**（加源、删源、停用源） |

默认密码 `tjtv`。改密码：

```bash
PASSWORD=你的密码 bash start.sh
```

换端口（默认 8021，避开常被占用的 8080）：

```bash
PORT=8050 bash start.sh
```

重新构建：

```bash
bash start.sh --rebuild
```

---

## 端口说明

默认 **8021**。已确认 8021 / 8022 / 8050 / 8051 / 8300 / 9099 都没被系统占用，随便挑。

改端口三种方式：
1. 启动时带环境变量：`PORT=8050 bash start.sh`
2. 改 `app/package.json` 里的 `-p 8021`
3. Docker 部署改 `app/docker-compose.yml` 的端口映射

---

## 源管理

### 方式一：网页（推荐）

打开 `http://localhost:8021/tjtv`，可以：
- 看当前所有源，内置源带「内置」标签
- 加新源：填名称 + 接口地址，**会自动探活**，连不上直接拦下
- 删源、停用/启用自建源
- 内置源不能删（防手滑），但可以停用

### 方式二：接口（给脚本用）

> 接口沿用主服务的登录会话，需要先登录拿到 cookie，再带着 cookie 调。

```bash
# 1) 先登录，把会话 cookie 存下来
curl -c /tmp/tjtv.cookie -X POST http://localhost:8021/api/auth \
  -H "Content-Type: application/json" -d '{"password":"你的密码"}'

# 2) 查看全部源
curl -b /tmp/tjtv.cookie http://localhost:8021/api/tjtv/sources

# 3) 新增源（默认会先探活，连不上直接拦下）
curl -b /tmp/tjtv.cookie -X POST http://localhost:8021/api/tjtv/sources \
  -H "Content-Type: application/json" \
  -d '{"name":"某某源","url":"https://example.com/api.php/provide/vod"}'

# 源暂时连不上，但要强行存着
curl -b /tmp/tjtv.cookie -X POST http://localhost:8021/api/tjtv/sources \
  -H "Content-Type: application/json" \
  -d '{"name":"某某源","url":"https://example.com/api.php/provide/vod","skipCheck":true}'

# 删除源
curl -b /tmp/tjtv.cookie -X DELETE http://localhost:8021/api/tjtv/sources \
  -H "Content-Type: application/json" -d '{"key":"auto_xxxxx"}'

# 停用 / 启用
curl -b /tmp/tjtv.cookie -X PATCH http://localhost:8021/api/tjtv/sources \
  -H "Content-Type: application/json" -d '{"key":"auto_xxxxx","enabled":false}'

# 改完文件后手动触发热重载（巡检脚本就是这么做的）
curl -b /tmp/tjtv.cookie -X POST http://localhost:8021/api/tjtv/reload
```

### 源存在哪

| 文件 | 内容 |
| --- | --- |
| `app/data/builtin-sources.json` | 内置源，随项目发布，可手工编辑 |
| `app/data/tjtv-sources.json` | 你加的源，接口自动维护 |

都是纯 JSON，可以直接用编辑器改，改完重启服务生效。**这两个文件是持久的**，换设备、换浏览器共享同一份（跟网页里那个存在浏览器里的源管理不一样）。

---

## 内置源（15 个）

开箱自带 15 个源，都是实测**能搜到内容且能拿到 m3u8 直链**的：

金鹰、天堂、360资源、红牛、虎牙、火狐、光速、量子、非凡、暴风、魔都、极速、速播、百度、新浪

实测 15 源并行搜索「流浪地球」→ **15 源全部成功，聚合 71 条结果**。

---

## 源自动巡检（容器内置，全自动）

**巡检跑在容器里面，不依赖 GitHub、不需要你额外开机器。**

飞牛 OS 24 小时开机 → 容器常驻 → 巡检常驻。

### 工作流程

```
容器启动
  ├── 后台：巡检守护进程
  │     每 24 小时跑一次 auto-update.mjs
  │       ├─ 测清单里已有的源，谁挂了？
  │       ├─ 连续 3 次探不活的 → 删除
  │       ├─ 删几个就补几个，补到 15 个
  │       └─ 通知主服务重载（不用重启容器）
  └── 前台：tjtv 主服务（8021）
```

**核心：没源挂掉就什么都不做。** 清单不会因为网络波动而胡乱变动。

### 可选环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `AUTO_UPDATE` | 1 | `1`=开启巡检，`0`=关闭 |
| `AUTO_UPDATE_CRON` | 86400 | 间隔秒数。43200=12小时，604800=每周 |
| `AUTO_UPDATE_TARGET` | 15 | 保持多少个可用源 |
| `AUTO_UPDATE_DELAY` | 60 | 容器启动后多少秒跑首次巡检 |
| `SEARCH_SOURCE_TIMEOUT_MS` | 6000 | 单个源搜索死线。见下方「性能调优」 |
| `DETAIL_TIMEOUT_MS` | 15000 | 上游详情请求超时。见下方「性能调优」 |

### 为什么连续 3 次才删

源偶尔抽风很正常（网络抖动、临时维护）。只失败一次就删会误杀好源。
连续 3 次都探不活才判定真挂了——按每天一次算，相当于给源 3 天观察期。

### 查看巡检情况

```bash
# 实时日志
docker exec tjtv tail -f /app/data/auto-update.log

# 最近一次报告
docker exec tjtv cat /app/data/last-report.md

# 手动立刻跑一次（不等 24 小时）
docker exec tjtv node /app/scripts/auto-update.mjs --target 15
```

### 不用 Docker 时（本地直接跑）

```bash
node scripts/auto-update.mjs              # 巡检并更新
node scripts/auto-update.mjs --dry-run    # 只报告不改文件
node scripts/auto-update.mjs --target 20  # 保持 20 个源
node scripts/auto-update.mjs --verbose    # 打印失败明细
```

挂 cron（仅限本地部署，Docker 部署不需要）：

```bash
bash scripts/install-cron.sh
```

### 同步到内置清单

想把当前巡检结果固化成"开箱自带"：

```bash
python3 scripts/sync_builtin.py
```

（这个只在开发时用一次，运行时不需要。）

---

## 播放性能调优

采集源普遍是"能看但慢"：带宽常常只有 1~2 Mbps，响应时间在 1.7s ~ 5.6s 之间剧烈波动。
项目针对这个现实做了三处优化。

### 1. 搜索：单源 6s 死线

搜索是 15 个源并发跑，整体耗时取决于**最慢的那个**。原设定 10s，会被一两个慢源拖到十几秒。

现在到 6s 直接掐掉在途请求、标记超时，其余源的结果照常返回。

**实测**（15 源，关键词「狂飙」）：

| 指标 | 数值 |
| --- | --- |
| 整体耗时 | 6.0s（改前最慢 10.04s） |
| 返回结果 | 624 条 |
| 被掐的源 | 2 个（本来就是超时源，无有效结果） |

也就是说**砍掉的时间全是白等的，结果总数一条没少**。

嫌不够快可以再压：

```yaml
environment:
  - SEARCH_SOURCE_TIMEOUT_MS=4000   # 更激进，结果可能略减
```

### 2. 起播：从最低清晰度开播

这是"点了半天没反应"的根因。播放器默认挑最高清晰度，1080p 首屏要先下完一大段高清分片——
源站只有 1.7 Mbps，这段等待轻松超过 10 秒。

现在改成**先钉在最低档出画面**，播起来后由 ABR（自适应码率）按实测带宽自动升档：网好升清，网差守低清。

> ⚠️ `player-shell.tsx` 里的 `maxBufferLength` 保持 **30**，不要改小。
> 实测压到 6s 会让 hls.js 卡在起播阶段反而出不来画面——起播快靠的是 `startLevel: 0`，不是这个值。

### 3. 详情：15s 超时

详情要串行跑两段（列表接口 → 详情页 HTML），源站响应波动大，10s 经常不够。
提到 15s 后**实测 8/8 全部成功**，平均 888ms。

慢源可以再放宽：

```yaml
environment:
  - DETAIL_TIMEOUT_MS=20000
```

### 瓶颈到底在哪

如果你觉得卡，**大概率不是项目的问题**。实测数据：

| 环节 | 耗时 |
| --- | --- |
| 本地首页 | 0.21s |
| 状态接口 | 0.19s |
| 搜索 15 源 | 3.3s 平均 |
| 详情接口 | 0.89s 平均 |
| **源站分片下载** | **1.7 Mbps（639KB 花了 3.03s）** |

源站只有 1.7 Mbps，而 1080p 需要 5~8 Mbps。**带宽瓶颈在上游**，本地任何配置都绕不过去。
这也是为什么起播要从低清开始——低清档几百 KB 就能开播。

---

## 维护候选池

`data/source-pool.txt` 是候选源池，每行 `名称|接口地址`，带 `#` 的行会被忽略。

想加新源直接往里面追加。池子越大，替补的选择余地越大。

体检某个源到底行不行：

```bash
python3 scripts/probe.py -f 你的清单.txt
```

---

## Docker 部署

### 方式一：用预构建镜像（推荐，飞牛上直接拉）

```bash
cd /vol1/1000/docker   # 换成你自己的目录
# 把仓库里的 docker-compose.yml 拷过来，改掉 PASSWORD 和镜像名
docker compose up -d
```

### 方式二：本地源码构建

```bash
docker build -t tjtv:local .
docker run -d --name tjtv -p 8021:8021 \
  -e PASSWORD=你的密码 \
  -v /vol1/1000/docker/tjtv:/app/data \
  --restart unless-stopped \
  tjtv:local
```

访问 `http://服务器IP:8021`。

**数据持久化**（自建的源、巡检记录不会丢）——必须挂 `/app/data`：

```yaml
volumes:
  - /vol1/1000/docker/tjtv:/app/data
```

⚠️ **公网部署必须套 HTTPS**，否则会出现「密码正确却登不进去」——生产模式 cookie 带 `Secure` 标记，`http://` 下浏览器会丢弃。用 Nginx / Caddy / Cloudflare 套一层 TLS。

### 镜像地址

| 仓库 | 地址 | 说明 |
| --- | --- | --- |
| Docker Hub | `tianjian518/tjtv` | 拉取：`docker pull tianjian518/tjtv:latest` |
| GHCR | `ghcr.io/tianjian518/tjtv` | 拉取：`docker pull ghcr.io/tianjian518/tjtv:latest` |

两个都支持 `linux/amd64` 和 `linux/arm64`（飞牛常见的是 x86_64，老设备可能是 arm64，都覆盖了）。

推版本 tag 自动构建发布：

```bash
git tag v1.0.0 && git push origin v1.0.0
```

---

## 目录结构

```
tjtv/
├── Dockerfile                    镜像构建（顶层）
├── docker-entrypoint.sh          容器入口（修权限 → 起巡检守护 → 起主服务）
├── docker-compose.yml            飞牛 / NAS 部署配置
├── start.sh                      本地一键启动（不装 Docker 时用）
├── .github/workflows/
│   └── docker-publish.yml        打 tag 自动双推 Docker Hub + GHCR
├── app/                          应用层（LibreTV 二次开发的 Next.js 工程）
│   ├── data/
│   │   ├── builtin-sources.json  内置源清单（15 个，开箱可用）
│   │   └── tjtv-sources.json     运行时清单（巡检与接口维护）
│   └── src/
│       ├── app/api/tjtv/sources/ 源管理接口
│       ├── app/api/tjtv/reload/  重载接口（巡检改完文件后调用）
│       ├── app/tjtv/             源管理页面
│       └── lib/env-sources.ts    源加载逻辑（内置 + 自建 + 环境变量）
├── data/
│   ├── source-pool.txt           候选源池（42 个待测地址）
│   ├── probe-state.json          巡检状态（失败计数、淘汰名单）
│   └── last-report.md            最近一次巡检报告
├── scripts/
│   ├── auto-update.mjs           源自动巡检（Node 版，容器内跑这个）
│   ├── auto_update.py            同上，Python 版（本地可选）
│   ├── sync_builtin.py           把巡检结果同步为内置源
│   ├── probe.py                  源体检工具
│   └── install-cron.sh           本地部署时装定时任务
└── docs/
    ├── 源获取指南.md             怎么自己找源
    └── 飞牛OS部署指南.md          飞牛上怎么部署
```

### 两个层面的关系

```
根目录（部署层）                    app/（应用层）
├─ Dockerfile  ──────────┐
├─ 巡检脚本              ├──> 构建镜像 ──> 容器
├─ 候选源池              │                ├─ 前台：主服务 :8021
└─ 编排 / 文档 ──────────┘                └─ 后台：巡检守护
```

---

## 免责声明

本项目不存储、不制作、不内置任何视频内容，仅提供第三方公开接口的聚合与播放能力。内置的源清单是公开可访问的第三方采集站地址，内容的合法性由对应数据源负责。

请遵守当地法律法规，仅供个人学习与技术研究使用，勿用于商业用途或公开传播。
