/**
 * jiaoyifu-skill-router · 持久化
 * 分类目录写入 ~/.dsh/skill-catalog.json（机器读）+ skill-catalog.md（人读）。
 * 用量统计与目录同文件存储，重启不丢。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { SkillEntry } from './router'

export interface CatalogCategory {
  key: string
  label: string
  count: number
}

export interface Catalog {
  updatedAt: string
  total: number
  categories: CatalogCategory[]
  skills: SkillEntry[]
}

export function dshHome(): string {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

export function catalogPaths(dir: string): { json: string; md: string } {
  const base = dir || dshHome()
  return { json: join(base, 'skill-catalog.json'), md: join(base, 'skill-catalog.md') }
}

export async function loadCatalog(jsonPath: string): Promise<Catalog | null> {
  try {
    const raw = await readFile(jsonPath, 'utf8')
    const parsed = JSON.parse(raw)
    if (!parsed || !Array.isArray(parsed.skills)) return null
    return parsed as Catalog
  } catch {
    return null
  }
}

let saveChain: Promise<void> = Promise.resolve()
export function saveCatalogDebounced(jsonPath: string, mdPath: string, catalog: Catalog): void {
  saveChain = saveChain.then(async () => {
    try {
      await mkdir(dirname(jsonPath), { recursive: true })
      await writeFile(jsonPath, JSON.stringify(catalog, null, 2), 'utf8')
      await writeFile(mdPath, renderCatalogMarkdown(catalog), 'utf8')
    } catch (err) {
      console.error('[jiaoyifu-skill-router] 保存技能目录失败:', err)
    }
  })
}

/** 生成人读的分类目录 Markdown（每行一行技能，供人 / 工具快速浏览）。 */
export function renderCatalogMarkdown(catalog: Catalog): string {
  const byCat = new Map<string, SkillEntry[]>()
  for (const skill of catalog.skills) {
    const list = byCat.get(skill.category) ?? []
    list.push(skill)
    byCat.set(skill.category, list)
  }
  const lines: string[] = []
  lines.push('# 技能分类目录 · Skill Catalog')
  lines.push('')
  lines.push(`> 由 jiaoyifu-skill-router 自动生成 · 更新于 ${catalog.updatedAt} · 共 ${catalog.total} 个技能 / ${catalog.categories.length} 个分类`)
  lines.push('')
  for (const cat of catalog.categories) {
    const list = (byCat.get(cat.key) ?? []).slice().sort((a, b) => a.name.localeCompare(b.name))
    lines.push(`## ${cat.label}（${list.length}）`)
    lines.push('')
    for (const skill of list) {
      const desc = (skill.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 90)
      const usage = skill.usage && skill.usage.count > 0 ? ` · 用过${skill.usage.count}次` : ''
      lines.push(`- \`${skill.name}\` — ${desc}${usage}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}
