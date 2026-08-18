# jiaoyifu 插件集（DSH）

为 DeepSeek Harness 定制升级的精简插件集 —— 每个插件都基于开源生态里已验证的方案
**升级开发**而来，默认零外部依赖、零 UI 构建、密钥只走环境变量。
自用插件统一 `jiaoyifu-` 命名；对外分享的独立插件用 `dsh-` 前缀（首个：`dsh-model-agent`）。

## 组成（8 个 TS 插件 + 1 个 grok ACP 桥 + 2 个技能）

| 插件 | 升级自 | 干什么 |
|---|---|---|
| `jiaoyifu-skill-router` | dsh-skillport / dsh-skills | 技能**自动分类**（14 分类落盘 `~/.dsh/skill-catalog.md`）+ **实时路由**（`skill_route` 工具 + 会话首轮/话题变化时自动注入 ≤3 行提示）+ 用量学习 + **工具自治**（维护插件自身的任务改推「直接改源码」）+ **LLM 兜底**（词面低置信时一次廉价模型重排 Top-8，结果缓存） |
| `jiaoyifu-token-doctor` | dsh-context-doctor | 每轮真实 system prompt 的 **token 审计**（`token_audit` 工具）、技能目录成本 Top-N、瘦身建议 |
| `jiaoyifu-track` | dsh-track | 轻量**项目管理**：任务生命周期（todo→done 必须显式确认）、决策账本、念头捕获墙、todo_write 自动同步 |
| `jiaoyifu-vision` | dsh-vision-router / modlens | **DeepSeek 多模态补充**：`vision_describe` / `vision_ocr` / `vision_compare` 走任意 OpenAI 兼容视觉端点 + `image_info` 本地零 token 解析 |
| `jiaoyifu-scout` | dsh-subagent-tools | **v4-flash 轻量扫描代理**：`scout` 工具把扫描/检索/批量核对类杂活分派给廉价子代理（只读工具集 read/glob/grep/bash/web_search），主模型 token 留给核心决策；自动分派指引段注入 system prompt |
| `jiaoyifu-feishu` | dsh-feishu-notify / OpenClaw 飞书通道 | **飞书机器人 → DSH 桥**：私聊消息转发给本机 DSH agent（同模型/技能/插件/工具），回复回传飞书；每用户独立会话、落盘 resume、/reset 重置；长连接模式无需公网；Secret 只走 FEISHU_APP_SECRET 环境变量 |
| `jiaoyifu-studio` | Oil Creator 内容工作台笔记 + MoneyPrinterTurbo 流水线（MIT） | **自媒体内容工作台 + 视频生产流水线（v1.2）**：内容库目录规范 + `content_*` 七工具 + `/content` 绑定 + 同源面板 `/jiaoyifu/studio`；**better-sidebar Tab**「内容工作台」+ `subs.srt` 预览器（client 半，`src/client.js`）；发布适配器 `publish_pack` / `publish_draft`（**铁律只填草稿**，不点发布）；分镜阶段 `video_storyboard` → `composeMode=storyboard`；三层记忆注入（45/35/20）；被动质检 `qc`（写 script/article 后异步、失败静默）；`llm-fallback` 容错；视频产线 `video_probe/voice/subs/storyboard/compose`（macOS `say` + `afinfo` + `ffmpeg`，零 API） |
| `dsh-model-agent` | 自研（dsh-tool-subagent 的 toolName 思路 + ACP 桥） | **模型可切换全权委派**：`model_agent` 工具整包委派任务，执行模型三档（grok 登录账户 ACP / deepseek-v4-flash / deepseek-v4-pro，后两档拥有 harness 全部工具）；首次选定落盘 `~/.dsh/model-agent.json` 沿用、每次委派报模型、对话可换（`model_agent_config`）；配套 `grok-acp-provider`（官方 `dsh-subagent-acp` 包）把 grok CLI 登录账户注册为子代理提供方，无需 API key |
| `jiaoyifu-ui-design`（SKILL） | frontend-design / ui-ux-pro-max / huashu-design | **UI 设计工作台**：风格库 → HTML 高保真 → 10 条美感门禁 |
| `dsh-model-agent-delegation`（SKILL） | 自研 | **委派组合分工协议**：grok 子代理负责读文件/跑命令/调研/实现，DSH 插件工具环节由父代理代办；模型选定/沿用/切换的完整操作路径 |

## 安装（本机，共 4 步）

> 注意：`cordis.yml` 里多数自研插件仍是本机绝对路径（DSH loader 要求），换机器/换目录后需把那些 `name:` 路径改掉再启动。`jiaoyifu-studio` 与 3 个社区插件改用裸包名，见下一步。

```bash
cd "/Users/gerryyin/本地/我的积淀/claude桌面版/deepseek-harness"

# 1. 技能接入：把 ~/.cc-switch/skills + ~/.claude/skills 里的全部技能链接进 DSH 原生扫描根
./scripts/link-skills.sh

# 2. 配置视觉端点（可选，不配也能用 image_info）
#    plugins/cordis.yml → jiaoyifu-vision.config.endpoint / model
#    API key 放环境变量 VISION_API_KEY（不进仓库）

# 3. 社区插件（better-sidebar / widget-dock / video-preview）+ studio 裸包名
#    等价：npm install --cache .tmp-tooling/npm-cache
#    不要 dsh plugin add（社区包自带 dsh.bundle.patch，会再 insert 一次导致双挂载）
bash scripts/install-community-plugins.sh

# 4. 重启 dsh web（加载插件与技能）
./scripts/start-web.sh
```

