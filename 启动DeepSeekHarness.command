#!/usr/bin/env bash
# DeepSeek Harness 一键启动器（macOS）
# 用法：Finder 里双击本文件即可 —— 自动开终端、启动 dsh Web UI、就绪后弹出浏览器。
# 关闭本终端窗口 = 停止服务。不要往本文件里粘贴 API key。
set -euo pipefail

# 经家目录软链接启动时，$0 是链接本身；必须解析到仓库真实路径，否则找不到 scripts/
_self="${BASH_SOURCE[0]:-$0}"
if command -v realpath >/dev/null 2>&1; then
  _self="$(realpath "$_self")"
else
  while [ -L "$_self" ]; do
    _dir="$(cd "$(dirname "$_self")" && pwd)"
    _link="$(readlink "$_self")"
    case "$_link" in
      /*) _self="$_link" ;;
      *) _self="$_dir/$_link" ;;
    esac
  done
fi
ROOT="$(cd "$(dirname "$_self")" && pwd)"
unset _self _dir _link
URL="http://127.0.0.1:3080"
WAIT_SECS="${DSH_WAIT_SECS:-300}"

cd "$ROOT"

url_ready() {
  curl -sS -o /dev/null --max-time 2 -w '%{http_code}' "$URL" 2>/dev/null | grep -q '^200$'
}

printf '======================================================\n'
printf '  DeepSeek Harness 启动器\n'
printf '  目录：%s\n' "$ROOT"
printf '  地址：%s\n' "$URL"
printf '  服务就绪后会自动打开浏览器（最多等 %s 秒）\n' "$WAIT_SECS"
printf '  关闭本窗口 = 停止服务\n'
printf '  转圈是 npm/dsh 启动，不是卡死；冷启动可能 1–3 分钟\n'
printf '======================================================\n\n'

# 已有实例在跑：只打开浏览器，避免第二个 dsh 抢 3080 后假死
if url_ready; then
  open "$URL"
  printf '服务已在 %s 运行，已打开浏览器。本次不重复启动。\n' "$URL"
  exit 0
fi

# 后台轮询端口，就绪后自动打开浏览器；服务退出时一并清理
(
  for i in $(seq 1 "$WAIT_SECS"); do
    if url_ready; then
      open "$URL"
      printf '\n[启动器] 服务已就绪，已打开浏览器\n'
      exit 0
    fi
    if [ $((i % 15)) -eq 0 ]; then
      printf '[启动器] 仍在等待服务就绪（%d/%d 秒）…\n' "$i" "$WAIT_SECS"
    fi
    sleep 1
  done
  printf '\n[启动器] %s 秒内未检测到服务。不要关这个窗口；若转圈稍后结束，请手动打开 %s\n' "$WAIT_SECS" "$URL" >&2
) &
OPENER_PID=$!
trap 'kill "$OPENER_PID" 2>/dev/null || true' EXIT

# 前台运行现有启动脚本（自动加载 jiaoyifu 插件集）
bash "$ROOT/scripts/start-web.sh"
