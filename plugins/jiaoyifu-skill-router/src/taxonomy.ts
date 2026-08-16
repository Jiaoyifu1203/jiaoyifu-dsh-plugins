/**
 * jiaoyifu-skill-router · 分类引擎
 * 确定性关键词分类（中英双语），零模型调用、零 token 成本。
 * 升级自 dsh-skillport / dsh-skills 的思路：技能目录不应只按来源平铺，
 * 而应按「用途」自动归类，形成可读、可路由、可检索的分类索引。
 */

export interface CategoryDef {
  key: string
  label: string
  keywords: string[]
}

/** 分类体系 —— 按 jiaoyifu 技能库的实际构成调校（开发/内容/设计/调研/角色视角…） */
export const CATEGORIES: CategoryDef[] = [
  {
    key: 'dev',
    label: '开发工程',
    keywords: [
      '代码', '编程', '开发', '调试', '测试', '重构', '前端', '后端', 'api', '数据库',
      'sql', 'git', 'commit', 'review', 'bug', '部署', '构建', '架构', '插件',
      '命令行', 'cli', '终端', 'shell', '沙箱', 'sdk', '类型', '编译', '性能', '安全',
      '单元测试', 'react', 'vue', 'html', 'css', 'python', 'node', '仓库', '分支', '合并',
      'explain-code', 'smart-explore', 'debug', 'refactor', 'test-first', '计划', '实施'
    ],
  },
  {
    key: 'content',
    label: '内容创作',
    keywords: [
      '写作', '文案', '文章', '公众号', '小红书', '抖音', '视频', '脚本', '选题', '标题',
      '直播', '爆款', '拆解', '口播', '逐字稿', '封面', '钩子', '短视频', '长文', '写',
      '品牌故事', '带货', '种草', '笔记', '推文', '内容', '创作', '脚本审校', 'humanizer',
      'ai味', '审校', 'proofreading', '编辑', '配图', 'emoji', 'news', 'briefing',
      'animation', 'collage', '新闻', '日报', '简报'
    ],
  },
  {
    key: 'design',
    label: '设计UI',
    keywords: [
      '设计', 'ui', 'ux', '海报', 'banner', 'logo', 'brand', '品牌视觉', '配色', '排版', '图标',
      '原型', '视觉', 'design', '风格', '界面', '前端设计', '组件', '布局', '字体',
      '交互', '动效', 'bayer', 'scher', 'sato', 'hara', '幻灯片设计', '网页设计'
    ],
  },
  {
    key: 'research',
    label: '调研检索',
    keywords: [
      '搜索', '调研', '研究', '竞品', '行业', '学术', '情报', '爬虫', '采集', '热点',
      '资料', '检索', '市场', '分析', 'research', 'search', 'crawl', 'x搜索', '推特',
      'rss', '来源', '证据', '查一下', '网上找', '选题池', '素材库', '评论', '争议'
    ],
  },
  {
    key: 'perspective',
    label: '角色视角',
    keywords: [
      'perspective', '视角', '思维框架', '心智模型', '风格模仿', '扮演', '决策启发',
      '思维顾问', '怎么看', '模式', '表达dna', '启发式'
    ],
  },
  {
    key: 'ops',
    label: '运营管理',
    keywords: [
      '运营', '方案', '规划', '周报', '日报', '复盘', 'okr', '战略', '管理', '工作规划',
      '汇报', '增长', '目标', '计划', '排期', 'kpi', '流程', 'sop', '工作流', '项目管理',
      '任务', 'sprint', '优先级', '闭环', '诊断', '组织', '客户', '销售', '话术'
    ],
  },
  {
    key: 'product',
    label: '产品规划',
    keywords: [
      '产品', 'roadmap', '路线图', 'pre-mortem', '事前验尸', '风险分析', 'jtbd',
      '用户旅程', 'customer journey', '触点', '用户故事', 'user story', 'persona',
      '人物画像', '机会', 'opportunity', '需求', 'prd', '产品需求', '发布计划',
      'launch', '发布前', 'discovery', '探索', 'outcome', '结果导向', '执行计划',
      '实施计划', 'plan', 'make-plan', '规划工具', '产品经理', '路线', '里程碑',
      '项目历史', 'timeline', '时间线', '技能创建', 'create-skill'
    ],
  },
  {
    key: 'hr',
    label: '求职人力',
    keywords: [
      '简历', '面试', '招聘', 'jd', '人才', '述职', '候选人', '简历构建', '面试备考',
      'resume', 'interview'
    ],
  },
  {
    key: 'office',
    label: '办公文档',
    keywords: [
      'ppt', '演示', '幻灯片', 'excel', '表格', 'pdf', 'word', '文档', '仪表盘',
      '可视化', '图表', '汇报材料', '白皮书', 'markdown', '导出', '数据报表', '大屏'
    ],
  },
  {
    key: 'finance',
    label: '投资金融',
    keywords: [
      'etf', '股票', '投资', '估值', '财报', '金融', '基金', '买入', '行情', '理财',
      '券商', '仓位', '股息'
    ],
  },
  {
    key: 'knowledge',
    label: '知识学习',
    keywords: [
      '学习', '教学', '读书', '课程', '教育', '解释', '讲解', '论文', '费曼', '精读',
      '微信读书', '书架', '笔记', '划线', '培训', '讲课', '演讲', '分享', '知识库'
    ],
  },
  {
    key: 'ai-tools',
    label: 'AI工具',
    keywords: [
      '提示词', '生图', '文生图', '视频生成', '图像', '多模态', 'prompt', '模型',
      '数字人', 'tts', '语音', '转录', 'libtv', '理解图片', '文生视频', 'ai生成',
      'figma', 'lottie'
    ],
  },
  {
    key: 'utility',
    label: '效率工具',
    keywords: [
      '转换', '提醒', '日历', '清理', '健康', '备份', '通知', '文件整理', '电脑管家',
      '磁盘', '压缩', '编码', '正则', '时间', '待办', '闹钟', '剪贴', '上传', '附件'
    ],
  },
]