## 社区插件（npm 接入）

本仓 `--patch plugins/cordis.yml` 同时挂 3 个社区包（**裸包名 = bundle id = entry name**）。解析锚点是 profile，不是仓库根：`install-community-plugins.sh` 会把它们 symlink 到 `$DSH_HOME/profiles/node_modules`。

| 插件 | 来源 | 干什么 |
|---|---|---|
| `dsh-better-sidebar` | npm `dsh-better-sidebar`（omdsh-dev / DSH-better-sidebar） | 服务化侧边栏工作台（文件树 / 编辑器 / 终端 / Git）；开放 `ctx.betterSidebar.registerTab` / `registerFileViewer`。studio client 半向它注册「内容工作台」Tab 和 `subs.srt` 预览器 |
| `widget-dock` | npm `widget-dock`（MorGogh） | 对话两侧常显卡片：token / 成本 / 上下文压力 / 待办 / 目标 |
| `dsh-video-preview` | npm `dsh-video-preview` | 侧边栏内联视频预览（`.mp4` + HTTP Range 206），依赖 better-sidebar |

**安装**：`bash scripts/install-community-plugins.sh`（内部 `npm install --cache .tmp-tooling/npm-cache` + profile symlink）。也可只跑 `npm install --cache .tmp-tooling/npm-cache`，再靠 `start-web.sh` 启动前幂等 heal symlink。

**禁止** `dsh plugin add`：三包都带 `dsh.bundle.patch`，官方 add 会再 insert 一次 → 双挂载。

**studio Tab 用法**：重启后打开 Web UI → 侧边栏 `+` → 「内容工作台」（iframe `/jiaoyifu/studio`）。直链 `http://127.0.0.1:3080/jiaoyifu/studio` 仍可用（host 半不依赖 sidebar）。

## 插件体检

改完自研插件后跑一次集体检（零依赖，覆盖清单 / 相对导入 `.ts` / patch 格式等）：

```bash
npm run check:plugins
# 等价：node scripts/plugin-check.mjs
```

全绿才提交。社区 npm 包不在体检范围。

## 验收

1. 启动日志出现 4 条：`[jiaoyifu-skill-router] 技能目录已重建：N 个技能 / M 个分类` 等。
2. 会话里说「帮我看看现在有哪些技能分类」→ 模型调用 `skill_catalog`。
3. 发一个具体任务（如「帮我写小红书笔记」）→ 首轮自动出现【技能路由提示】。
4. 说「审计一下 token」→ `token_audit` 报告。
5. 粘贴/给一张图片路径 → `vision_describe`（需已配端点）。
6. 浏览器 Settings → Plugins 里能看到 7 个 jiaoyifu 插件。
7. 浏览器打开 `http://127.0.0.1:3080/jiaoyifu/studio` 看到内容工作台面板（新建一期 → 五 Tab 可用）。
8. DSH 会话里发 `/content <slug>` → 提示已绑定，后续对话自动带本期上下文。

## 目录结构

```
plugins/
  cordis.yml                  # 加载补丁（start-web.sh 自动 --patch）
  feishu.env                  # 飞书 App Secret（gitignore，start-web.sh 自动加载）
  ECOSYSTEM-SCAN-20260818.md  # 插件生态扫描（X + GitHub）
  jiaoyifu-skill-router/      # 核心：分类 + 路由
    src/{index,taxonomy,router,persist}.ts
  jiaoyifu-token-doctor/      # token 审计
  jiaoyifu-track/             # 项目管理
  jiaoyifu-vision/            # 多模态桥
  jiaoyifu-scout/             # v4-flash 扫描代理
  jiaoyifu-feishu/            # 飞书机器人 → DSH 桥
  jiaoyifu-studio/            # 自媒体内容工作台 + 视频生产流水线（内容库 + /content 绑定 + 同源面板 + say/ffmpeg 产线）
    package.json              # 裸包名 jiaoyifu-studio；exports["."] / exports["./client"]
    src/{index,store,panel,video,publish,memory,qc,llm-fallback}.ts
    src/client.js             # better-sidebar Tab + srt 预览器（client 半）
skills/
  jiaoyifu-ui-design/         # UI 设计工作台（SKILL.md）
scripts/
  link-skills.sh              # 技能链接同步
  start-web.sh                # 启动（自动 --patch + 社区包 symlink heal）
  install-community-plugins.sh # npm 装 3 社区包 + profile node_modules symlink
  plugin-check.mjs            # 自研插件体检（npm run check:plugins）
```

## 设计约定（jiaoyifu 铁律）

- **插件不想太多**：一个痛点一个插件；能用 Markdown 说清的不写 TS（所以 UI 设计是 SKILL 不是插件）。
- **零 UI 构建**：需要界面的插件走 `ctx.webServer` 路由 + 内联 HTML（`jiaoyifu-studio/src/panel.ts` 是模板字符串，无打包步骤；面板 JS 内禁用反引号与 `${`），不引入前端工具链。
- **零 token 确定性优先**：分类/路由/审计全部本地计算，不额外调模型。
- **密钥只走环境变量**：不进仓库、不进 cordis.yml。
- **数据落盘 ~/.dsh**：`skill-catalog.{json,md}`、`token-stats.json`、`track.json`、`content/`、`studio-bind.json`，跨会话可查。
- **升级不重造**：每个插件 README/头部注释标明升级自哪个开源项目。
