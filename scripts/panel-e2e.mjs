#!/usr/bin/env node
/**
 * jiaoyifu-studio 面板 e2e（stub 服务器直测 PANEL_HTML，不依赖 DSH 重启）
 *
 * 安装（不进 git，.tmp-tooling 已在 .gitignore）：
 *   npm i --prefix .tmp-tooling playwright
 *
 * 运行：
 *   node scripts/panel-e2e.mjs
 *
 * 流程：esbuild 把 plugins/jiaoyifu-studio/src/panel.ts 打到 /tmp →
 * 本地 node:http stub（前缀 /jiaoyifu/studio）→
 * playwright chromium.launch({ channel: 'chrome' }) 系统 Chrome。
 * 默认 viewport 800x600（窄于 900：侧栏抽屉收起，点列表前先开抽屉）；
 * 窄视口指标 860x700 另开 context。
 */
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TOOLING = join(REPO, '.tmp-tooling')
const PANEL_SRC = join(REPO, 'plugins/jiaoyifu-studio/src/panel.ts')
const PREFIX = '/jiaoyifu/studio'
const VIEWPORT = { width: 800, height: 600 }
const NARROW_VIEWPORT = { width: 860, height: 700 }
const SCREEN_DIR = '/tmp'

const require = createRequire(join(TOOLING, 'package.json'))

function failInstall() {
  console.error('未找到 .tmp-tooling/node_modules/playwright')
  console.error('请先执行：npm i --prefix .tmp-tooling playwright')
  process.exit(2)
}

if (!existsSync(join(TOOLING, 'node_modules', 'playwright', 'package.json'))) failInstall()

let chromium
try {
  ;({ chromium } = require('playwright'))
} catch (err) {
  console.error('无法从 .tmp-tooling 解析 playwright：', err && err.message)
  failInstall()
}