/** 停用词 —— 过滤高频无信息量 token，避免噪声命中 */
const STOP = new Set([
  '这个', '那个', '一个', '什么', '怎么', '如何', '帮我', '一下', '进行', '可以',
  '需要', '使用', '我们', '你们', '他们', '因为', '所以', '但是', '然后', '就是',
  '还是', '或者', '以及', '关于', '对于', '应该', '可能', '一些', '比如', '例如',
  '如果', '没有', '已经', '现在', '今天', '明天', '不要', '不是', '知道', '觉得',
  '希望', '想要', '能够', '这些', '那些', '还有', '其他', '的', '了', '是', '在',
  '有', '和', '与', '不', '我', '你', '他', '她', '它', '们', '这', '那', '就',
  '都', '也', '要', '会', '能', '想', '让', '给', '把', '被', '从', '到', '对',
  'the', 'and', 'that', 'this', 'with', 'from', 'have', 'your', 'what', 'are',
  'you', 'for', 'can', 'need', 'use', 'when', 'how', 'get', 'make', 'all', 'out',
  'our', 'their', 'will', 'about', 'which', 'into', 'would', 'there', 'here',
])

/**
 * 切词：英文取 ≥3 字符的单词；中文取二元组（bigram）+ 单字。
 * 返回去停用词、去重后的 token 列表。
 */
export function tokenize(text: string): string[] {
  const out: string[] = []
  const low = text.toLowerCase()
  const en = low.match(/[a-z][a-z0-9-]{2,}/g) ?? []
  for (const t of en) out.push(t)
  const cjk = text.match(/[\u4e00-\u9fff]+/g) ?? []
  for (const run of cjk) {
    if (run.length === 1) {
      out.push(run)
      continue
    }
    for (let i = 0; i < run.length - 1; i++) out.push(run.slice(i, i + 2))
  }
  const seen = new Set<string>()
  return out.filter((t) => {
    if (STOP.has(t) || seen.has(t)) return false
    seen.add(t)
    return true
  })
}

export interface Classifiable {
  name: string
  description?: string
  whenToUse?: string
}

export interface Classification {
  category: string
  label: string
}

/**
 * 精确名称覆盖：关键词无法区分的泛名技能（do/help/create-skill 等）固定归位。
 * 只放「名字太泛、词面不可判」的技能；新增泛名技能时在此登记。
 */
