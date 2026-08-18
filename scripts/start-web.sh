#!/usr/bin/env bash
# Start official DeepSeek Harness Web UI. Run this on the Mac terminal.
# Do not paste API keys into this file.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
DSH_PIN="${DSH_PIN:-@deepseek-ai/dsh@0.1.0-rc.7}"

load_node() {
  if command -v npx >/dev/null 2>&1; then
    return 0
  fi
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [ -s "$NVM_DIR/nvm.sh" ]; then
    # shellcheck disable=SC1090
    . "$NVM_DIR/nvm.sh"
  fi
}

find_dsh() {
  if [ -x "$ROOT/node_modules/.bin/dsh" ]; then
    printf '%s\n' "$ROOT/node_modules/.bin/dsh"
    return 0
  fi
  local f newest="" newest_m=0 m
  if [ -d "${HOME}/.npm/_npx" ]; then
    while IFS= read -r f; do
      [ -x "$f" ] || continue
      m=$(stat -f %m "$f" 2>/dev/null || printf '0')
      if [ "$m" -gt "$newest_m" ]; then
        newest_m=$m
        newest=$f
      fi
    done < <(find "${HOME}/.npm/_npx" -maxdepth 5 -path '*/node_modules/.bin/dsh' 2>/dev/null)
  fi
  if [ -n "$newest" ]; then
    printf '%s\n' "$newest"
    return 0
  fi
  return 1
}

load_node

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

# 社区插件（dsh-better-sidebar / widget-dock / dsh-video-preview）+ jiaoyifu-studio
# 以裸包名写在 cordis.yml。DSH ctx.baseUrl 是 ~/.dsh/profiles/web/，
# 需要 $DSH_HOME/profiles/node_modules 里有指向本仓 node_modules 的 symlink。
if [ -x "$ROOT/scripts/install-community-plugins.sh" ] && [ -d "$ROOT/node_modules/dsh-better-sidebar" ]; then
  FALLBACK="${DSH_HOME:-$HOME/.dsh}/profiles/node_modules"
  mkdir -p "$FALLBACK"
  for pkg in dsh-better-sidebar widget-dock dsh-video-preview jiaoyifu-studio; do
    if [ -e "$ROOT/node_modules/$pkg" ]; then
      ln -sfn "$ROOT/node_modules/$pkg" "$FALLBACK/$pkg" 2>/dev/null || true
    fi
  done
fi

PATCH_FLAGS=()
if [ -f "$ROOT/plugins/cordis.yml" ]; then
  PATCH_FLAGS=(--patch "$ROOT/plugins/cordis.yml")
fi

# 注意：dsh rc.6 的 `web` 子命令不接受父级 --patch，必须用 `--profile web` 形式
if DSH_BIN="$(find_dsh)"; then
  printf '    使用本地 dsh：%s\n' "$DSH_BIN"
  printf '    插件编译可能要几十秒；转圈不是卡死\n'
  exec "$DSH_BIN" --profile web "${PATCH_FLAGS[@]}" "$@"
fi

printf '    本地无 dsh 缓存，正在拉取 %s（可能 1–3 分钟，转圈不是卡死）\n' "$DSH_PIN"
exec npx --yes --prefer-offline "$DSH_PIN" --profile web "${PATCH_FLAGS[@]}" "$@"
