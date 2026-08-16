# CONTEXT · DeepSeek Harness + Pi

状态：Pi 已通（/login DeepSeek 后 V4 可选）。dsh 走官方 `npx @deepseek-ai/dsh web`，启动脚本是 `scripts/start-web.sh`。不克隆源码仓。

## 2026-08-15 jiaoyifu 插件集 v0.1（本仓库自研，升级自开源生态）

- 6 个 TS 插件（`plugins/jiaoyifu-*`，经 `plugins/cordis.yml` --patch 加载）：
  skill-router（技能自动分类+实时路由+用量学习）、token-doctor（token 审计）、
  track（项目管理：任务/决策/念头墙/todo 自动同步）、vision（多模态桥，端点配 cordis.yml，key 走 VISION_API_KEY）、
  scout（v4-flash 轻量扫描代理：ctx.subagents.start('spawn', {agentOptions:{provider,model}, persona, toolFilter, parent: exec.agent})，
  工具 scout 把扫描/检索/核对杂活分派给廉价子代理；provider 未就绪时靠 subagent/provider-added 事件挂载）、
  feishu（飞书机器人→DSH 桥：长连接私聊、每用户独立 agent 会话、落盘 resume、/reset 重置；Secret 只走 FEISHU_APP_SECRET，
  start-web.sh 自动加载 plugins/feishu.env，feishu.env 已 gitignore）。
- 1 个升级技能：`skills/jiaoyifu-ui-design`（UI 设计工作台，整合 frontend-design/ui-ux-pro-max/huashu-design）。
- 技能接入：`scripts/link-skills.sh` 已把 ~/.cc-switch/skills + ~/.claude/skills 共 138 个技能链接进 ~/.dsh/skills（原生扫描根）。
- 关键契约（踩坑记录）：
  1. loader 按插件文件位置解析 bare import → 运行时依赖（schemastery/dsh-tools/dsh-llm）必须装在仓库根 package.json；
  2. 相对导入必须带 `.ts` 扩展名（Node ESM 解析）；
  3. 工具参数 schema 的 `required` 只能省略或 true，写 false 会注册报错；
  4. 技能 provider 挂在 agent preset 层：宿主 scope 的 `ctx.skills.list()` 恒为空，
     必须 `list({ scope: exec.agent, cwd: exec.agent.session.header.cwd })`（与官方 skill 工具同款）；
  5. 注入技能提示用 `agent/pre-step` waterfall + createUserMessage（source kind: 'plugin'），
     `agent/request` 不能改 messages。
- 验证：`node lib/bin.js --profile web --dump-config --patch <cordis.yml>` 校验树；临时实例 `--port 0` 冒烟（已验证 4 插件全部加载）。
- 生效方式：本机终端重启 `./scripts/start-web.sh`（会话沙箱内不能重启 3080 实例）。
- 分类 v2：新增 `product` 产品规划分类（共 14 类）。9 个泛名技能走 NAME_OVERRIDES 精确锁位（make-plan/do/pre-mortem/outcome-roadmap/customer-journey-map/jobs-to-be-done/timeline-report/create-skill/help），顺带修正 5 个旧分类错误（create-prd、discovery-process、opportunity-solution-tree、planning-with-files、user-personas 归入 product）；flowchart-creation、jiaoyifu-pre-launch-qa 用覆盖锁回 dev。`other` 桶清零。已验证：product=14、dev=19。
- 主机插件源码无热加载（生产 npx 模式）：改 taxonomy.ts/index.ts 后必须重启 dsh web 生效。
- 路由 v3（工具自治 + LLM 兜底）：① isAutonomyTask 检测「维护插件本身」类任务（强词如 skill-router/分类器/taxonomy/分类词，弱词如 插件/维护 需 ≥2 命中），
  命中时注入/返回「直接改 plugins/ 源码」指引，不推业务技能；② skill_route 词面 Top1 得分 ≤ llmFallbackThreshold(30) 时，
  用一次廉价模型调用（默认 deepseek-official/deepseek-v4-flash，ctx.llm.stream + BlockAssembler）重排 Top-8，结果按查询缓存 64 条。
  注入路径（pre-step）保持零模型调用。自治检测 8/8 用例通过；v3 冒烟启动通过。
- 自治 v3.1（意图区分，修复「看看技能分类」误报）：MAINTENANCE_VERBS（改/修/加/删/调整/优化/升级/更新/维护/重构…）vs VIEW_VERBS
  （看看/查看/显示/列出/有哪些/总览…）——纯查看意图不触发自治；无动词+强名词默认自治。13/13 用例通过。
