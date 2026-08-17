#!/usr/bin/env bash
# DeepSeek Harness 一键启动器（macOS）
# 用法：Finder 里双击本文件即可 —— 自动开终端、启动 dsh Web UI、就绪后弹出浏览器。
# 关闭本终端窗口 = 停止服务。不要往本文件里粘贴 API key。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
URL="http://127.0.0.1:3080"

cd "$ROOT"

printf '======================================================\n'
printf '  DeepSeek Harness 启动器\n'
printf '  目录：%s\n' "$ROOT"
printf '  地址：%s\n' "$URL"
printf '  服务就绪后会自动打开浏览器（最多等 60 秒）\n'
printf '  关闭本窗口 = 停止服务\n'
printf '  首次启动需联网拉取 npx 包，可能稍慢\n'
printf '======================================================\n\n'

# 后台轮询端口，就绪后自动打开浏览器；服务退出时一并清理
(
  for _ in $(seq 1 60); do
    if curl -s -o /dev/null --max-time 1 "$URL" 2>/dev/null; then
      open "$URL"
      exit 0
    fi
    sleep 1
  done
  printf '\n[启动器] 60 秒内未检测到服务，请手动打开 %s\n' "$URL" >&2
) &
OPENER_PID=$!
trap 'kill "$OPENER_PID" 2>/dev/null || true' EXIT

# 前台运行现有启动脚本（自动加载 jiaoyifu 插件集）
bash "$ROOT/scripts/start-web.sh"
