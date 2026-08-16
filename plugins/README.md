# jiaoyifu 插件集（DSH）

为 DeepSeek Harness 定制升级的精简插件集 —— 每个插件都基于开源生态里已验证的方案
**升级开发**而来，统一 `jiaoyifu-` 命名，默认零外部依赖、零 UI 构建、密钥只走环境变量。

## 组成（6 个 TS 插件 + 1 个升级技能）

| 插件 | 升级自 | 干什么 |
|---|---|---|
| `jiaoyifu-skill-router` | dsh-skillport / dsh-skills | 技能**自动分类**（14 分类落盘 `~/.dsh/skill-catalog.md`）+ **实时路由**（`skill_route` 工具 + 会话首轮/话题变化时自动注入 ≤3 行提示）+ 用量学习 + **工具自治**（维护插件自身的任务改推「直接改源码」）+ **LLM 兜底**（词面低置信时一次廉价模型重排 Top-8，结果缓存） |
| `jiaoyifu-token-doctor` | dsh-context-doctor | 每轮真实 system prompt 的 **token 审计**（`token_audit` 工具）、技能目录成本 Top-N、瘦身建议 |
| `jiaoyifu-track` | dsh-track | 轻量**项目管理**：任务生命周期（todo→done 必须显式确认）、决策账本、念头捕获墙、todo_write 自动同步 |
| `jiaoyifu-vision` | dsh-vision-router / modlens | **DeepSeek 多模态补充**：`vision_describe` / `vision_ocr` / `vision_compare` 走任意 OpenAI 兼容视觉端点 + `image_info` 本地零 token 解析 |
| `jiaoyifu-scout` | dsh-subagent-tools | **v4-flash 轻量扫描代理**：`scout` 工具把扫描/检索/批量核对类杂活分派给廉价子代理（只读工具集 read/glob/grep/bash/web_search），主模型 token 留给核心决策；自动分派指引段注入 system prompt |
| `jiaoyifu-feishu` | dsh-feishu-notify / OpenClaw 飞书通道 | **飞书机器人 → DSH 桥**：私聊消息转发给本机 DSH agent（同模型/技能/插件/工具），回复回传飞书；每用户独立会话、落盘 resume、/reset 重置；长连接模式无需公网；Secret 只走 FEISHU_APP_SECRET 环境变量 |
| `jiaoyifu-ui-design`（SKILL） | frontend-design / ui-ux-pro-max / huashu-design | **UI 设计工作台**：风格库 → HTML 高保真 → 10 条美感门禁 |

## 安装（本机，共 3 步）

> 注意：`cordis.yml` 里的插件路径是本机绝对路径（DSH loader 要求），换机器/换目录后需把 6 处 `name:` 路径改掉再启动。

```bash
cd "/Users/gerryyin/本地/我的积淀/claude桌面版/deepseek-harness"

# 1. 技能接入：把 ~/.cc-switch/skills + ~/.claude/skills 里的全部技能链接进 DSH 原生扫描根
./scripts/link-skills.sh

# 2. 配置视觉端点（可选，不配也能用 image_info）
#    plugins/cordis.yml → jiaoyifu-vision.config.endpoint / model
#    API key 放环境变量 VISION_API_KEY（不进仓库）

# 3. 重启 dsh web（加载插件与技能）
./scripts/start-web.sh
```

## 验收

1. 启动日志出现 4 条：`[jiaoyifu-skill-router] 技能目录已重建：N 个技能 / M 个分类` 等。
2. 会话里说「帮我看看现在有哪些技能分类」→ 模型调用 `skill_catalog`。
3. 发一个具体任务（如「帮我写小红书笔记」）→ 首轮自动出现【技能路由提示】。
4. 说「审计一下 token」→ `token_audit` 报告。
5. 粘贴/给一张图片路径 → `vision_describe`（需已配端点）。
6. 浏览器 Settings → Plugins 里能看到 4 个 jiaoyifu 插件。

## 目录结构

```
plugins/
  cordis.yml                  # 加载补丁（start-web.sh 自动 --patch）
  jiaoyifu-skill-router/      # 核心：分类 + 路由
    src/{index,taxonomy,router,persist}.ts
  jiaoyifu-token-doctor/      # token 审计
  jiaoyifu-track/             # 项目管理
  jiaoyifu-vision/            # 多模态桥
skills/
  jiaoyifu-ui-design/         # UI 设计工作台（SKILL.md）
scripts/
  link-skills.sh              # 技能链接同步
  start-web.sh                # 启动（自动 --patch 插件集）
```

## 设计约定（jiaoyifu 铁律）

- **插件不想太多**：一个痛点一个插件；能用 Markdown 说清的不写 TS（所以 UI 设计是 SKILL 不是插件）。
- **零 token 确定性优先**：分类/路由/审计全部本地计算，不额外调模型。
- **密钥只走环境变量**：不进仓库、不进 cordis.yml。
- **数据落盘 ~/.dsh**：`skill-catalog.{json,md}`、`token-stats.json`、`track.json`，跨会话可查。
- **升级不重造**：每个插件 README/头部注释标明升级自哪个开源项目。
