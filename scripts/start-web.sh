#!/usr/bin/env bash
# Start official DeepSeek Harness Web UI. Run this on the Mac terminal.
# Do not paste API keys into this file.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v npx >/dev/null 2>&1; then
  printf 'ERROR: 缺少 npx。先安装 Node 22+\n' >&2
  exit 1
fi

printf '==> 启动 DeepSeek Harness Web UI（官方 npm，不克隆源码仓）\n'
printf '    工作目录：%s\n' "$ROOT"
printf '    默认地址：http://127.0.0.1:3080\n'
printf '    启动后：Settings → Models 填 DeepSeek API key，再 Choose workspace\n'
printf '    已自动加载 jiaoyifu 插件集（plugins/cordis.yml）\n'
printf '\n'

# 飞书机器人桥的 App Secret（jiaoyifu-feishu 插件读取 FEISHU_APP_SECRET）
if [ -f "$ROOT/plugins/feishu.env" ]; then
  # shellcheck disable=SC1091
  source "$ROOT/plugins/feishu.env"
  printf '    飞书机器人桥已启用（plugins/feishu.env）\n'
fi

PATCH_FLAGS=()
if [ -f "$ROOT/plugins/cordis.yml" ]; then
  PATCH_FLAGS=(--patch "$ROOT/plugins/cordis.yml")
fi

# 注意：dsh rc.6 的 `web` 子命令不接受父级 --patch，必须用 `--profile web` 形式
exec npx --yes @deepseek-ai/dsh --profile web "${PATCH_FLAGS[@]}" "$@"
