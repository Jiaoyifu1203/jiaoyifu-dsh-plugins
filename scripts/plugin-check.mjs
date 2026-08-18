#!/usr/bin/env node
/**
 * 自研插件体检：jiaoyifu-* + dsh-model-agent。社区 npm 包跳过。
 * 零依赖，node >= 20。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PLUGINS = join(REPO, 'plugins')
const CORDIS = join(PLUGINS, 'cordis.yml')
const ROOT_PKG = join(REPO, 'package.json')
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')

const FIRST_PARTY = (name) => name.startsWith('jiaoyifu-') || name === 'dsh-model-agent'
const NODE_BUILTINS = new Set([
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
])

function listFirstParty() {
  return readdirSync(PLUGINS)
    .filter((n) => FIRST_PARTY(n) && statSync(join(PLUGINS, n)).isDirectory())
    .sort()
}

function unquote(s) {
  const t = String(s ?? '').trim()
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1)
  }
  return t
}

function parseCordisEntries(text) {
  const entries = []
  let current = null
  for (const raw of String(text).split('\n')) {
    const line = raw.replace(/\s+#.*$/, '')
    if (/^\s*#/.test(raw) || !line.trim()) continue
    const id = /^\s+- id:\s+(\S+)/.exec(line)
    if (id) {
      current = { id: unquote(id[1]), name: '' }
      entries.push(current)
      continue
    }
    const name = /^\s+name:\s+(.+)$/.exec(line)
    if (name && current && !current.name) current.name = unquote(name[1])
  }
  return entries.filter((e) => e.id)
}

function isTsPath(name) {
  return name.endsWith('.ts') || name.startsWith('/') || name.includes('/plugins/')
}

function packageExists(pkg) {
  const candidates = [
    join(REPO, 'node_modules', pkg, 'package.json'),
    join(DSH_HOME, 'profiles', 'node_modules', pkg, 'package.json'),
  ]
  return candidates.some((p) => existsSync(p))
}

function walkTs(dir, acc = []) {
  let names = []
  try {
    names = readdirSync(dir)
  } catch {
    return acc
  }
  for (const n of names) {
    if (n === 'node_modules' || n.startsWith('.')) continue
    const p = join(dir, n)
    let st
    try {
      st = statSync(p)
    } catch {
      continue
    }
    if (st.isDirectory()) walkTs(p, acc)
    else if (n.endsWith('.ts')) acc.push(p)
  }
  return acc
}

function isWhitelistedBare(spec) {
  if (spec.startsWith('@deepseek-ai/')) return true
  if (spec === 'cordis' || spec.startsWith('cordis/')) return true
  if (spec.startsWith('@cordisjs/')) return true
  if (spec === 'cosmokit' || spec.startsWith('cosmokit/')) return true
  return false
}

function collectFromSpecs(src) {
  const specs = []
  for (const raw of String(src).split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('//') || line.startsWith('*') || line.startsWith('/*')) continue
    if (!/^(?:import|export)\b/.test(line)) continue
    const from = /\bfrom\s+['"]([^'"]+)['"]/.exec(line)
    if (from) specs.push(from[1])
    const side = /^import\s+['"]([^'"]+)['"]/.exec(line)
    if (side) specs.push(side[1])
  }
  return [...new Set(specs)]
}

const rows = []
function add(plugin, item, pass, detail = '') {
  rows.push({ plugin, item, pass, detail })
}

function failDetail(xs) {
  return xs.slice(0, 8).join('; ')
}

const firstParty = listFirstParty()
const rootPkg = JSON.parse(readFileSync(ROOT_PKG, 'utf8'))
const deps = { ...(rootPkg.dependencies ?? {}), ...(rootPkg.optionalDependencies ?? {}) }
const cordisEntries = existsSync(CORDIS) ? parseCordisEntries(readFileSync(CORDIS, 'utf8')) : []

for (const plugin of firstParty) {
  const srcDir = join(PLUGINS, plugin, 'src')
  const entry = join(srcDir, 'index.ts')
  const matched = cordisEntries.filter((e) => {
    const blob = `${e.id} ${e.name}`
    return blob.includes(plugin)
  })

  if (matched.length === 0) {
    add(plugin, 'a.cordis-entry', false, 'cordis.yml 无对应 entry')
  } else {
    const problems = []
    for (const e of matched) {
      if (!e.name) {
        problems.push(`${e.id}: 缺少 name`)
        continue
      }
      if (isTsPath(e.name)) {
        if (!existsSync(e.name)) problems.push(`${e.id}: TS 路径不存在 ${e.name}`)
      } else if (!packageExists(e.name)) {
        problems.push(`${e.id}: 裸包 ${e.name} 不在 node_modules 或 ~/.dsh/profiles/node_modules`)
      }
    }
    add(plugin, 'a.cordis-entry', problems.length === 0, failDetail(problems))
  }

  const tsFiles = existsSync(srcDir) ? walkTs(srcDir) : []
  const bareBad = []
  const relBad = []
  const reqFalse = []
  for (const file of tsFiles) {
    const src = readFileSync(file, 'utf8')
    const rel = file.slice(REPO.length + 1)
    if (/required\s*:\s*false/.test(src)) reqFalse.push(rel)
    for (const spec of collectFromSpecs(src)) {
      if (spec.startsWith('.')) {
        if (!spec.endsWith('.ts')) relBad.push(`${rel} <- ${spec}`)
        continue
      }
      if (spec.startsWith('node:') || NODE_BUILTINS.has(spec)) continue
      if (isWhitelistedBare(spec)) continue
      if (Object.prototype.hasOwnProperty.call(deps, spec)) continue
      bareBad.push(`${rel} <- ${spec}`)
    }
  }
  add(plugin, 'b.bare-import', bareBad.length === 0, failDetail(bareBad))
  add(plugin, 'c.relative-.ts', relBad.length === 0, failDetail(relBad))
  add(plugin, 'd.schema-required', reqFalse.length === 0, reqFalse.length ? `required: false @ ${failDetail(reqFalse)}` : '')

  if (!existsSync(entry)) {
    add(plugin, 'e.esbuild', false, `缺少入口 ${entry}`)
    continue
  }
  const outFile = join(REPO, '.tmp-tooling', `.plugin-check-${plugin}.mjs`)
  const r = spawnSync(
    'npx',
    ['--prefix', REPO, 'esbuild', entry, '--bundle', '--format=esm', '--packages=external', '--log-level=error', `--outfile=${outFile}`],
    { encoding: 'utf8', cwd: REPO },
  )
  const err = `${r.stderr || ''}${r.stdout || ''}`.trim()
  add(plugin, 'e.esbuild', r.status === 0, r.status === 0 ? '' : err.split('\n').slice(0, 6).join(' | '))
}

const width = Math.max(...rows.map((r) => r.plugin.length), 8)
const itemW = Math.max(...rows.map((r) => r.item.length), 8)
console.log(`${'STATUS'.padEnd(6)}  ${'PLUGIN'.padEnd(width)}  ${'CHECK'.padEnd(itemW)}  DETAIL`)
for (const r of rows) {
  const st = r.pass ? 'PASS' : 'FAIL'
  const detail = r.pass ? '' : r.detail.replace(/\s+/g, ' ').slice(0, 240)
  console.log(`${st.padEnd(6)}  ${r.plugin.padEnd(width)}  ${r.item.padEnd(itemW)}  ${detail}`)
}
const failed = rows.filter((r) => !r.pass)
console.log('')
console.log(failed.length === 0 ? `ALL PASS  (${rows.length} checks, ${firstParty.length} plugins)` : `FAILED  ${failed.length}/${rows.length}`)
process.exit(failed.length === 0 ? 0 : 1)
