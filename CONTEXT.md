# CONTEXT · DeepSeek Harness + Pi

## 全局约束（最高优先级 · 2026-08-18 生效）

- **所有执行类型的工作交付子代理操作**：父代理不亲自写文件、跑命令、改代码、调研、实现、验证、交付；
  整包委派走 `model_agent`，扫描/检索/核对走 `scout`，带上下文子任务走 `subagent`/`subagent_fork`。
- 父代理职责：理解需求、规划拆分、写自包含交接包、委派、核对验收、合并交付；DSH 插件工具环节
  （content_*/track_*/vision_*/skill_*/scout 等）由父代理代办。
- 委派前一句话报执行模型（默认落盘 `~/.dsh/model-agent.json`）；未配置默认模型先 ask_user_question 让用户选。
- 豁免：读约束/上下文文件、核对交付、写交接包、插件代办、汇报——非执行类，父代理可直接做。
- 权威载体：环境级 `~/.dsh/AGENTS.md`（DSH 全部会话自动加载）；本工作区 `AGENTS.md` 为其投影；冲突时以环境级为准。
- 2026-08-18 增补（与知识库协议同步）：开场任务识别门禁（识别卡格式对齐 claude桌面版/AGENTS.md §3，任务ID 走 track 账本 ISS-xxx，用户确认后执行）+ 收尾门（标准句「是否进入收尾流程？」，三档 Micro/Light/Full 对齐 gate-close v2.9）；DSH 不进 Codex 任务总线（不跑 launcher、不写 route_events.jsonl、不造 TASK-xxx）。

状态：Pi 已通（/login DeepSeek 后 V4 可选）。dsh 走官方 `npx @deepseek-ai/dsh web`，启动脚本是 `scripts/start-web.sh`。不克隆源码仓。

## 2026-08-19 面板修复升级：滚动根因修复+形式分流动线+e2e 测试基建

- 滚动根因：`.detail` 缺 `min-height:0`/`overflow:hidden`，`#tab-body` 被内容撑开（scrollHeight===clientHeight）却仍是 `overflow:auto` 滚轮接收者，视频/脚本/字幕/文章长 Tab 滚不动；修复后五 Tab `scrollTop>0`。
- 形式分流：`meta.form=xhs|gzh|video`，`content_status` + `POST /api/status` 双写入；概览①三选一 / ②制作动线复用知识库产线（xiaohongshu-content / article / video-script-forge）。
- e2e：`scripts/panel-e2e.mjs`（stub 直测 PANEL_HTML + 系统 Chrome，playwright 装 `.tmp-tooling` 不进 git）。
- 提交哈希：`6517f8c`（origin/main，完整 `6517f8c4e72ed21ea018e5cebc2fafc92ac42f11`）。已推送。


## 2026-08-19 内容工作台升级：工作->内容桥（jiaoyifu-studio 收割器落地）

- 做了什么：jiaoyifu-studio 新增任务收割器，把 track 任务产出自动建成一期内容（topic.md 素材包）。
- 四源素材包：任务账本 + 任务线验收 + git 提交 + CONTEXT.md 日期锚点；工具 `content_from_task`，面板「⚡ 从任务」走 `/api/tasks` + `/api/from-task`。
- 双向关联：episode `meta.sourceTask` ↔ 任务 ID（上限 10）；收尾门提示是否收割为内容选题，建议 `track_update` 回链。
- 收尾门联动：`~/.dsh/AGENTS.md` §3 新增第 4 条；`jiaoyifu-task-paradigm` PROTOCOL_TEXT【收尾·状态】追加收割提示。
- 提交哈希：待 push 后补。

## 2026-08-19 widget-dock 自适应补丁（社区插件本地定制首例）

- 动因：widget-dock 卡片显示门槛 180px 空白，窄窗口全收起只剩右缘小竖条（用户实测「必须全屏才能看到」），要求自适应。
- 改动：`node_modules/widget-dock/lib/client.js` bundle 直改：门槛 `DECK_MIN_VISIBLE=120`、空白<`DECK_COMPACT(220)` 紧凑单列流式、安全边距 26/8px 条件收窄；宽窗口多列/拖拽/尺寸档零回归。
- 耐久化（node_modules 不进 git）：`scripts/patch-widget-dock.mjs` 幂等重放（标记 `jiaoyifu-patch: adaptive-deck v1`，精确字符串匹配，任一失败不写半补丁）+ `install-community-plugins.sh` 末尾自动跑 + `plugins/README.md` 说明；原版备份 `.tmp-tooling/widget-dock-client.orig.js`。
- 要点：DSH serveBundle 按请求读盘 + no-cache -> 改插件 bundle 不用重启 3080，浏览器硬刷新即生效。

