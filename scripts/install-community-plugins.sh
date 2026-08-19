#!/usr/bin/env bash
# 把 DSH 社区插件 + jiaoyifu-studio 装进本仓 node_modules，并链到
# ~/.dsh/profiles/node_modules，让 web profile 的 createRequire(ctx.baseUrl)
# 能用裸包名解析（entry name 必须与社区包 client.js 的 id 一致）。
#
# 为什么写进 package.json、不用 --no-save：
#   换机复现 = clone + 本脚本（或 npm install --cache .tmp-tooling/npm-cache）。
#   --no-save 会在下一次 npm install 时丢掉，无法作为权威清单。
# 为什么还要 symlink 到 ~/.dsh/profiles/node_modules：
#   DSH ctx.baseUrl 是 ~/.dsh/profiles/web/；client-modules 用
#   createRequire(baseUrl).resolve(name + "/package.json")。
#   只装在 $REPO/node_modules 时，profile 解析不到裸包名。
#   $DSH_HOME/profiles/node_modules 是官方 parent-walk 回退目录。
#
# 本机 npm 全局缓存有 root EPERM，一律带 --cache .tmp-tooling/npm-cache。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

CACHE="$ROOT/.tmp-tooling/npm-cache"
FALLBACK="${DSH_HOME:-$HOME/.dsh}/profiles/node_modules"
PKGS=(dsh-better-sidebar widget-dock dsh-video-preview jiaoyifu-studio)

mkdir -p "$CACHE" "$FALLBACK"

echo "==> npm install (cache=$CACHE)"
npm install --cache "$CACHE" --no-fund --no-audit

echo "==> heal profile fallback symlinks → $FALLBACK"
for pkg in "${PKGS[@]}"; do
  src="$ROOT/node_modules/$pkg"
  dest="$FALLBACK/$pkg"
  if [ ! -e "$src" ]; then
    echo "    skip $pkg (not in node_modules)"
    continue
  fi
  # 官方 heal 只管理 in-box 包；社区包名不会被它覆盖。已存在的真目录不碰。
  if [ -e "$dest" ] && [ ! -L "$dest" ]; then
    echo "    keep $dest (not a symlink)"
    continue
  fi
  ln -sfn "$src" "$dest"
  echo "    link $pkg"
done

echo "==> resolve check"
node --input-type=module -e '
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
const home = process.env.DSH_HOME || join(process.env.HOME, ".dsh");
const base = pathToFileURL(join(home, "profiles/web/package.json")).href;
const req = createRequire(base);
for (const name of ["dsh-better-sidebar", "widget-dock", "dsh-video-preview", "jiaoyifu-studio"]) {
  const pkg = req.resolve(name + "/package.json");
  console.log("    " + name + " -> " + pkg);
}
'

echo "==> patch widget-dock adaptive deck"
node "$ROOT/scripts/patch-widget-dock.mjs"

echo "==> done"
