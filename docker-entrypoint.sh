#!/bin/sh
# ============================================================
#  容器入口脚本
#
#  职责：
#    1. 修好数据目录权限（重要：避免挂载卷导致巡检写不了文件）
#    2. 后台起巡检守护进程（每天定时跑 auto-update.mjs）
#    3. 前台起 tjtv 主服务
#
#  环境变量（全部可选）：
#    PASSWORD            访问密码，默认 tjtv
#    PORT                服务端口，默认 8021
#    AUTO_UPDATE         1=开启自动巡检（默认） 0=关闭
#    AUTO_UPDATE_CRON    巡检间隔秒数，默认 86400（每天一次）
#    AUTO_UPDATE_TARGET  保持多少个可用源，默认 15
#    AUTO_UPDATE_DELAY   启动后等多少秒跑首次巡检，默认 60
#    PUID / PGID         以指定用户/组身份运行（NAS 场景常用），默认跑内置 node 用户
# ============================================================
set -e

PORT="${PORT:-8021}"
PASSWORD="${PASSWORD:-tjtv}"
AUTO_UPDATE="${AUTO_UPDATE:-1}"
AUTO_UPDATE_CRON="${AUTO_UPDATE_CRON:-86400}"
AUTO_UPDATE_TARGET="${AUTO_UPDATE_TARGET:-15}"
AUTO_UPDATE_DELAY="${AUTO_UPDATE_DELAY:-60}"
TJTV_DATA_DIR="${TJTV_DATA_DIR:-/app/data}"
export TJTV_DATA_DIR
export PORT

echo "=========================================="
echo "  tjtv 容器启动"
echo "=========================================="
echo "  服务端口：$PORT"
echo "  数据目录：$TJTV_DATA_DIR"

# ---------- 1) 数据目录准备（以 root 身份做，之后降权）----------
mkdir -p "$TJTV_DATA_DIR" 2>/dev/null || true

# 首次启动时初始化必要文件
if [ ! -f "$TJTV_DATA_DIR/tjtv-sources.json" ]; then
  echo '{"version":1,"sources":[]}' > "$TJTV_DATA_DIR/tjtv-sources.json" 2>/dev/null || true
  echo "  已初始化运行时源清单"
fi

# 候选池 + 内置源清单：首次启动时从镜像模板复制到挂载目录。
# 模板放在 /app/defaults/（挂载卷之外，否则读不到）。
# 已存在则不覆盖 —— 你在飞牛上改过的内容会被保留。
copy_default() {
  src="$1"
  dst="$TJTV_DATA_DIR/$2"
  [ -f "$dst" ] && return 0
  for d in /app/defaults /app/scripts /app/data; do
    if [ -f "$d/$src" ]; then
      cp "$d/$src" "$dst" 2>/dev/null || true
      return 0
    fi
  done
  return 1
}

if copy_default "source-pool.txt" "source-pool.txt"; then
  echo "  候选源池就绪"
fi
if copy_default "builtin-sources.json" "builtin-sources.json"; then
  echo "  内置源清单就绪"
fi

# 确定运行用户
# 说明：镜像自带 node 用户（uid 1000 / gid 1000），默认就用它。
# 传了 PUID/PGID 就现建一个匹配的用户，以便写 NAS 上的挂载目录。
RUN_UID=1000
RUN_GID=1000
if [ -n "${PUID:-}" ] && [ -n "${PGID:-}" ]; then
  RUN_UID="$PUID"
  RUN_GID="$PGID"
  if ! getent group "$RUN_GID" >/dev/null 2>&1; then
    addgroup -g "$RUN_GID" tjtvuser 2>/dev/null || true
  fi
  if ! getent passwd "$RUN_UID" >/dev/null 2>&1; then
    adduser -u "$RUN_UID" -G "$(getent group "$RUN_GID" | cut -d: -f1)" \
      -D -H -s /sbin/nologin tjtvuser 2>/dev/null || true
  fi
fi
RUN_USER="$(getent passwd "$RUN_UID" | cut -d: -f1)"
[ -z "$RUN_USER" ] && RUN_USER="node"
echo "  运行身份：$RUN_USER (UID=$RUN_UID GID=$RUN_GID)"

# 【关键】把数据目录权限交给运行用户。
# 挂载卷通常属于宿主机的 owner，容器内用户默认无权写入，
# 这里显式授权，避免巡检静默失败。
chown -R "$RUN_UID:$RUN_GID" "$TJTV_DATA_DIR" 2>/dev/null || true
chmod -R u+rwX "$TJTV_DATA_DIR" 2>/dev/null || true

# 降权执行。
# 注意：Alpine 里的 setpriv 是 busybox 精简版，不支持 --reuid/--regid，
# 所以这里用 busybox 自带的 su 作为主力手段。
esc() {
  out=""
  for a in "$@"; do
    s=$(printf '%s' "$a" | sed "s/'/'\\\\''/g")
    out="$out '$s'"
  done
  printf '%s' "$out"
}

as_user() {
  if [ "$(id -u)" != "0" ]; then
    # 容器已被 --user 指定为非 root 启动，直接执行
    "$@"
  elif command -v su-exec >/dev/null 2>&1; then
    su-exec "$RUN_USER" "$@"
  else
    su -s /bin/sh -c "$(esc "$@")" "$RUN_USER"
  fi
}

if as_user test -w "$TJTV_DATA_DIR" 2>/dev/null; then
  echo "  ✅ 数据目录可写"
else
  echo "  ⚠️  数据目录仍不可写，巡检将无法更新源清单"
  echo "     请在宿主机上执行：chmod -R 777 $TJTV_DATA_DIR"
fi

# ---------- 2) 巡检守护 ----------
if [ "$AUTO_UPDATE" = "1" ]; then
  LOG="$TJTV_DATA_DIR/auto-update.log"
  echo "  自动巡检：开启"
  echo "    间隔：${AUTO_UPDATE_CRON} 秒"
  echo "    目标源数量：${AUTO_UPDATE_TARGET}"
  echo "    日志：$LOG"

  # 后台跑巡检循环（降权）
  (
    sleep "$AUTO_UPDATE_DELAY"
    while true; do
      {
        echo ''
        echo "===== $(date '+%Y-%m-%d %H:%M:%S') 开始巡检 ====="
      } >> "$LOG"

      if as_user node /app/scripts/auto-update.mjs --target "$AUTO_UPDATE_TARGET" >> "$LOG" 2>&1; then
        echo "巡检完成" >> "$LOG"
        sleep 2
        if as_user node -e "fetch('http://127.0.0.1:$PORT/api/tjtv/reload',{method:'POST'}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
          echo "已通知服务重载源清单" >> "$LOG"
        else
          echo "重载通知失败（服务未就绪，下次重启生效）" >> "$LOG"
        fi
      else
        echo "巡检异常退出，下轮继续" >> "$LOG"
      fi

      sleep "$AUTO_UPDATE_CRON"
    done
  ) &
  echo "  巡检进程已启动（PID $!）"
else
  echo "  自动巡检：关闭"
fi

echo "=========================================="
echo "  启动主服务..."
echo "=========================================="

# ---------- 3) 前台启动主服务（降权）----------
exec_as_user() {
  if [ "$(id -u)" != "0" ]; then
    exec "$@"
  elif command -v su-exec >/dev/null 2>&1; then
    exec su-exec "$RUN_USER" "$@"
  else
    exec su -s /bin/sh -c "$(esc "$@")" "$RUN_USER"
  fi
}

exec_as_user node server.js
