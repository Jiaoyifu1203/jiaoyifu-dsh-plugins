#!/usr/bin/env bash
# Install DeepSeek Harness (dsh) CLI + Pi coding agent, apply V4 models, install two Pi packages.
# Run this on the Mac terminal. Do not paste API keys into this file.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODELS_SRC="$ROOT/config/models.json"
PI_HOME="${HOME}/.pi/agent"
NODE_MIN_MAJOR=22

log() { printf '%s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "缺少命令：$1"
}

node_major() {
  node -p "process.versions.node.split('.')[0]"
}

merge_models() {
  python3 - "$MODELS_SRC" "$PI_HOME/models.json" <<'PY'
import json, sys
src_path, dest_path = sys.argv[1], sys.argv[2]
with open(src_path, encoding="utf-8") as f:
    incoming = json.load(f)
try:
    with open(dest_path, encoding="utf-8") as f:
        existing = json.load(f)
except FileNotFoundError:
    existing = {}
providers = existing.setdefault("providers", {})
if not isinstance(providers, dict):
    raise SystemExit("existing models.json providers is not an object")
providers["deepseek"] = incoming["providers"]["deepseek"]
with open(dest_path, "w", encoding="utf-8") as f:
    json.dump(existing, f, ensure_ascii=False, indent=2)
    f.write("\n")
print(dest_path)
PY
}

need_cmd node
need_cmd npm
need_cmd npx
need_cmd python3

major="$(node_major)"
if [ "$major" -lt "$NODE_MIN_MAJOR" ]; then
  die "需要 Node ${NODE_MIN_MAJOR}+，当前是 $(node -v)"
fi

if [ ! -w "$(npm root -g 2>/dev/null || echo /usr/lib/node_modules)" ]; then
  log "==> 系统 npm 全局目录不可写，改用 $HOME/.local"
  mkdir -p "$HOME/.local"
  npm config set prefix "$HOME/.local"
  export PATH="$HOME/.local/bin:$PATH"
fi

log "==> 安装 Pi coding agent（现包名 @earendil-works，旧 @mariozechner 已弃用）"
npm uninstall -g @mariozechner/pi-coding-agent >/dev/null 2>&1 || true
npm install -g @earendil-works/pi-coding-agent

need_cmd pi
log "Pi 版本：$(pi --version)"

mkdir -p "$PI_HOME"
log "==> 写入 DeepSeek V4 Pro / V4 Flash 到 $PI_HOME/models.json"
merge_models

log "==> 安装 pi-web-access（网页搜索 / URL 抓取）"
pi install npm:pi-web-access

log "==> 安装 pi-subagents（子代理委派）"
pi install npm:pi-subagents

log "==> 验证 DeepSeek Harness CLI（官方 npm 入口，不克隆整仓；首次拉包可能较慢）"
if npx --yes --prefer-online @deepseek-ai/dsh --help >/tmp/dsh-help.txt 2>/tmp/dsh-help.err; then
  head -n 20 /tmp/dsh-help.txt
else
  log "dsh 抽查未完成（多半是 npx 还在拉包）。Pi 和两个包已经装好，可稍后单独执行："
  log "  npx --yes @deepseek-ai/dsh --help"
  if [ -s /tmp/dsh-help.err ]; then
    tail -n 8 /tmp/dsh-help.err
  fi
fi

if [ -z "${DEEPSEEK_API_KEY:-}" ]; then
  log ""
  log "尚未设置 DEEPSEEK_API_KEY。"
  log "先到 https://platform.deepseek.com 取 key，然后："
  log "  export DEEPSEEK_API_KEY=你的key"
  log "再开新终端执行：pi"
else
  log "DEEPSEEK_API_KEY 已在当前环境中（脚本不会打印或写入密钥）。"
fi

log ""
log "下一步："
log "  1. 任意项目目录执行 pi ，输入 /model 选 DeepSeek V4 Pro 或 V4 Flash"
log "  2. npx --yes @deepseek-ai/dsh web   # 浏览器打开 http://127.0.0.1:3080"
log "  3. dsh 的 Settings → Models 里填同一把 DeepSeek key"