const results = []
function record(name, pass, detail) {
  results.push({ name, pass: Boolean(pass), detail: detail || '' })
  console.log((pass ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  — ' + String(detail).replace(/\s+/g, ' ').slice(0, 280) : ''))
}

function longText(seed, n) {
  let s = ''
  for (let i = 1; i <= n; i++) s += seed.replace(/#/g, String(i))
  return s
}

function longSrt(n) {
  const lines = []
  for (let i = 1; i <= n; i++) {
    const ss = String(i).padStart(2, '0')
    lines.push(String(i), '00:00:' + ss + ',000 --> 00:00:' + ss + ',800', '字幕条目第 ' + i + ' 条：长内容用来撑开字幕 Tab，确认 #tab-body 能滚动。', '')
  }
  return lines.join('\n')
}

const LONG_TOPIC = '# 收割素材包\n\n' + longText('任务验收摘录第 # 段：工作台要把内容形式分流，并把知识库既有产线点名进对话指令。\n\n', 36)
const LONG_SCRIPT = '# 口播脚本\n\n' + longText('## 段 #\n先说结论，再说证据。这一期讲内容工作台的形式分流和制作动线。\n\n', 60)
const LONG_ARTICLE = '# 公众号长文\n\n' + longText('段落 #。把选题写成能发的公众号长文，字数必须明显超过三千，用来压测文章 Tab 滚动。\n\n', 80)
const LONG_STORYBOARD = '# 分镜表\n\n' + longText('## 镜 #\n台词：把这一镜讲清楚。画面：工作台截图。时长 3s。\n\n', 48)
const LONG_SUBS = longSrt(48)

function baseItem(over) {
  return {
    slug: over.slug,
    title: over.title,
    status: over.status || 'preparing',
    createdAt: '2026-08-19T00:00:00.000Z',
    updatedAt: '2026-08-19T12:00:00.000Z',
    platforms: {},
    dir: '/tmp/studio-e2e/' + over.slug,
    files: Object.assign({ topic: '', script: '', article: '', subs: '', storyboard: '' }, over.files || {}),
    hasCover: Boolean(over.hasCover),
    coverExt: over.hasCover ? 'png' : '',
    hasVideo: Boolean(over.hasVideo),
    coverUrl: '',
    videoUrl: over.hasVideo ? PREFIX + '/api/media?slug=' + encodeURIComponent(over.slug) + '&file=video.mp4' : '',
    video: over.video || null,
    videoFacts: over.videoFacts || { voiceCount: 0, hasVoiceJson: false, materialsCount: 0, hasBgm: false, storyboard: false },
    publishFacts: over.publishFacts || {
      xhs: { exists: false, pack: 'publish/xhs.md' },
      bilibili: { exists: false, pack: 'publish/bilibili.md' },
      douyin: { exists: false, pack: 'publish/douyin.md' },
      shipinhao: { exists: false, pack: 'publish/shipinhao.md' },
      gzh: { exists: false, pack: 'publish/gzh.md' },
    },
    publish: over.publish || null,
    memory: [],
    qc: null,
    sourceTask: over.sourceTask || null,
    form: over.form === undefined ? null : over.form,
  }
}

function buildFixtures() {
  const items = [
    baseItem({
      slug: 'ep-d-gzh',
      title: 'D 公众号长文滚动',
      form: 'gzh',
      files: { topic: '长文选题已定', script: LONG_SCRIPT, article: LONG_ARTICLE, subs: LONG_SUBS, storyboard: LONG_STORYBOARD },
    }),
    baseItem({
      slug: 'ep-a-noform',
      title: 'A 未设形式',
      form: null,
      files: { topic: LONG_TOPIC },
    }),
    baseItem({
      slug: 'ep-e-autoprep',
      title: 'E 选形式即开工',
      form: null,
      status: 'not_started',
      files: { topic: '未开工选题' },
    }),
    baseItem({
      slug: 'ep-b-xhs',
      title: 'B 小红书动线',
      form: 'xhs',
      files: { topic: '', script: LONG_SCRIPT },
      hasCover: false,
    }),
    baseItem({
      slug: 'ep-c-video',
      title: 'C 视频全链',
      form: 'video',
      files: {
        topic: '视频选题已定',
        script: '完整口播脚本正文。',
        subs: '1\n00:00:00,000 --> 00:00:02,000\n开场\n',
        storyboard: '# 分镜\n镜 1',
      },
      hasVideo: true,
      video: { sentences: 6, durationSec: 18, storyboard: { shots: 4, totalSec: 18, at: '2026-08-19T12:00:00.000Z' }, stage: 'done' },
      videoFacts: { voiceCount: 6, hasVoiceJson: true, materialsCount: 0, hasBgm: false, storyboard: true },
    }),
  ]
  for (let i = 1; i <= 22; i++) {
    items.push(baseItem({
      slug: 'ep-pad-' + String(i).padStart(2, '0'),
      title: '填充列表 ' + i,
      form: null,
      files: { topic: '填充' },
    }))
  }
  return items
}

function bundlePanel() {
  const outFile = join(tmpdir(), 'jiaoyifu-studio-panel-e2e.mjs')
  const r = spawnSync(
    'npx',
    ['--prefix', REPO, 'esbuild', PANEL_SRC, '--bundle', '--format=esm', '--log-level=error', '--outfile=' + outFile],
    { encoding: 'utf8', cwd: REPO },
  )
  if (r.status !== 0) {
    throw new Error('esbuild panel.ts 失败：' + String(r.stderr || r.stdout || '').trim())
  }
  return outFile
}

function startStub(html, fixtures) {
  const statusPosts = []
  const fromTaskPosts = []
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    const method = String(req.method || 'GET').toUpperCase()
    const path = url.pathname
    const json = (code, obj) => {
      res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(obj))
    }
    const readBody = () => new Promise((resolveBody) => {
      const chunks = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8')
        try { resolveBody(raw ? JSON.parse(raw) : {}) } catch { resolveBody({}) }
      })
    })

    if (method === 'GET' && (path === PREFIX || path === PREFIX + '/')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      res.end(html)
      return
    }
    if (method === 'GET' && path === PREFIX + '/api/list') {
      json(200, {
        ok: true,
        root: '/tmp/studio-e2e',
        items: fixtures.map((it) => ({
          slug: it.slug,
          title: it.title,
          status: it.status,
          createdAt: it.createdAt,
          updatedAt: it.updatedAt,
          platforms: it.platforms,
          hasCover: it.hasCover,
          coverExt: it.coverExt,
          hasVideo: it.hasVideo,
          form: it.form ?? null,
        })),
      })
      return
    }
    if (method === 'GET' && path === PREFIX + '/api/item') {
      const slug = url.searchParams.get('slug') || ''
      const item = fixtures.find((it) => it.slug === slug)
      if (!item) return json(404, { ok: false, error: '找不到该期内容' })
      json(200, { ok: true, item })
      return
    }
    if (method === 'POST' && path === PREFIX + '/api/status') {
      readBody().then((body) => {
        statusPosts.push(body)
        const item = fixtures.find((it) => it.slug === body.slug)
        if (item && (body.form === 'xhs' || body.form === 'gzh' || body.form === 'video')) {
          item.form = body.form
        }
        if (item && body.status) item.status = body.status
        json(200, { ok: true, meta: item ? { slug: item.slug, form: item.form, status: item.status, title: item.title } : { ok: true } })
      })
      return
    }
    if (method === 'GET' && path === PREFIX + '/api/tasks') {
      json(200, {
        ok: true,
        items: [
          { id: 'ISS-e2e-1', title: 'e2e 示例任务', status: 'done', harvested: false },
          { id: 'ISS-e2e-2', title: '已收割任务', status: 'done', harvested: true },
        ],
      })
      return
    }
    if (method === 'POST' && path === PREFIX + '/api/from-task') {
      readBody().then((body) => {
        fromTaskPosts.push(body)
        json(200, { ok: true, slug: 'ep-a-noform' })
      })
      return
    }
    if (method === 'GET' && path === PREFIX + '/api/video/status') {
      json(200, {
        ok: true,
        probe: { say: true, afinfo: true, ffmpeg: true },
        defaultVoice: 'Tingting',
        zhVoices: ['Tingting', 'Meijia'],
        stage: null,
        facts: null,
      })
      return
    }
    if (method === 'GET' && path === PREFIX + '/api/media') {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: 'no media in stub' }))
      return
    }
    json(404, { ok: false, error: '未知接口 ' + method + ' ' + path })
  })

  return new Promise((resolveListen) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolveListen({
        server,
        port,
        origin: 'http://127.0.0.1:' + port,
        statusPosts,
        fromTaskPosts,
        close: () => new Promise((r) => server.close(r)),
      })
    })
  })
}

