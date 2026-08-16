/**
 * jiaoyifu-skill-router · 路由引擎
 * 对用户任务做确定性打分排序：名称命中 > 描述命中 > 分类匹配 > 使用记录加成。
 * 零模型调用，毫秒级返回，适合「实时分析用什么 skill」。
 */
import { classifyQuery, tokenize, type Classification } from './taxonomy.ts'

export interface SkillUsage {
  count: number
  lastUsedAt?: number
}

export interface SkillEntry {
  name: string
  description: string
  whenToUse?: string
  category: string
  categoryLabel: string
  source?: string
  provider?: string
  usage?: SkillUsage
}

export interface RankedSkill {
  name: string
  category: string
  categoryLabel: string
  score: number
  reasons: string[]
  description: string
}

const FRESH_MS = 3 * 24 * 3600 * 1000

/**
 * 对任务查询与技能库做匹配排序。
 * @param query 任务描述 / 用户需求原文
 * @param skills 技能库条目（已带分类与用量）
 * @param topN 返回前 N 名
 */
export function routeSkills(query: string, skills: SkillEntry[], topN: number): RankedSkill[] {
  const qTokens = tokenize(query)
  if (qTokens.length === 0) return []
  const queryCat: Classification | null = classifyQuery(query)
  const ranked: RankedSkill[] = []
  for (const skill of skills) {
    const sName = skill.name.toLowerCase()
    const sText = `${skill.name} ${skill.description} ${skill.whenToUse ?? ''}`.toLowerCase()
    let raw = 0
    const hits: string[] = []
    for (const t of qTokens) {
      if (sName.includes(t)) {
        raw += 3
        hits.push(t)
      } else if (sText.includes(t)) {
        raw += 1
        hits.push(t)
      }
    }
    const reasons: string[] = []
    if (hits.length > 0) {
      const unique = [...new Set(hits)].slice(0, 4)
      reasons.push(`命中关键词：${unique.join('、')}`)
    }
    if (queryCat && skill.category === queryCat.category) {
      raw += 1.5
      reasons.push(`分类匹配：${queryCat.label}`)
    }
    if (skill.usage && skill.usage.count > 0) {
      const countBonus = Math.min(1, 0.15 * skill.usage.count)
      const freshBonus = skill.usage.lastUsedAt && Date.now() - skill.usage.lastUsedAt < FRESH_MS ? 0.3 : 0
      raw += countBonus + freshBonus
      reasons.push(`近期使用 ${skill.usage.count} 次${freshBonus > 0 ? '（3天内）' : ''}`)
    }
    const score = Math.min(99, Math.round(raw * 10))
    if (score <= 0) continue
    ranked.push({
      name: skill.name,
      category: skill.category,
      categoryLabel: skill.categoryLabel,
      score,
      reasons,
      description: skill.description,
    })
  }
  ranked.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
  return ranked.slice(0, Math.max(1, Math.min(topN, 20)))
}

/**
 * 话题指纹：分类 + 前若干个内容 token。
 * 用于「话题是否变化」判断 —— 只有变化时才重新注入路由提示，节省 token。
 */
export function topicFingerprint(query: string): string {
  const queryCat = classifyQuery(query)
  const tokens = tokenize(query).slice(0, 8).sort()
  return `${queryCat?.category ?? ''}|${tokens.join('|')}`
}

// ---------------------------------------------------------------------------
// 工具自治分支：任务是在维护/修改 jiaoyifu 插件本身（分类器/路由/插件集）时，
// 业务技能全是噪声 —— 改提示为「直接改源码」，不推荐任何业务技能。
// ---------------------------------------------------------------------------

/** 强信号词：命中任意一个即判定为工具自治任务 */
const AUTONOMY_STRONG = [
  'skill-router', 'skill_router', '技能路由', '分类器', '分类体系', '分类目录',
  '分类词', 'taxonomy', '技能分类', 'skill_catalog', 'skill_route', 'cordis.yml',
  '插件集', 'jiaoyifu-skill-router', 'jiaoyifu 插件', 'jiaoyifu插件', 'skill catalog',
]

/** 弱信号词：命中 ≥2 个才判定（单看「插件」太泛，容易误伤） */
const AUTONOMY_WEAK = [
  '插件', '分类', '路由', '维护', 'dsh', 'plugin', '分类键', '改造', '升级开发',
]

/** 维护意图动词：出现才说明「要动手改」，而不是「要看」 */
const MAINTENANCE_VERBS = [
  '改', '修', '加', '删', '调整', '优化', '升级', '更新', '维护', '重写', '重构',
  '更换', '挪', '移', '新增', '删除', '修改', '扩展', '增补', '锁位', '修正',
]

/** 查看意图动词：只浏览不修改（如「看看技能分类」不是自治任务） */
const VIEW_VERBS = [
  '看看', '查看', '显示', '列出', '有哪些', '分类总览', '总览', '介绍', '是多少',
  '是什么', '查一下', '说说', '告诉我', '统计一下',
]

/**
 * 判断当前任务是否为「工具自治」：维护/修改插件系统本身。
 * 带维护动词的才判定；纯查看意图（看看/列出/有哪些）放行给正常路由。
 */
export function isAutonomyTask(query: string): boolean {
  const low = query.toLowerCase()
  let nounSignal = false
  for (const kw of AUTONOMY_STRONG) {
    if (low.includes(kw.toLowerCase())) {
      nounSignal = true
      break
    }
  }
  if (!nounSignal) {
    let hits = 0
    for (const kw of AUTONOMY_WEAK) {
      if (low.includes(kw.toLowerCase())) hits += 1
    }
    nounSignal = hits >= 2
  }
  if (!nounSignal) return false
  // 意图区分：只看不动的查询不是自治任务
  const hasMaintenance = MAINTENANCE_VERBS.some((v) => low.includes(v.toLowerCase()))
  const hasView = VIEW_VERBS.some((v) => low.includes(v.toLowerCase()))
  if (hasView && !hasMaintenance) return false
  return true
}
