#!/usr/bin/env bash
# jiaoyifu 技能接入脚本：把已有技能库链接进 DSH 原生扫描根 ~/.dsh/skills
# 来源：~/.cc-switch/skills（主库，133+ 技能）+ ~/.claude/skills（本地技能）
#       + 本仓库 skills/（jiaoyifu 升级技能）
# 幂等：重复执行安全；只维护符号链接，不碰 ~/.dsh/skills 里的实体目录。
set -euo pipefail

SRC_CCSWITCH="$HOME/.cc-switch/skills"
SRC_CLAUDE="$HOME/.claude/skills"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC_REPO="$ROOT/skills"
DST="$HOME/.dsh/skills"

mkdir -p "$DST"

link_one() { # <源目录> <目标名>
  local src="$1" name="$2" real dst cur
  if [ ! -f "$src/SKILL.md" ]; then return 0; fi
  real="$(cd "$src" && pwd -P)"
  dst="$DST/$name"
  if [ -L "$dst" ]; then
    cur="$(readlink "$dst")"
    if [ "$cur" = "$real" ]; then return 0; fi
    rm -f "$dst"
  elif [ -e "$dst" ]; then
    return 0   # 已存在实体目录/文件，尊重用户自建，不动
  fi
  ln -s "$real" "$dst"
  printf '  link  %s → %s\n' "$name" "$real"
}

printf '==> jiaoyifu 技能接入（链接到 %s）\n' "$DST"

printf -- '-- ~/.cc-switch/skills（主技能库）\n'
if [ -d "$SRC_CCSWITCH" ]; then
  for d in "$SRC_CCSWITCH"/*/; do
    [ -d "$d" ] || continue
    link_one "${d%/}" "$(basename "$d")" || true
  done
  # 平铺 .md 文件
  for f in "$SRC_CCSWITCH"/*.md; do
    [ -f "$f" ] || continue
    name="$(basename "$f")"
    dst="$DST/$name"
    real="$(cd "$(dirname "$f")" && pwd -P)/$(basename "$f")"
    if [ -L "$dst" ]; then
      [ "$(readlink "$dst")" = "$real" ] && continue
      rm -f "$dst"
    elif [ -e "$dst" ]; then
      continue
    fi
    ln -s "$real" "$dst"
    printf '  link  %s → %s\n' "$name" "$real"
  done
else
  printf '  (缺失：%s)\n' "$SRC_CCSWITCH"
fi

printf -- '-- ~/.claude/skills（本地实体技能）\n'
if [ -d "$SRC_CLAUDE" ]; then
  for entry in "$SRC_CLAUDE"/*; do
    [ -e "$entry" ] || continue
    # 实体目录且含 SKILL.md
    if [ -d "$entry" ] && [ ! -L "$entry" ] && [ -f "$entry/SKILL.md" ]; then
      link_one "$entry" "$(basename "$entry")" || true
    # 软链接目录（跟随到真实技能库）
    elif [ -L "$entry" ] && [ -d "$entry" ] && [ -f "$entry/SKILL.md" ]; then
      link_one "$entry" "$(basename "$entry")" || true
    fi
  done
else
  printf '  (缺失：%s)\n' "$SRC_CLAUDE"
fi

printf -- '-- 本仓库 skills/（jiaoyifu 升级技能）\n'
if [ -d "$SRC_REPO" ]; then
  for d in "$SRC_REPO"/*/; do
    [ -d "$d" ] || continue
    link_one "${d%/}" "$(basename "$d")" || true
  done
fi

printf -- '-- 清理失效链接\n'
for link in "$DST"/*; do
  [ -L "$link" ] || continue
  if [ ! -e "$link" ]; then
    rm -f "$link"
    printf '  rm    %s（目标已失效）\n' "$(basename "$link")"
  fi
done

count=$(ls -1 "$DST" | wc -l | tr -d ' ')
printf '==> 完成：%s 下现有 %s 个技能。重启 dsh web 后生效。\n' "$DST" "$count"