async function dumpScrollWorld(page, label) {
  return page.evaluate((tag) => {
    const pick = (el) => {
      if (!el) return null
      const cs = getComputedStyle(el)
      return {
        tag: el.tagName + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + String(el.className).trim().replace(/\s+/g, '.') : ''),
        overflow: cs.overflow,
        overflowY: cs.overflowY,
        overflowX: cs.overflowX,
        height: cs.height,
        maxHeight: cs.maxHeight,
        minHeight: cs.minHeight,
        flex: cs.flex,
        display: cs.display,
        flexDir: cs.flexDirection,
        clientH: el.clientHeight,
        scrollH: el.scrollHeight,
        scrollTop: el.scrollTop,
        offsetH: el.offsetHeight,
      }
    }
    const body = document.getElementById('tab-body')
    const chain = []
    let n = body
    while (n) {
      chain.push(pick(n))
      n = n.parentElement
    }
    return {
      label: tag,
      tabBody: pick(body),
      firstChild: body && body.firstElementChild ? pick(body.firstElementChild) : null,
      detail: pick(document.querySelector('.detail')),
      main: pick(document.querySelector('.main')),
      side: pick(document.querySelector('.side')),
      items: pick(document.getElementById('items')),
      html: pick(document.documentElement),
      docBody: pick(document.body),
      chain: chain.slice(0, 8),
    }
  }, label)
}

async function measureTabScroll(page, tab) {
  await page.click('.tab[data-tab="' + tab + '"]')
  await page.waitForSelector('#tab-body')
  await page.waitForTimeout(80)
  const dump = await dumpScrollWorld(page, tab)
  const measured = await page.evaluate(() => {
    const el = document.getElementById('tab-body')
    if (!el) return { ok: false, error: 'no #tab-body' }
    el.scrollTop = 0
    const before = { scrollTop: el.scrollTop, scrollH: el.scrollHeight, clientH: el.clientHeight }
    el.scrollBy(0, 400)
    const afterBy = el.scrollTop
    el.scrollTop = 0
    el.scrollTop = 240
    const afterAssign = el.scrollTop
    return {
      ok: true,
      before,
      afterBy,
      afterAssign,
      overflowed: before.scrollH > before.clientH,
    }
  })
  return { dump, measured }
}

async function ensureSideOpen(page) {
  const hidden = await page.evaluate(() => {
    const side = document.querySelector('.side')
    return !side || getComputedStyle(side).display === 'none'
  })
  if (!hidden) return
  const toggle = page.locator('#side-toggle')
  if (!(await toggle.isVisible())) return
  await toggle.click()
  await page.waitForFunction(() => {
    const side = document.querySelector('.side')
    return side && getComputedStyle(side).display !== 'none'
  })
  await page.waitForTimeout(40)
}

