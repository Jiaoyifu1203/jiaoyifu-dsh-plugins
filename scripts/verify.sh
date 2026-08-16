#!/usr/bin/env bash
# Read-only checks. Safe to rerun.
set -euo pipefail

ok() { printf 'OK   %s\n' "$*"; }
bad() { printf 'FAIL %s\n' "$*"; FAIL=1; }
FAIL=0

if command -v node >/dev/null 2>&1; then
  ok "node $(node -v)"
else
  bad "node 不在 PATH"
fi

if command -v pi >/dev/null 2>&1; then
  ok "pi $(pi --version)"
else
  bad "pi 未安装"
fi

if [ -f "${HOME}/.pi/agent/models.json" ]; then
  if python3 - "${HOME}/.pi/agent/models.json" <<'PY'
import json, sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
ids = {m.get("id") for m in data.get("providers", {}).get("deepseek", {}).get("models", [])}
need = {"deepseek-v4-pro", "deepseek-v4-flash"}
missing = sorted(need - ids)
if missing:
    raise SystemExit("missing " + ",".join(missing))
PY
  then
    ok "~/.pi/agent/models.json 含 V4 Pro 与 V4 Flash"
  else
    bad "~/.pi/agent/models.json 缺 V4 模型"
  fi
else
  bad "没有 ~/.pi/agent/models.json"
fi

if [ -n "${DEEPSEEK_API_KEY:-}" ]; then
  ok "DEEPSEEK_API_KEY 已设置"
else
  bad "DEEPSEEK_API_KEY 未设置（Pi / dsh 调官方 API 会失败）"
fi

if npx --yes @deepseek-ai/dsh --help >/tmp/dsh-help.txt 2>/tmp/dsh-help.err; then
  ok "npx @deepseek-ai/dsh --help"
else
  bad "dsh CLI 不可用，见 /tmp/dsh-help.err"
fi

exit "$FAIL"