## 2026-08-18 命名规范统一：jiaoyifu-xxx（规则落盘 + 设施强制 + 知识库同步）

- 规则权威落点：`~/.dsh/AGENTS.md` §4（环境级，所有会话自动加载）；工作区 AGENTS.md 投影同步。
- 设施强制：`scripts/plugin-check.mjs` 新增 f.naming 检查--新插件目录必须 ^jiaoyifu-，存量 dsh-model-agent 白名单。
- 知识库：`AI知识体系/03-工具与方法/01-工具图谱/[L1] DeepSeek Harness与Pi速查` 关键事实表补「环境级规则文件 + 命名规范」两行（顺带补上 08-18 三件套缺的规则文件条目），修订/验证日期升 2026-08-18。
- 背景：jiaoyifu-task-paradigm 由 dsh- 前缀更名而来（commit 743ce6c），自此确立统一命名。

## 2026-08-18 任务交互范式落地：jiaoyifu-task-paradigm 四轴一线插件

- 起因：核查 GBrain 传言后确立方向--记忆/进化已有知识库体系承载，harness 的护城河在「任务交互范式」：推理接口/工具调用/长程状态/验证机制四轴拧成一条线（识别->配置->路由->执行->验证->收尾）。
- 交付：plugins/jiaoyifu-task-paradigm/（commit 0fb0592 新增、743ce6c 由 dsh- 前缀更名）--protocol 静态段(order 116.7) + taskline beacon 动态段(116.71) + 4 工具（taskline_begin/advance/verify/get）+ close 硬门（验收未全 pass 拒绝关闭）+ 状态落盘 ~/.dsh/taskline.json（上下文压缩后可恢复）。
- 三账本分工：track=多任务账本（ISS 注册表）、taskline=当前主线执行状态、goal=会话级目标；一个任务 ID 贯穿。
- 待办：④实测待重启（./scripts/start-web.sh）后用真实任务首单吃狗粮；grok 子代理收尾问句串台问题待重启后验证消失。

## 2026-08-18 DSH 环境治理三件套：启动器 + 环境级委派约束 + 识别/收尾门同步

- 启动器：根目录 `启动DeepSeekHarness.command`（Finder 双击 -> 自动开终端起服务 -> 轮询 3080 就绪后开浏览器；关窗即停服务）。
- 环境级全局约束（权威迁移）：`~/.dsh/AGENTS.md`（dsh rc.7 内置 agent-instructions 的 user-global 文件，文件名硬编码 AGENTS.md，
  全部 profile/工作区自动加载、改动即时生效）承载「执行类工作一律交付子代理」硬约束（model_agent 整包 / scout 扫描 / subagent_fork 带上下文）；
  本工作区 `AGENTS.md` 降为其投影。曾误把权威落在项目文件夹，用户纠正后迁移到环境级。
- 协议同步：~/.dsh/AGENTS.md §2 开场任务识别门禁（识别卡格式对齐 claude桌面版/AGENTS.md §3，任务ID 走 track 账本 ISS-xxx，
  用户确认后执行）+ §3 收尾门（标准句「是否进入收尾流程？」，Micro/Light/Full 三档对齐 gate-close v2.9）。
  边界：DSH 不进 Codex 任务总线（不跑 port_runtime_guard_launcher、不写 route_events.jsonl、不造 TASK-xxx）。
- 插件侧同步（需重启 `./scripts/start-web.sh` 生效）：dsh-model-agent systemPrompt 注入段补环境级约束 + 识别/收尾指引；
  cordis.yml grok `--rules` 强化（交付报告末尾禁止任何收尾/确认问句）。
- 踩坑：① grok 子代理会向上读到父级 claude桌面版/AGENTS.md（Codex 协议），交付末尾冒「是否进入收尾门」旧句；
  ACP 执行合同 + --rules 双重覆盖，强化版待重启验证。② user-global 规则文件名不可配置，改内容不改名。
- 知识库侧回写建议（超出本会话沙箱，留给用户/Codex 端）：L1 卡片《DeepSeek Harness与Pi速查》补「环境级规则文件 + 委派/识别/收尾三协议」条目；
  权威 daily 补 1-3 行；跨端复盘卡记 DSH 端协议已对齐知识库口径。