async function openItem(page, slug) {
  await ensureSideOpen(page)
  await page.click('.item[data-slug="' + slug + '"]')
  await page.waitForFunction((s) => {
    const el = document.querySelector('.dslug')
    return el && el.textContent === s
  }, slug)
  await page.waitForTimeout(60)
}

async function main() {
  if (!existsSync(PANEL_SRC)) throw new Error('缺少 ' + PANEL_SRC)
  const bundled = bundlePanel()
  const mod = await import(pathToFileURL(bundled).href)
  if (!mod.PANEL_HTML || typeof mod.PANEL_HTML !== 'string') throw new Error('PANEL_HTML 导出缺失')

  const fixtures = buildFixtures()
  const stub = await startStub(mod.PANEL_HTML, fixtures)
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const context = await browser.newContext({ viewport: VIEWPORT })
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const page = await context.newPage()
  const url = stub.origin + PREFIX
  console.log('e2e stub', url)
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#items .item', { state: 'attached' })
  await page.waitForSelector('#tab-body')

  // ---- 滚动：期 d 五 Tab ----
  await openItem(page, 'ep-d-gzh')
  const tabNames = [
    ['overview', '概览'],
    ['video', '视频'],
    ['script', '脚本'],
    ['subs', '字幕'],
    ['article', '文章'],
  ]
  const scrollReports = []
  for (const [tab] of tabNames) {
    const r = await measureTabScroll(page, tab)
    scrollReports.push({ tab, ...r })
    const m = r.measured
    const pass = m.ok && m.overflowed && m.afterBy > 0
    const detail = m.ok
      ? 'scrollH=' + m.before.scrollH + ' clientH=' + m.before.clientH + ' afterBy=' + m.afterBy + ' afterAssign=' + m.afterAssign + ' overflowY=' + (r.dump.tabBody && r.dump.tabBody.overflowY)
      : m.error
    record('scroll.' + tab, pass, detail)
    await page.screenshot({ path: join(SCREEN_DIR, 'jiaoyifu-studio-e2e-' + tab + '.png') })
  }
  writeFileSync(join(SCREEN_DIR, 'jiaoyifu-studio-e2e-scroll-diag.json'), JSON.stringify(scrollReports, null, 2))
  console.log('scroll diag → /tmp/jiaoyifu-studio-e2e-scroll-diag.json')

  // ---- 形式选择：期 a（preparing + 未设形式 → 开工提示） ----
  await openItem(page, 'ep-a-noform')
  const formPicker = await page.locator('#form-card [data-act="set-form"][data-form="xhs"]').count()
  record('form.picker-visible', formPicker > 0, 'xhs buttons=' + formPicker)
  const prepHintText = await page.locator('#form-card').innerText().catch(() => '')
  record(
    'form.prep-hint',
    prepHintText.indexOf('已进入准备中--选定形式即出现动作指引') >= 0,
    prepHintText.replace(/\s+/g, ' ').slice(0, 220),
  )
  if (formPicker > 0) {
    stub.statusPosts.length = 0
    await page.click('#form-card [data-act="set-form"][data-form="xhs"]')
    await page.waitForSelector('#flow-card', { timeout: 4000 })
    const posted = stub.statusPosts.find((p) => p && p.form === 'xhs' && p.slug === 'ep-a-noform')
    record('form.post-xhs', Boolean(posted), posted ? JSON.stringify(posted) : 'stub 未收到 form=xhs')
    const flowAfter = await page.locator('#flow-card').count()
    record('form.flow-after-xhs', flowAfter > 0, 'flow-card=' + flowAfter)
    const badge = await page.locator('#form-badge').count()
    record('form.badge-after-xhs', badge > 0, 'form-badge=' + badge)
  } else {
    record('form.post-xhs', false, '无形式选择按钮（当前面板未实现）')
    record('form.flow-after-xhs', false, '无形式选择按钮')
    record('form.badge-after-xhs', false, '无形式选择按钮')
  }

  // ---- 选形式即开工：期 e not_started + 未设形式 ----
  await openItem(page, 'ep-e-autoprep')
  const autoPicker = await page.locator('#form-card [data-act="set-form"][data-form="xhs"]').count()
  if (autoPicker > 0) {
    stub.statusPosts.length = 0
    await page.click('#form-card [data-act="set-form"][data-form="xhs"]')
    await page.waitForSelector('#flow-card', { timeout: 4000 })
    const autoPosted = stub.statusPosts.find((p) => p && p.slug === 'ep-e-autoprep' && p.form === 'xhs')
    const autoFlow = await page.locator('#flow-card').count()
    const autoPill = await page.locator('.dtitle-row .pill').first().innerText().catch(() => '')
    const autoOk = Boolean(autoPosted && autoPosted.form === 'xhs' && autoPosted.status === 'preparing' && autoFlow > 0 && autoPill.indexOf('准备中') >= 0)
    record(
      'form.autoprep',
      autoOk,
      (autoPosted ? JSON.stringify(autoPosted) : 'stub 未收到 ep-e-autoprep form=xhs') + ' flow=' + autoFlow + ' pill=' + autoPill,
    )
  } else {
    record('form.autoprep', false, '无形式选择按钮')
  }

  // ---- 动线：期 b xhs ----
  await openItem(page, 'ep-b-xhs')
  const flowB = await page.locator('#flow-card').count()
  record('flow.xhs.visible', flowB > 0, 'flow-card=' + flowB)
  const stageState = await page.evaluate(() => {
    const card = document.getElementById('flow-card')
    if (!card) return null
    const stages = Array.from(card.querySelectorAll('.vstage')).map((el) => ({
      key: el.getAttribute('data-stage') || el.textContent.trim(),
      done: el.classList.contains('done'),
      text: el.textContent.replace(/\s+/g, ' ').trim(),
    }))
    const copyBtns = Array.from(card.querySelectorAll('[data-act="copy-flow"]')).map((el) => ({
      copy: el.getAttribute('data-copy') || '',
      text: el.textContent.trim(),
    }))
    const chain = (card.querySelector('.flow-chain') || {}).textContent || ''
    return { stages, copyBtns, chain: String(chain) }
  })
  if (stageState) {
    const byKey = {}
    for (const s of stageState.stages) byKey[s.key] = s
    const topicDone = byKey.topic ? byKey.topic.done : stageState.stages.some((s) => /定选题/.test(s.text) && s.done)
    const copyDone = byKey.copy ? byKey.copy.done : stageState.stages.some((s) => /文案/.test(s.text) && s.done)
    const coverDone = byKey.cover ? byKey.cover.done : stageState.stages.some((s) => /封面/.test(s.text) && s.done)
    record('flow.xhs.topic-todo', topicDone === false, JSON.stringify(stageState.stages))
    record('flow.xhs.copy-done', copyDone, '文案应就绪')
    record('flow.xhs.cover-todo', coverDone === false, '封面应待做 coverDone=' + coverDone)
    const joined = stageState.copyBtns.map((b) => b.copy).join('\n---\n')
    const cmdOk = stageState.copyBtns.some((b) => String(b.copy).indexOf('/content ') >= 0 && String(b.copy).indexOf('jiaoyifu-xiaohongshu-content') >= 0)
    record('flow.xhs.copy-cmd', cmdOk, 'cmds=' + joined.replace(/\n/g, ' | ').slice(0, 240))
    record('flow.xhs.chain-note', /asking|角色链|xiaohongshu/i.test(stageState.chain), stageState.chain.slice(0, 160))
  } else {
    record('flow.xhs.topic-todo', false, '无动线卡')
    record('flow.xhs.copy-done', false, '无动线卡')
    record('flow.xhs.cover-todo', false, '无动线卡')
    record('flow.xhs.copy-cmd', false, '无动线卡')
    record('flow.xhs.chain-note', false, '无动线卡')
  }

  // ---- 动线：期 c video 四阶段点亮 ----
  await openItem(page, 'ep-c-video')
  const videoStages = await page.evaluate(() => {
    const card = document.getElementById('flow-card')
    if (!card) return null
    return Array.from(card.querySelectorAll('.vstage')).map((el) => ({
      key: el.getAttribute('data-stage') || '',
      done: el.classList.contains('done'),
      text: el.textContent.replace(/\s+/g, ' ').trim(),
    }))
  })
  if (videoStages) {
    const lit = ['voice', 'subs', 'storyboard', 'compose'].every((k) => videoStages.some((s) => s.key === k && s.done))
      || ['配音', '字幕', '分镜', '合成'].every((name) => videoStages.some((s) => s.text.indexOf(name) >= 0 && s.done))
    record('flow.video.four-lit', lit, JSON.stringify(videoStages))
    const packTodo = await page.locator('#flow-card [data-todo="pack"]').count()
    record('flow.video.pack-todo', packTodo > 0, '发布包待做=' + packTodo)
  } else {
    record('flow.video.four-lit', false, '无动线卡')
    record('flow.video.pack-todo', false, '无动线卡')
  }

  // ---- 从任务弹窗 ----
  await ensureSideOpen(page)
  await page.click('.side [data-act="from-task"]')
  await page.waitForSelector('#from-task-mask')
  const modalOpen = await page.locator('#from-task-mask .modal').count()
  record('modal.open', modalOpen > 0, 'modal=' + modalOpen)
  await page.click('#from-task-mask [data-act="close-from-task"]')
  await page.waitForTimeout(80)
  const modalClosed = await page.locator('#from-task-mask').count()
  record('modal.close', modalClosed === 0, 'mask=' + modalClosed)

  // ---- 左侧列表可滚 ----
  await ensureSideOpen(page)
  const listScroll = await page.evaluate(() => {
    const el = document.getElementById('items')
    if (!el) return { ok: false }
    el.scrollTop = 0
    const before = { scrollH: el.scrollHeight, clientH: el.clientHeight, top: el.scrollTop }
    el.scrollBy(0, 300)
    return { ok: true, before, afterBy: el.scrollTop, overflowed: before.scrollH > before.clientH }
  })
  record('list.scroll', Boolean(listScroll.ok && listScroll.overflowed && listScroll.afterBy > 0), JSON.stringify(listScroll))
  await page.screenshot({ path: join(SCREEN_DIR, 'jiaoyifu-studio-e2e-list.png') })

  // ---- 窄视口：侧栏抽屉 + 详情滚动区高度 ----
  const nContext = await browser.newContext({ viewport: NARROW_VIEWPORT })
  const nPage = await nContext.newPage()
  await nPage.goto(url, { waitUntil: 'domcontentloaded' })
  await nPage.waitForFunction(() => {
    const el = document.querySelector('.dslug')
    return el && el.textContent === 'ep-d-gzh'
  })
  await nPage.waitForSelector('#tab-body')
  await nPage.waitForTimeout(80)
  const nMeas = await nPage.evaluate(() => {
    const el = document.getElementById('tab-body')
    if (!el) return { ok: false }
    el.scrollTop = 0
    const clientH = el.clientHeight
    const scrollH = el.scrollHeight
    el.scrollBy(0, 400)
    return { ok: true, clientH, scrollH, afterBy: el.scrollTop }
  })
  record(
    'narrow.scroll',
    Boolean(nMeas.ok && nMeas.clientH >= 280 && nMeas.afterBy > 0),
    JSON.stringify(nMeas),
  )
  await nPage.screenshot({ path: join(SCREEN_DIR, 'jiaoyifu-studio-e2e-narrow.png') })

  const sideSnap = () => nPage.evaluate(() => {
    const side = document.querySelector('.side')
    const body = document.getElementById('tab-body')
    const cs = side ? getComputedStyle(side) : null
    return {
      sideDisplay: cs ? cs.display : 'missing',
      sideH: side ? side.clientHeight : 0,
      tabH: body ? body.clientHeight : 0,
      open: document.body.classList.contains('side-open'),
    }
  })
  const beforeDrawer = await sideSnap()
  const toggleVisible = await nPage.locator('#side-toggle').isVisible()
  if (toggleVisible) {
    await nPage.click('#side-toggle')
    await nPage.waitForTimeout(80)
    const openedDrawer = await sideSnap()
    await nPage.click('#side-toggle')
    await nPage.waitForTimeout(80)
    const closedDrawer = await sideSnap()
    const drawerOk = beforeDrawer.sideDisplay === 'none'
      && openedDrawer.sideDisplay !== 'none'
      && openedDrawer.sideH > 0
      && openedDrawer.open
      && closedDrawer.sideDisplay === 'none'
      && !closedDrawer.open
      && closedDrawer.tabH >= 280
      && Math.abs(closedDrawer.tabH - beforeDrawer.tabH) <= 8
    record('narrow.drawer-toggle', drawerOk, JSON.stringify({ beforeDrawer, openedDrawer, closedDrawer }))
  } else {
    record('narrow.drawer-toggle', false, '顶栏无 ☰ 内容库按钮')
  }
  await nContext.close()

  await browser.close()
  await stub.close()

  const failed = results.filter((r) => !r.pass)
  console.log('')
  console.log(failed.length === 0
    ? 'ALL PASS  (' + results.length + ' checks)'
    : 'FAILED  ' + failed.length + '/' + results.length)
  process.exit(failed.length === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('e2e crashed:', err)
  process.exit(2)
})
