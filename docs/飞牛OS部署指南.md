# 飞牛 OS 部署指南

面向：在飞牛 OS（fnOS）上跑 tjtv，容器 7×24 常驻，源自动巡检。

---

## 一、架构说明

```
飞牛 OS
  └── Docker 容器 tjtv
        ├── 主服务（8021 端口）—— 你访问的网页
        └── 巡检守护进程 —— 每天自动测源，挂一个补一个
              ↓
        数据目录（挂载到飞牛本地）
        /vol1/1000/docker/tjtv/
          ├── tjtv-sources.json    运行时源清单
          ├── builtin-sources.json 内置源清单
          ├── source-pool.txt      候选源池
          ├── auto-update.log      巡检日志
          └── last-report.md       最近巡检报告
```

**关键点：巡检跑在容器内部，不依赖 GitHub，不需要你开机跑脚本。** 飞牛常驻 → 巡检常驻。

---

## 二、准备工作

### 1. 在飞牛上建数据目录

用飞牛的「文件管理」或 SSH 建目录：

```bash
mkdir -p /vol1/1000/docker/tjtv
```

> 路径按你的实际情况改。飞牛一般存储池是 `/vol1`，用户目录是 `/vol1/1000/`。

### 2. 拿到镜像

三选一：

**方式 A：Docker Hub（最省事）**

```bash
docker pull tianjian518/tjtv:latest
```

**方式 B：GHCR（Docker Hub 拉不动时用）**

```bash
docker pull ghcr.io/tianjian518/tjtv:latest
```

**方式 C：本地构建**

把项目传到飞牛，进目录：

```bash
docker build -t tjtv:latest .
```

---

## 三、飞牛 Docker 面板部署

### 步骤 1：打开 Docker 应用

飞牛桌面 → **Docker** → **Compose** → **新增项目**

### 步骤 2：填项目信息

| 项 | 填什么 |
| --- | --- |
| 项目名称 | `tjtv` |
| 路径 | 选个放 compose 文件的地方，如 `/vol1/1000/docker/tjtv-app` |

### 步骤 3：粘贴 Compose 配置

把项目里的 `docker-compose.yml` 内容粘进去，**改这几处**：

```yaml
services:
  tjtv:
    image: tianjian518/tjtv:latest

    container_name: tjtv
    restart: unless-stopped            # 容器自启，飞牛重启后自动拉起

    ports:
      - "8021:8021"                    # 左边可改，比如 "9000:8021"

    environment:
      - PASSWORD=你的密码               # ← 必须改！

      - AUTO_UPDATE=1                  # 自动巡检开关
      - AUTO_UPDATE_CRON=86400         # 每天一次
      - AUTO_UPDATE_TARGET=15          # 保持 15 个可用源

    volumes:
      - /vol1/1000/docker/tjtv:/app/data   # ← 改成你的数据目录
```

> **注意 volumes 这行**：`:` 左边是你的飞牛本地路径，右边固定 `/app/data` 不要改。
> 写成绝对路径最稳（别用 `./data`，飞牛面板里相对路径容易搞混）。

### 步骤 4：启动

点「构建并启动」，等状态变成 **running**。

看日志确认巡检已启动：

```
==========================================
  tjtv 容器启动
==========================================
  服务端口：8021
  数据目录：/app/data
  自动巡检：开启
    周期：每 86400 秒
    目标源数量：15
    日志：/app/data/auto-update.log
  巡检进程已启动（PID 42）
==========================================
  启动主服务...
```

### 步骤 5：访问

浏览器打开：`http://飞牛IP:8021`

密码是你设的 `PASSWORD`。

---

## 四、验证自动巡检

### 看巡检日志

飞牛上执行：

```bash
tail -f /vol1/1000/docker/tjtv/auto-update.log
```

或者从宿主机看：

```bash
docker exec tjtv tail -f /app/data/auto-update.log
```

### 手动触发一次（不想等 24 小时）

