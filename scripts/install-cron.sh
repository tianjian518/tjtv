#!/usr/bin/env bash
# ============================================================
#  安装每日自动巡检定时任务
#
#    bash scripts/install-cron.sh         每天凌晨 3:00
#    bash scripts/install-cron.sh 6       每天早上 6:00
# ============================================================
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
HOUR="${1:-3}"
PY="$(command -v python3)"
LOG_DIR="$ROOT/logs"
TAG="# tjtv-auto-update"

mkdir -p "$LOG_DIR"

CRON_LINE="0 $HOUR * * * cd $ROOT && $PY scripts/auto_update.py >> $LOG_DIR/auto.log 2>&1 $TAG"

echo "=========================================="
echo "  安装 tjtv 自动巡检定时任务"
echo "=========================================="
echo
echo "  项目目录：$ROOT"
echo "  Python  ：$PY"
echo "  执行时间：每天 $HOUR:00"
echo "  日志位置：$LOG_DIR/auto.log"
echo

# 备份现有 crontab
if crontab -l > /dev/null 2>&1; then
  crontab -l > "$LOG_DIR/crontab.bak" 2>/dev/null || true
  echo "  （原 crontab 已备份到 $LOG_DIR/crontab.bak）"
fi

# 移除旧的同类任务，避免重复
( crontab -l 2>/dev/null | grep -v "$TAG" || true; echo "$CRON_LINE" ) | crontab -

echo
echo "✅ 安装完成。当前任务："
crontab -l 2>/dev/null | grep "$TAG" || echo "  （未找到，可能安装失败）"
echo
echo "常用操作："
echo "  查看任务：crontab -l"
echo "  查看日志：tail -f $LOG_DIR/auto.log"
echo "  卸载任务：crontab -l | grep -v '$TAG' | crontab -"
echo
echo "⚠️  注意：cron 需要系统在运行时间点处于开机状态。"
echo "    如果你的电脑会关机/休眠，建议改用 NAS 的任务计划，"
echo "    或者放到 GitHub Actions 上跑。"