## 2026-08-18 P0/P1/P2 全量落地（委派 grok 四棒）

- 四棒委派落地：A=better-sidebar 焊接 + 3 社区插件；B=发布适配器 + 分镜；C=三层记忆 + 被动质检 + fallback + plugin-check；D=分镜关键词去重 + 全量终验 + 文档 + 提交。
- better-sidebar 裸包名接入：`package.json` 写 `file:` 链，cordis `name` 用裸包名（bundle id = entry name，社区 client.js 把 id 写死成包名）；`$DSH_HOME/profiles/node_modules` symlink 到本仓 `node_modules`（profile `createRequire` 才能 resolve）；启动参数 **`--patch` 必须在 `--port` 前**，否则 launcher 把 `--port` 当应用参数。禁止 `dsh plugin add`（社区包自带 `dsh.bundle.patch`，会双挂载）。
- 发布适配器铁律：`publish_pack` / `publish_draft` 只生成发布包、只填草稿，任何路径不点发布/提交/上传；`publishRpa` 默认 false。
- 分镜：`video_storyboard` 出 `storyboard.md`，合成能解析分镜表则 `composeMode=storyboard`（分段 mp4 + concat），否则 `legacy`；关键词零 API：长词（3 字+）优先、跨 n-gram 子串去重、区间重叠丢掉碎词、每镜 1–3 个。
- 三层记忆注入 45/35/20（L1 标题不截、FIFO 8、注入最近 3）；qc 异步 `setTimeout(0)` + 静默降级；llm-fallback 两处接入（studio qc 与 skill-router 词面低置信重排）；`npm run check:plugins`（`scripts/plugin-check.mjs`）。
- 生效：本机重启 `./scripts/start-web.sh`（插件无热加载；会话沙箱不能重启 3080）。
- 遗留：RPA 未实测（`publishRpa` 默认 false）、侧边栏 UI 点击验收待重启后人工、社区插件与 3080 实例共存待真实重启确认。

## 2026-08-18 插件生态扫描（X + GitHub）：结合效率方案

- 调研报告：`plugins/ECOSYSTEM-SCAN-20260818.md`（X API 四轮检索 + GitHub API 实测星数）。
- 核心发现：DSH 已长出生态——omdsh-dev 组织 30 仓 + dshfind.com 目录站，安装标准化
  `dsh plugin --profile web add <npm包>`；CC 生态高星模式多数已有对应物。
- 与工作台结合最直接的三个：DSH-better-sidebar（2038⭐，`ctx.betterSidebar.registerTab/registerFileViewer`
  服务化侧边栏，studio 面板可注册进去与文件/终端/Git 同屏；其生态还有 dsh-video-preview 内联视频预览）、
  widget-dock（27 张常显卡片：token/成本/上下文压力/待办/目标，让 token-doctor/track 数据全程可见）、
  MatrixMedia-cli + social-auto-upload（五平台发布适配器，RPA 只填草稿、人点发布，正好接 studio 二期）。
- 方案分三档落报告 P0/P1/P2：P0=装 better-sidebar（先内嵌浏览器零开发、再 registerTab 深整合）
  + widget-dock；P1=发布适配器 + 视频产线加分镜阶段；P2=mnemon 三层记忆升级 /content 注入、
  advisor 被动质检、llm-fallbacks 容错、plugin-check 自有插件体检。
- 待办：--patch 自装插件与社区 npm 插件的共存性需本机实测（better-sidebar 与 aionui-panel 有互斥逻辑，
  与本仓 cordis.yml patch 的关系未见文档）；装完需本机重启 start-web.sh（会话沙箱内不能重启 3080）。

## 2026-08-17 jiaoyifu-studio v1.1：视频生产流水线（升级自 MoneyPrinterTurbo）

- 需求：参考 https://github.com/harry0703/MoneyPrinterTurbo，在内容工作台内增加视频生产工作台（不是独立插件，长在 studio 里）。
- 流水线与本地化映射（零 API 铁律）：文案=script.md（对话写）-> 配音=macOS `say`（逐句 voice/NN.aiff，
  `afinfo` 实测时长，中文音色自动探测优先 Tingting/Meijia，新版 macOS 为 Eddy/Flo 等多语言音色，
  音色名带中文括号后缀、按 `zh_CN` locale 列解析）-> 字幕=按句时长累加 SRT（写 subs.srt，字幕 Tab 联动）
  -> 合成=ffmpeg（materials/ 图片按文件名序轮播或纯色底 + aac 配音 + amix BGM(0.25) + 烧字幕 PingFang SC，
  输出 video.mp4 即本期成片，+faststart 利于浏览器拖动）。
