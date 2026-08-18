# DSH 插件生态扫描 · 2026-08-18（X + GitHub）

> 目的：继续为 jiaoyifu 插件集（8 个）+ jiaoyifu-studio 工作台找优质插件参考，
> 回答「如何提升效率插件与工作台的结合效率」。
> 检索通道：X API（xAI/x_search）+ GitHub API 实测星数（2026-08-18）。

## 一、核心发现：DSH 已长出自己的插件生态

**omdsh-dev 组织（30 仓，DSH 社区插件集散地）** 与 **dshfind.com**（DSH 插件目录站，类 marketplace）。
安装方式已标准化：`dsh plugin --profile web add <npm包名>`。

### 1. 工作台底座类（与 studio 结合最直接）

| 插件 | 星 | 干什么 | 对我们的价值 |
|---|---|---|---|
| [DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) | 2038 | **服务化侧边栏工作台**：文件树+编辑器/内嵌浏览器/真实终端/Git 面板/后台任务页；开放 `ctx.betterSidebar.registerTab / registerFileViewer` 给三方插件注册页面 | 把 studio 面板嵌进主工作台（与文件/终端/Git 同屏）；其推荐目录里还有 `dsh-video-preview`（视频内联预览，HTTP Range 206 拖进度条，正好升级 studio 视频 Tab） |
| [widget-dock](https://github.com/MorGogh/widget-dock) | 4 | 对话两侧空白区 **27 张常显卡片**：余额/Token/成本/上下文压力/水位/热力图/待办/目标/快捷命令/灵感速记 | 让 token-doctor、track 的数据从「按需审计」变「全程可见」；估算卡(≈)与 token-doctor 精确审计互补 |
| [dsh-sidechain](https://github.com/omdsh-dev/dsh-sidechain) | 10 | /side 持续侧会话 + /btw 一次性侧问（fork 运行不污染主会话） | 写稿时临时问问题不打断 content 绑定上下文 |
| ex-setting / deepseek-harness-desktop | 2/8 | 设置扩展 / 桌面端打包 | 备选 |

### 2. 可靠性/质量类（效率插件升级参考）

| 插件 | 星 | 干什么 | 对我们的价值 |
|---|---|---|---|
| [dsh-mnemon](https://github.com/omdsh-dev/dsh-mnemon) | 82 | 三层记忆控制面（持久运行时上下文） | /content 绑定注入（现 ≤600 字/轮）升级为分层记忆，跨会话不丢 |
| [dsh-plugin-check](https://github.com/omdsh-dev/dsh-plugin-check) | 24 | 插件健康检查：清单协议/patch 格式/构建陷阱/hub 收录 | 自有 8 插件的体检器 |
| [dsh-advisor](https://github.com/omdsh-dev/dsh-advisor) | 11 | 第二模型被动评审每轮并注入笔记 | 内容链可挂 jiaoyifu-proofreading 做被动质检 |
| [dsh-deep-research](https://github.com/omdsh-dev/dsh-deep-research) | 14 | 自适应深度调研编排（官方 workflow 引擎） | jiaoyifu-research/hot-topic 链的编排参考 |
| [dsh-inspect](https://github.com/omdsh-dev/dsh-inspect) | 6 | checkup->fix->review 对抗式闭环 | darwin 质检链同构参考 |
| dsh-llm-fallbacks | 8 | 按角色的模型重试/降级策略 | skill-router LLM 兜底 + model-agent 的容错层 |
| dsh-toolkit（time/encoding/json/csv/regex/markdown/diff/stat） | 21 | 零依赖确定性小工具集 | 抄结构：一个包注册多个轻工具 |

### 3. 内容产线类（studio 二期直接可用）

| 项目 | 星 | 干什么 | 对我们的价值 |
|---|---|---|---|
| [AiToEarn](https://github.com/yikart/AiToEarn) | 24946 | AI 生成视频/图文 -> 抖音/小红书/B站/TikTok 一键分发 + 自动互动 | 「生产到分发全链自动化」的完整参照 |
| [social-auto-upload](https://github.com/dreammis/social-auto-upload) | 14300 | 多平台自动上传+定时（Playwright 适配器模式） | studio 发布二期的适配器写法：**RPA 只填草稿、人点发布**（铁律不破） |
| [MatrixMedia](https://github.com/hanliang97/MatrixMedia) (+cli) | 515 | vue+electron+puppeteer 批量发布：抖音/快手/百家号/B站/头条/视频号/小红书 | 覆盖我们五平台卡的全部平台；cli 版可被 agent 直接驱动 |
| [NarratoAI](https://github.com/linyqh/NarratoAI) | 10700 | 小说->解说视频：文案改写/多音色/字幕样式 | 长文转视频分步模板 |
| Short-Video-Factory | - | 提示词->**分镜素材包**->成片（桌面端） | 给 video 产线加「分镜」阶段：script.md -> 分镜表 -> materials/ 对位 |

### 4. Claude Code 生态（模式层借鉴）

高星代表：cc-switch(127.9k 多provider切换)、claude-code-router(36.7k 路由降级)、claude-code-templates(30.3k)、SuperClaude(23.8k)、ccusage(18k 用量)、claudecodeui(13.3k 面板直读真实配置)、spec-workflow(3.8k 规格驱动)、agents-observe(650 会话回放+agent树)。
X 上口碑最好的效率插件：**Headroom（token 压缩）、claude-mem（持久记忆）、OmniRoute（200+模型路由）、Task Observer（工作流学习）、Ralph Loop（DSH 已内置）**。
多数能力我们已有对应物（skill-router≈路由、token-doctor≈ccusage、model-agent≈router）；值得补的是 **Headroom 式上下文压缩** 与 **agents-observe 式会话回放/委派可视化**。

## 二、结合效率提升方案（按优先级）

> 2026-08-18 更新：P0/P1/P2 已全部实施落地，见 CONTEXT.md 同日条目。

**现状诊断**：效率插件（skill-router/token-doctor/track/scout/model-agent）是「工具层」，工作台（studio 面板+content 绑定）是「面板层」，两层目前只有 pre-step 注入一条细线；数据（token 成本、任务进度、产线状态）彼此看不见。

### P0 · 把两层焊在一起（本周可做，开发量小）
1. **装 DSH-better-sidebar**（`dsh plugin --profile web add dsh-better-sidebar`，与本仓 --patch 共存性需实测）：
   - 第一步零开发：用其内嵌浏览器 Tab 直接开 `/jiaoyifu/studio`，工作台与文件/终端/Git 同屏；
   - 第二步深整合：jiaoyifu-studio 增加 `ctx.betterSidebar.registerTab('内容工作台')`（插件存在才注册，缺失降级现状），
     再 `registerFileViewer` 支持 `subs.srt`（字幕时间轴高亮）/`meta.json`（产线状态卡）；
   - 顺带装 `dsh-video-preview`：studio 成片在侧边栏内联预览（Range 206 拖进度条，不受 20MB 限制）。
2. **装 widget-dock**：Token/成本/上下文压力常显 + 待办/目标卡与 track 联动；token-doctor 保留「精确审计」定位。

### P1 · 打通产线断点（studio 已规划项，找齐了参照）
3. **发布适配器**（MatrixMedia-cli / social-auto-upload 模式）：每平台一个适配器，agent 调用只到「草稿已填好」，发布按钮永远留给人。
4. **视频产线加「分镜」阶段**（Short-Video-Factory 模式）：script.md -> 分镜表（每镜画面关键词+素材需求）-> materials/ 对位轮播，替代现在「按文件名序盲轮播」。

### P2 · 效率插件升级（吸收生态做法）
5. dsh-mnemon 三层记忆 -> /content 绑定注入升级（选题卡常驻+脚本增量+归档摘要三层）。
6. dsh-advisor 模式 -> 内容链被动质检（写完 script.md 自动跑 proofreading 摘要注入下一轮）。
7. dsh-llm-fallbacks 模式 -> skill-router 兜底与 model-agent 加「按角色重试降级」。
8. dsh-plugin-check -> 每次改插件后跑一次自有插件集体检。
9. agents-observe 模式 -> 委派可视化：model_agent/scout 的父子 agent 树+工具调用时间线进面板（长期）。

## 三、数据来源清单

- X API · xAI/x_search · query="DeepSeek Harness 插件 工作台" · @I_am_oil_oil [status/2088776431161704762] · @geekbb [status/2088586751183102151] · @EatFishCatl [status/2088508928938422328] · @yangzhe1991 [status/2088960959700521318] · @tianyi [status/2084693319188439211] · 执行脚本=x-api-search
- X API · xAI/x_search · query="Claude Code plugins 推荐 效率" · @kaddisdeployed [status/2088515973653446748] · @DeRonin_ [status/2022992771078901913] · @arvidkahl [status/2031457304328229184] · 执行脚本=x-api-search
- X API · xAI/x_search · query="DSH better-sidebar widget-dock 插件 github" · @geekbb [status/2088586751183102151] · @dotey [status/2088059102131794012] · @oneruofeng [status/2088086799059128720] · @yistar04 [status/2088802651798667276] · 执行脚本=x-api-search
- X API · xAI/x_search · query="AI 自媒体 内容工作台 视频 一键发布 工作流" · @Smartpigai [status/2063887954712604802] · @Gas1688 [status/2088301119315575055] · @NFTCPS [status/2041086096168337482] · @daweifs [status/2089517689446555989] · 执行脚本=x-api-search
- GitHub API 实测：omdsh-dev 组织 30 仓、yikart/AiToEarn、dreammis/social-auto-upload、hanliang97/MatrixMedia、linyqh/NarratoAI、MorGogh/widget-dock（星数为 2026-08-18 快照）
- 原始 X 检索结果存档：/tmp/x_dsh.md、/tmp/x_dsh2.md、/tmp/x_cc.md、/tmp/x_content.md
