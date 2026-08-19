#!/usr/bin/env node
/**
 * 幂等重放 widget-dock adaptive-deck v1 补丁。
 * 默认目标：本仓 node_modules/widget-dock/lib/client.js
 * 可传参指定目标文件（供 restore-test）。
 *
 * 已打补丁（检测标记注释）→ 输出 already patched，退出 0。
 * 未打则按精确字符串匹配全部替换；任一处匹配失败立即退出非零，不写文件。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_TARGET = join(REPO, 'node_modules/widget-dock/lib/client.js')
const PATCH_MARK = '// jiaoyifu-patch: adaptive-deck v1（可见门槛 180->120、紧凑单列、安全边距自适应）'

const REPLACEMENTS = [
  {
    name: 'A.constants',
    from: [
      '    const DEFAULT_WIDGET_IDS = ["contextPressure", "todos", "permissions"];',
      '    const UI_STATE_KEY = "widget-dock:ui";',
    ].join('\n'),
    to: [
      '    const DEFAULT_WIDGET_IDS = ["contextPressure", "todos", "permissions"];',
      '    ' + PATCH_MARK,
      '    const DECK_MIN_VISIBLE = 120;   // jiaoyifu-patch: 卡片可见门槛（原 180）',
      '    const DECK_COMPACT = 220;       // jiaoyifu-patch: 低于此宽度进入紧凑单列模式',
      '    const UI_STATE_KEY = "widget-dock:ui";',
    ].join('\n'),
  },
  {
    name: 'C.measure-margin',
    from: [
      '          // 左侧卡片始终靠左，正文前保留 26px 安全距离（滚动条贴 deck 右缘时也不会压住对话正文，',
      '          // 与右侧滚动条离屏幕右缘 26px 对称）。',
      '          const leftWidth = Math.max(0, contentLeft - leftStart - 26);',
      '          const rightWidth = Math.max(0, viewport - contentRight - 26);',
    ].join('\n'),
    to: [
      '          // jiaoyifu-patch: 先算原始空白；≥150px 保持 26px，否则仅在 26px 会掉出门槛而 8px 能救回时收窄到 8px',
      '          const leftRaw = contentLeft - leftStart;',
      '          const rightRaw = viewport - contentRight;',
      '          const deckSafeMargin = (raw) => {',
      '            if (raw >= 150) return 26;',
      '            if (raw - 26 < DECK_MIN_VISIBLE && raw - 8 >= DECK_MIN_VISIBLE) return 8;',
      '            return 26;',
      '          };',
      '          const leftWidth = Math.max(0, leftRaw - deckSafeMargin(leftRaw));',
      '          const rightWidth = Math.max(0, rightRaw - deckSafeMargin(rightRaw));',
    ].join('\n'),
  },
  {
    name: 'A.pickSide',
    from: [
      '      // 选侧：优先有实际空间的一侧（deck 宽度 ≥180 才可见），两侧都可见时按卡片数平衡',
      '      const pickSide = (itemsList) => {',
      '        const leftOk = !!(layout && layout.left.width >= 180);',
      '        const rightOk = !!(layout && layout.right.width >= 180);',
    ].join('\n'),
    to: [
      '      // 选侧：优先有实际空间的一侧（deck 宽度 ≥DECK_MIN_VISIBLE 才可见），两侧都可见时按卡片数平衡',
      '      const pickSide = (itemsList) => {',
      '        const leftOk = !!(layout && layout.left.width >= DECK_MIN_VISIBLE);',
      '        const rightOk = !!(layout && layout.right.width >= DECK_MIN_VISIBLE);',
    ].join('\n'),
  },
  {
    name: 'A+B.deckStyle',
    from: [
      '      const canShowDecks = !!(layout && (layout.left.width >= 180 || layout.right.width >= 180));',
      '      const deckStyle = (side) => {',
      '        if (!layout || layout[side].width < 180) return { display: "none" };',
      '        const top = layout.top != null ? layout.top : 90;',
      '        const maxH = Math.max(200, window.innerHeight - top - 40);',
      '        return {',
      '          left: layout[side].x + "px",',
      '          top: top + "px",',
      '          width: layout[side].width + "px",',
      '          maxHeight: maxH + "px",',
      '          "--wd-deck-h": maxH + "px"',
      '        };',
      '      };',
    ].join('\n'),
    to: [
      '      const canShowDecks = !!(layout && (layout.left.width >= DECK_MIN_VISIBLE || layout.right.width >= DECK_MIN_VISIBLE));',
      '      const deckStyle = (side) => {',
      '        if (!layout || layout[side].width < DECK_MIN_VISIBLE) return { display: "none" };',
      '        const top = layout.top != null ? layout.top : 90;',
      '        const maxH = Math.max(200, window.innerHeight - top - 40);',
      '        const style = {',
      '          left: layout[side].x + "px",',
      '          top: top + "px",',
      '          width: layout[side].width + "px",',
      '          maxHeight: maxH + "px",',
      '          "--wd-deck-h": maxH + "px"',
      '        };',
      '        if (layout[side].width < DECK_COMPACT) style.gridTemplateColumns = "minmax(0, 1fr)";',
      '        return style;',
      '      };',
    ].join('\n'),
  },
  {
    name: 'A.renderDeck-visible',
    from: '        const visible = !!(layout && layout[side].width >= 180);',
    to: '        const visible = !!(layout && layout[side].width >= DECK_MIN_VISIBLE);',
  },
]

function fail(msg) {
  console.error('[patch-widget-dock] FAIL: ' + msg)
  process.exit(1)
}

const arg = process.argv[2]
const target = arg
  ? (isAbsolute(arg) ? arg : resolve(process.cwd(), arg))
  : DEFAULT_TARGET

let src
try {
  src = readFileSync(target, 'utf8')
} catch (e) {
  fail('cannot read ' + target + ': ' + (e && e.message ? e.message : e))
}

if (src.includes(PATCH_MARK)) {
  console.log('already patched')
  process.exit(0)
}

let next = src
for (const step of REPLACEMENTS) {
  const count = next.split(step.from).length - 1
  if (count === 0) fail(step.name + ': pattern not found in ' + target)
  if (count !== 1) fail(step.name + ': pattern matched ' + count + ' times (want 1) in ' + target)
  next = next.replace(step.from, step.to)
}

if (!next.includes(PATCH_MARK)) {
  fail('patch mark missing after replacements')
}

writeFileSync(target, next)
console.log('[patch-widget-dock] patched ' + target)