const NAME_OVERRIDES: Record<string, string> = {
  // ---- 泛名技能固定归位（名字太泛、词面不可判）----
  'make-plan': 'product',
  'do': 'product',
  'pre-mortem': 'product',
  'outcome-roadmap': 'product',
  'customer-journey-map': 'product',
  'jobs-to-be-done': 'product',
  'timeline-report': 'product',
  'create-skill': 'product',
  'help': 'product',
  // ---- 防止 product 关键词误吸：通用画图工具与上线 QA 留在开发工程 ----
  'flowchart-creation': 'dev',
  'jiaoyifu-pre-launch-qa': 'dev',
  // ---- 分类 v3 诊断修正：噪声词（ui/cli/review/code 等）造成的错位 ----
  'chronicle': 'utility',
  'using-superpowers': 'utility',
  'brainstorming': 'product',
  'user-stories': 'product',
  'prioritization-frameworks': 'product',
  'imagine': 'ai-tools',
  'gif-sticker-maker': 'design',
  'slides': 'design',
  'check-work': 'dev',
  'explain-code': 'dev',
  'smart-explore': 'dev',
  'jiaoyifu-kb-audit': 'content',
  'jiaoyifu-chief-intel-officer': 'research',
  'jiaoyifu-course-darwin': 'knowledge',
  'jiaoyifu-daily-review': 'ops',
  'dingtalk-ai-table-kb-builder': 'knowledge',
  'knowledge-base-upgrade': 'knowledge',
}

/** 视角类标记词：预判时需命中 ≥2 个（防止描述里一句「XX视角」就把工具错杀成角色扮演） */
const PERSPECTIVE_MARKERS = ['视角', '思维框架', '心智模型', '思维顾问', '决策启发', '启发式', '表达dna', '怎么看']

/** 判断是否为角色视角技能：-perspective 后缀，或视角类标记词 ≥2 个。 */
function isPerspectiveSkill(name: string, desc: string, when: string): boolean {
  if (/-perspective$/i.test(name)) return true
  const text = `${desc} ${when}`.toLowerCase()
  let hits = 0
  for (const marker of PERSPECTIVE_MARKERS) {
    if (text.includes(marker.toLowerCase())) hits += 1
  }
  return hits >= 2
}

/**
 * 对单个技能分类：perspective 后缀/标记词优先，其余按关键词加权投票。
 * 名称命中权重 3，描述/触发语命中权重 1。
 */
export function classify(entry: Classifiable): Classification {
  const name = entry.name ?? ''
  const desc = entry.description ?? ''
  const when = entry.whenToUse ?? ''
  if (isPerspectiveSkill(name, desc, when)) {
    return { category: 'perspective', label: '角色视角' }
  }
  const override = NAME_OVERRIDES[name]
  if (override) {
    const cat = CATEGORIES.find((c) => c.key === override)
    if (cat) return { category: cat.key, label: cat.label }
  }
  const nameLow = name.toLowerCase()
  const textLow = `${desc} ${when}`.toLowerCase()
  let best = 'other'
  let bestLabel = '其他'
  let bestScore = 0
  for (const cat of CATEGORIES) {
    let score = 0
    for (const kw of cat.keywords) {
      if (nameLow.includes(kw.toLowerCase())) score += 3
      else if (textLow.includes(kw.toLowerCase())) score += 1
    }
    if (score > bestScore) {
      bestScore = score
      best = cat.key
      bestLabel = cat.label
    }
  }
  return { category: best, label: bestLabel }
}

/**
 * 对查询文本推断所属分类；命中不足时返回 null（不参与加权）。
 */
export function classifyQuery(text: string): Classification | null {
  const tokens = tokenize(text)
  let best: Classification | null = null
  let bestScore = 0
  for (const cat of CATEGORIES) {
    let score = 0
    for (const kw of cat.keywords) {
      if (text.toLowerCase().includes(kw.toLowerCase())) score += 2
    }
    if (score > bestScore) {
      bestScore = score
      best = { category: cat.key, label: cat.label }
    }
  }
  // 至少两处命中才算可信
  return bestScore >= 2 ? best : null
}