- 2026-08-16 小红书产链实战复盘（DSH 插件笔记，文案返工 3 轮收敛），已回灌技能：
  ① jiaoyifu-xiaohongshu-content v3.2：标题调研门（L2 锁题前必做平台内容调研）+ 人感铁律 6 条（先懂机制再写比喻/五问骨架/三清零/边界写作/标题公式）
     + 截图兜底（Chrome headless capture.sh）+ OCR 兜底（tesseract chi_sim + 像素墨迹验证大字行）；
  ② jiaoyifu-viral-decoder 结构库入库 VSL-20260815-001「五问实操实录（毛坯房→自己的工坊）」，索引四表同步（条目 0→1）；
  ③ 研究链路跑通：asking 1A→researcher（报告存 我的生产资料/04-AI·技术/）→7层角色链→M2（主情绪校准改变 L2 字段）→执行技能。
  产出目录：AI知识体系/05-内容生产/.../案例归档/小红书笔记/2026-08-15_手搓4个插件榨干DeepSeekHarness/（文案.md + 6卡 PNG + HTML + capture.sh）。
- 分类 v3（全量诊断后修复，21 个技能移动，diff 验证通过）：① perspective 预判收紧为「-perspective 后缀 或 视角类标记词 ≥2」，
  修复 poster-design→design、workplanning→ops、presentation-architect→office、content-darwin→content 四个错杀；
  ② dev 删英文 'code'（decoder/Codex 噪音）；③ content +news/briefing/animation/collage/新闻/日报/简报，design +brand，knowledge +知识库
  （daily-news-briefing、3d-animation、paper-collage、brand 自然归位）；④ NAME_OVERRIDES 新增 17 条锁位
  （chronicle/using-superpowers→utility，brainstorming/user-stories/prioritization-frameworks→product，imagine→ai-tools，
  gif-sticker-maker/slides→design，frontend-design→design（删 code 附带收益），chief-intel-officer→research，
  course-darwin/dingtalk-kb/knowledge-base-upgrade→knowledge，daily-review→ops，check-work/explain-code/smart-explore/kb-audit 原地锁位）。
  诊断脚本：.tmp-tooling/diagnose.mts。最终分布：perspective 29 / content 23 / product 17 / design 14 / dev 11 / research 11 / ops 11 / ai-tools 6 / knowledge 5 / utility 4 / office 4 / hr 2 / finance 1。

## 2026-08-14 dsh Web 部署

- 用户确认：官方 npx 启动 dsh web，不另目录克隆源码。
- 官方 README（master）：`npx @deepseek-ai/dsh web`，默认 `http://127.0.0.1:3080`。
- 启动后按官方 Web UI 指南：Settings → Models 填 key；Choose workspace 后才能发任务。
- 对话沙箱的 localhost 不是 Mac 浏览器，必须在本机终端跑 `scripts/start-web.sh`。

## 2026-08-14 路径更正

- 用户把项目从 `项目集合/04-产品与工具/deepseek-harness` 挪到 `/Users/gerryyin/本地/我的积淀/claude桌面版/deepseek-harness`。
- 终端执行、项目索引、L1/L3 卡片一律改用新地址。

## 2026-08-13 部署记录

- 用户确认：本机可跑 + 接进知识体系；文件落在工作区。
- 追加：Pi + DeepSeek V4 Pro / V4 Flash；安装 `pi-web-access`、`pi-subagents`。
- 官方 dsh 入口是 `npx @deepseek-ai/dsh web`，不把 1 万+ commit 的源码仓塞进知识库。
- 当前会话沙箱看不到 `/Users/gerryyin`，无法直接写本机 `~/.pi`；API key 环境变量未注入。
- 2026-08-14：本机 `pi` 报错找不到 `@earendil-works/pi-coding-agent`。原因是先装了已弃用的 `@mariozechner/pi-coding-agent@0.73.0`，而 `pi-subagents` 的 peer 已切到新包名。修复：卸旧装新到 `@earendil-works/pi-coding-agent@0.84.1`。
- 沙箱验收（写在会话 HOME，不是你的 Mac 家目录）：`pi --version` = 0.73.1；`pi --list-models deepseek` 列出 V4 Pro / V4 Flash；`pi install` 装上两个包；`dsh --help` 可跑。系统 npm 全局目录不可写，必须 `prefix=$HOME/.local`。

## 边界

- 这是实验运行时，不是第五生产端。任务总线、收尾门、SCOPE_KB 仍走 Desktop / Code / OpenClaw / Hermes。
- 密钥只走 `DEEPSEEK_API_KEY`，不写进仓库。