```bash
docker exec tjtv python3 /app/scripts/auto_update.py --target 15
```

### 看巡检报告

```bash
docker exec tjtv cat /app/data/last-report.md
```

### 看源清单

```bash
docker exec tjtv cat /app/data/tjtv-sources.json
```

---

## 五、巡检相关配置

| 环境变量 | 默认 | 说明 |
| --- | --- | --- |
| `AUTO_UPDATE` | 1 | `1`=开启，`0`=关闭 |
| `AUTO_UPDATE_CRON` | 86400 | 间隔秒数。`43200`=12小时，`604800`=每周 |
| `AUTO_UPDATE_TARGET` | 15 | 保持多少个可用源 |

改完在飞牛面板点「重启」生效。

**想每天固定某个时刻跑**（比如凌晨 4 点）：

`AUTO_UPDATE_CRON` 改成 `86400`，然后在 `docker-entrypoint.sh` 里把那句
`sleep 60` 改成按时间计算。默认的「启动后 60 秒首跑 + 每 24 小时一次」对常驻容器已经够用。

---

## 六、常见问题

### Q：源清单挂载后提示不可写？

飞牛的目录权限可能限制了容器用户。SSH 上去执行：

```bash
chmod -R 777 /vol1/1000/docker/tjtv
```

或者查容器内用户 UID：

```bash
docker exec tjtv id
```

按显示的 UID 给宿主机目录授权。

### Q：巡检日志里全是失败？

正常。候选池里有相当一部分源是死的，巡检的价值就是**从死源里筛出活的**。
只要报告里「可用源」不是 0，就没问题。

### Q：想清理巡检历史？

```bash
docker exec tjtv rm /app/data/probe-state.json
```

删掉后下次巡检会重新统计失败次数（现有源会被重新观察 3 轮）。

### Q：容器重建后源会丢吗？

**只要 volumes 挂载了就不会。** 源清单在宿主机上，容器怎么删都不影响。
这也是必须挂载的原因——不挂载的话数据在容器内，重建就没了。

### Q：怎么换端口？

改 compose 里 `ports` 的左边：

```yaml
ports:
  - "9000:8021"     # 飞牛上用 9000 访问
```

右边 `8021` 不要改（那是容器内服务端口）。

### Q：怎么更新到新版本镜像？

```bash
docker compose pull
docker compose up -d
```

源清单在挂载目录里，不会丢。

---

## 七、目录结构对照

飞牛上的实际目录：

```
/vol1/1000/docker/tjtv/          ← 挂载到容器的 /app/data
├── tjtv-sources.json            运行时源清单（巡检和接口维护）
├── builtin-sources.json         内置源清单
├── source-pool.txt              候选源池，想加源直接编辑这个
├── probe-state.json             巡检状态（失败计数、淘汰名单）
├── auto-update.log              巡检日志
└── last-report.md               最近一次巡检报告
```

**想手工加候选源**：编辑 `source-pool.txt`，每行 `名称|接口地址`，下一轮巡检就会测它。

**想立即加一个源**：用管理页 `http://飞牛IP:8021/tjtv` 添加，或调接口：

```bash
curl -X POST http://飞牛IP:8021/api/tjtv/sources \
  -H "Content-Type: application/json" \
  -d '{"name":"源名","url":"https://example.com/api.php/provide/vod"}'
```

---

## 八、安全提醒

1. **一定要改 `PASSWORD`**，别用默认的 `change-me`
2. **只在内网用**，别把 8021 端口映射到公网
3. 要外网访问，走 **飞牛自带的 DDNS + 反代**，或者套 Cloudflare
4. 如果套了反代，**记得配 HTTPS**——否则会出现「密码对却登不进去」
   （生产模式 cookie 带 `Secure`，HTTP 下浏览器会丢弃）
5. `/api/tjtv/sources` 管理接口**不需要登录**，暴露到公网前必须加认证
