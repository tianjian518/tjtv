#!/usr/bin/env bash
# ============================================================
#  tjtv 一键启动
#
#    bash start.sh              常规启动（首次自动装依赖+构建）
#    bash start.sh --rebuild    强制重新构建
#    PORT=8050 bash start.sh    换端口（默认 8021）
# ============================================================
set -euo pipefail

cd "$(dirname "$0")"
APP_DIR="app"

# —— 配置区 ——
PASSWORD="${PASSWORD:-tjtv}"     # 访问密码，建议自己改一个
PORT="${PORT:-8021}"             # 端口（避开常被占用的 8080）

echo "=========================================="
echo "  tjtv 影视聚合站"
echo "=========================================="
echo

# 1) 检查 Node
if ! command -v node >/dev/null 2>&1; then
  echo "❌ 未检测到 Node.js，请先安装 Node 18 或更高版本"
  exit 1
fi
echo "✅ Node $(node -v)"

# 2) 检查端口是否被占用
if command -v ss >/dev/null 2>&1 && ss -tln 2>/dev/null | grep -q ":${PORT} "; then
  echo "❌ 端口 ${PORT} 已被占用，请换一个："
  echo "   PORT=8050 bash start.sh"
  exit 1
fi
echo "✅ 端口 ${PORT} 可用"

# 3) 统计内置源
SRC_INFO=$(node -e "
  try {
    const j = require('./$APP_DIR/data/builtin-sources.json');
    const n = (j.sources||[]).length;
    const names = (j.sources||[]).map(s=>s.name).join('、');
    console.log(n + ' 个（' + names + '）');
  } catch(e) { console.log('0 个'); }
" 2>/dev/null || echo "0 个")
echo "✅ 内置源 ${SRC_INFO}"

# 4) 装依赖 + 构建
NEED_BUILD=0
[ ! -d "$APP_DIR/node_modules" ] && NEED_BUILD=1
[ ! -d "$APP_DIR/.next" ] && NEED_BUILD=1
[ "${1:-}" = "--rebuild" ] && NEED_BUILD=1

if [ "$NEED_BUILD" = "1" ]; then
  echo
  echo "📦 安装依赖（首次约 1-2 分钟）..."
  (cd "$APP_DIR" && npm install --no-audit --no-fund)
  echo "🔨 构建中（约 20-30 秒）..."
  (cd "$APP_DIR" && PASSWORD="$PASSWORD" npm run build)
  echo "✅ 构建完成"
else
  echo "✅ 已有构建产物（要重建请加 --rebuild）"
fi

echo
echo "=========================================="
echo "  🚀 启动中..."
echo "=========================================="
echo "  搜索观看：http://localhost:$PORT"
echo "  源管理页：http://localhost:$PORT/tjtv"
echo "  访问密码：$PASSWORD"
echo
echo "  停止服务：Ctrl + C"
echo

cd "$APP_DIR"
exec env PASSWORD="$PASSWORD" PORT="$PORT" npm start