- 新文件：`plugins/jiaoyifu-studio/src/video.ts`（探测/切句/TTS/SRT/合成引擎，execFile 无 shell 注入面，
  合成失败自动降级重试：去字幕 -> 去 BGM）；store.ts 的 meta.json 增加 `video` 字段（stage/voice/sentences/durationSec）。
- 新工具 4 个：video_probe / video_voice / video_subs / video_compose；新路由 4 条：
  GET /api/video/status + POST /api/video/{voice,subs,compose}；/api/item 附 videoFacts。
- 面板视频 Tab 升级：成片播放器 + 流水线卡片（四阶段进度点 + 音色下拉 + ①②③ 按钮 + 分辨率/烧字幕/BGM 选项；
  busy 态防 8s 自动刷新打断；probe 缺 say/ffmpeg 时禁用按钮并给安装指引）。
- cordis.yml 新增 videoVoice/videoRate/videoResolution 配置；发布铁律不变（只写草稿）。
- 遗留：素材下载 API（Pexels/Pixabay key）、BGM 音乐库、whisper 转写已有成片字幕（可接 jiaoyifu-zhuzigao 技能）。
- 生效：本机终端重启 `./scripts/start-web.sh`（插件无热加载）。

## 2026-08-17 交互约定：全权委派 = model_agent（模型可切换，组合分工操作路径）

- 触发：用户说「用 grok agent 完成任务」「交给子代理」「全权委托」= 任务**全部**交给
  `model_agent` 子代理执行：读取、理解、调研、实现、验证、交付都由它做；父代理不拆子任务、不抢着做。
- 执行模型（首次选定后落盘 `~/.dsh/model-agent.json` 沿用，对话可换）：
  - `grok`：ACP 桥 grok CLI（登录账户 OAuth，无 API key）——原生工具集（bash/文件/web），继承工作目录；
  - `deepseek-v4-flash`：spawn 子代理——harness 全部工具，快·省档；
  - `deepseek-v4-pro`：spawn 子代理——harness 全部工具，主模型档。
- 模型协议：首次委派前用 ask_user_question 让用户选定（未配置时）；每次委派前一句话明确本次执行模型；
  沿用上次配置；用户说「换 XX 模型」→ `model_agent_config {model}` 或委派时传 `model` 参数（成为新默认）。
- 组合分工（铁律）：
  - **model_agent 子代理**：读文件、跑命令、调研、写代码、实现、验证、交付；
  - **父代理（deepseek）插件代办**：需要 DSH 插件工具
    （content_*/track_*/vision_*/skill_*/scout/skill_route/skill_catalog 等）的环节一律父代理调用完成——
    grok 子代理没有这些工具，不要让它去试；
  - 父代理其余职责：写自包含交接 prompt（目标+路径+验收标准+分工声明）、接收结果、核对验收。
- 标准操作路径（一次委托）：
  1. 报模型（未配置先问）→ 2. 打包交接 → 3. 调 `model_agent`（前台 one-shot）整包执行
  → 4. 父代理核对（未达标可二次委派）→ 5. 插件环节父代理补做 → 6. 合并交付用户。
- 完整协议已落技能 `skills/dsh-model-agent-delegation/SKILL.md`
  （link-skills.sh 链接后，skill-router 遇「用 grok agent / 全权委托 / 换模型」自动路由）。
- 2026-08-18 起升级为全局硬约束：执行类工作（含改一行代码）一律交付子代理，父代理不再直接做；权威载体是环境级 `~/.dsh/AGENTS.md`（本工作区 `AGENTS.md` 为其投影），见文件顶部「全局约束」。

## 2026-08-17 grok 接入演进：临时补丁 → cordis.yml 合并 → dsh-model-agent 插件

- 事故：`grok_agent` 曾是 `~/dsh-grok.patch.yml` 临时补丁，单独 `--patch` 启动时才有；
  改用 start-web.sh 重启后补丁没带上 → `Error: unknown tool "grok_agent"`（2026-08-17 11:53 连续两次）。
- 第一版修复：两段并入 `plugins/cordis.yml`（grok-acp-provider + grok-subagent-tool）。
- 第二版（现役）：委派升级为模型可切换插件 `plugins/dsh-model-agent/src/index.ts`，
  cordis.yml 保留 grok-acp-provider（grok 档后端），grok-subagent-tool 由插件取代：
  - 工具 `model_agent`：整包委派，模型解析顺序 = 参数 model → 落盘默认 → 首次引导用户选定；
  - 工具 `model_agent_config`：查询/设置默认模型（对话切换）；
  - 落盘 `~/.dsh/model-agent.json`（服务器进程写，不受会话沙箱限制）。
- 能力边界（ACP 固有）：grok 子进程自带原生工具、继承工作目录，但 DSH 插件工具宿主侧独占；
  flash/pro（spawn）子代理拥有 harness 全部工具。模型与权限在 `~/.grok/config.toml` 调。
- 生效：重启 `./scripts/start-web.sh` + 跑一次 `./scripts/link-skills.sh`（收录新委派技能）。
  旧 `~/dsh-grok.patch.yml` 已无用，可删。
- 备选（未采用）：spawn 子代理 + grok 模型 provider 可给 grok 大脑配全部 47 工具，需 xAI API key（用户明确不用）。

## 2026-08-16 jiaoyifu-studio 内容工作台（复刻 Oil Creator 笔记）

- 来源：小红书视频笔记《DeepSeek Harness 爆改自媒体工作台》（作者 oil欧呦，工作台 Oil Creator，2026-08-16 发布）。
  确证点：内容 Tab=本地目录映射、五 Tab（概览/视频/脚本/字幕/文章）、topic.md 选题卡、
  /firm content 绑定当前期为上下文、平台卡（小红书/B站/抖音/视频号/公众号）+ 同步走本机不走 API、封面/字幕/发布 skill 全集成。
- 本仓库实现 `plugins/jiaoyifu-studio/`（第 7 个插件）：
  - 目录规范：`<contentRoot>/<slug>/{meta.json,topic.md,script.md,subs.srt,article.md,cover.*,video.mp4}`，
    默认根 `~/.dsh/content`（cordis.yml contentRoot 可改）；meta 用 JSON（零依赖，不用 YAML）。
  - 工具：content_list / content_get / content_new / content_write / content_status / content_bind / content_unbind。
  - 斜杠：`/content <slug>` 绑定（落盘 ~/.dsh/studio-bind.json），`/studio` 给面板地址；
    绑定后 `agent/pre-step` 每轮注入该期上下文（≤600 字）。
  - 面板：`ctx.webServer.register` 挂 `/jiaoyifu/studio`（web profile host 服务；缺失时降级仅工具模式）。
    内联 HTML（panel.ts 模板字符串，面板 JS 禁反引号/${}）；mp4 支持 Range 请求（拖动进度条）。
  - 发布铁律：自动发布只写草稿（unpublished/draft/published），公开动作留给人；RPA 草稿发布二期。
- 生效：本机终端重启 `./scripts/start-web.sh`（插件无热加载）。

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

## 2026-08-16 OpenClaw 退役 + 飞书桥生效要点

- OpenClaw 全量退役：launchd 服务 `ai.openclaw.gateway` 已停；`~/.openclaw`、全局 npm 包（openclaw/clawhub）、home 脚本 openclaw-*.sh、plist 已移入废纸篓（命名 `*.openclaw-retired-20260816-103443`，Finder 可恢复）。
- 飞书通道迁移到 DSH：`jiaoyifu-feishu` 复用原 OpenClaw 的飞书自建应用（`cli_a9337098af78dbcd`，长连接模式），无需改飞书控制台。冒烟已验证「飞书长连接已启动」。
- ⚠️ 踩坑：dsh rc.6 的 `web` 子命令不接受父级 `--patch`（报 unknown option），必须 `npx --yes @deepseek-ai/dsh --profile web --patch plugins/cordis.yml`。start-web.sh 已改为此形式；此前 `dsh web --patch` 写法插件实际没加载。
- 插件新运行时依赖：`@deepseek-ai/dsh-agent`、`@deepseek-ai/dsh-session`、`@larksuiteoapi/node-sdk` 已装仓库根 package.json（沿契约 #1）。
- 本机 npm 全局缓存有 root 文件（EPERM）：本次全部用 `--cache .tmp-tooling/npm-cache` 绕过；根治需 `sudo chown -R 501:20 /Users/gerryyin/.npm`（未代执行）。

## 边界

- 这是实验运行时，不是第五生产端。任务总线、收尾门、SCOPE_KB 仍走 Desktop / Code / Hermes（OpenClaw 已于 2026-08-16 退役）。
- 密钥只走 `DEEPSEEK_API_KEY`，不写进仓库。
