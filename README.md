# DeepSeek Harness + Pi

DeepSeek 官方 agent 运行时（`dsh`）和官方推荐的终端 harness（Pi）放在同一项目里。知识正文在 AI 知识体系；这里只留可执行入口和配置模板。

## jiaoyifu 插件集（本仓库自研，升级自开源生态）

`scripts/start-web.sh` 启动时自动通过 `--patch plugins/cordis.yml` 加载 8 个 TS 插件 + 2 个技能（另含 grok CLI ACP 桥配置）。详见 [plugins/README.md](plugins/README.md)。

| 插件 | 能力 |
|---|---|
| `jiaoyifu-skill-router` | 技能自动分类（14 类，落盘 `~/.dsh/skill-catalog.md`）+ 实时路由（`skill_route` 工具 + 会话内自动注入提示）+ 用量学习 + 工具自治（维护插件自身的任务改推「直接改源码」）+ LLM 兜底重排 |
| `jiaoyifu-token-doctor` | `token_audit` 上下文 token 审计 + 目录瘦身建议 |
| `jiaoyifu-track` | 项目管理：任务生命周期 / 决策账本 / 念头捕获墙 / todo_write 自动同步 |
| `jiaoyifu-vision` | 多模态补充：`vision_describe` / `vision_ocr` / `vision_compare` / `image_info`（端点配 `plugins/cordis.yml`，key 走 `VISION_API_KEY` 环境变量） |
| `jiaoyifu-scout` | v4-flash 轻量扫描代理：`scout` 工具把扫描/检索/核对类杂活分派给廉价子代理，主模型 token 留给核心决策 |
| `jiaoyifu-feishu` | 飞书机器人 → DSH 桥：私聊转发给本机 agent、回复回传飞书、每用户独立会话（Secret 走 FEISHU_APP_SECRET，不进仓库） |
| `jiaoyifu-studio` | 自媒体内容工作台（复刻 Oil Creator）+ 视频生产流水线（升级自 MoneyPrinterTurbo）：内容库目录规范 + `content_*` 工具 + `/content` 绑定上下文 + 同源面板 http://127.0.0.1:3080/jiaoyifu/studio（左列表 / 五 Tab / 平台卡 / 视频产线①配音②字幕③合成，本机 say+ffmpeg 零 API） |
| `dsh-model-agent` | 模型可切换全权委派：`model_agent` 整包委派，三档执行模型（grok 登录账户 ACP / v4-flash / v4-pro）；首次选定落盘沿用、对话可换；配套 `grok-acp-provider` 桥（无需 API key） |
| `jiaoyifu-ui-design`（SKILL） | UI 设计工作台：风格库 → HTML 高保真 → 10 条美感门禁 |
| `dsh-model-agent-delegation`（SKILL） | 委派组合分工协议：子代理干活、插件环节父代理代办、模型选定/沿用/切换路径 |

已有技能库接入（一次性）：`./scripts/link-skills.sh` 把 `~/.cc-switch/skills` + `~/.claude/skills` 全部链接进 `~/.dsh/skills`（当前 138 个）。新增技能后重跑该脚本即可。

## 部署 dsh Web UI（官方入口）

**最省事：Finder 里双击 `启动DeepSeekHarness.command`** —— 自动开终端、启动服务、就绪后弹出浏览器（默认 `http://127.0.0.1:3080`）。关闭该终端窗口即停止服务。冷启动 `npx`/插件编译可能要 1–3 分钟，转圈不是卡死；若 3080 已在跑，启动器会直接打开浏览器，不重复起第二个进程。

或者在本机终端执行，不要克隆源码仓：

```bash
cd "/Users/gerryyin/本地/我的积淀/claude桌面版/deepseek-harness"
chmod +x scripts/start-web.sh
./scripts/start-web.sh
```

等价命令（加载插件集时不能用 `dsh web --patch`，rc.6 会报 unknown option）：

`npx --yes @deepseek-ai/dsh --profile web --patch plugins/cordis.yml`

浏览器打开打印出来的地址，默认 `http://127.0.0.1:3080`。然后：

1. Settings → Models，填 DeepSeek API key 并保存
2. Choose workspace，选一个项目目录
3. 新开会话，发一条任务试跑

首次 `npx` 会拉 `@deepseek-ai/dsh`，可能要等一会儿。这是 developer preview，版本会破兼容。

## 一次安装 Pi（终端跑道，已装过可跳过）

```bash
cd "/Users/gerryyin/本地/我的积淀/claude桌面版/deepseek-harness"
./scripts/install.sh
```

Pi 的 `/model` 只显示已登录厂商。DeepSeek 用 `/login` → DeepSeek → API key，或同一终端 `export DEEPSEEK_API_KEY`。

## 日常命令

| 目的 | 命令 |
|---|---|
| 打开 dsh Web UI（双击版） | Finder 双击 `启动DeepSeekHarness.command` |
| 打开 dsh Web UI（终端版） | `./scripts/start-web.sh`，默认 `http://127.0.0.1:3080` |
| 打开 Pi | 进任意项目目录后执行 `pi`，`/model` 选 V4 Pro 或 V4 Flash |
| 无界面跑一条 | `npx --yes @deepseek-ai/dsh --profile headless "任务"` |

## 配置从哪来

- Pi 模型：`config/models.json` → 安装时写入 `~/.pi/agent/models.json`
- 两个 Pi 包：`pi-web-access`（搜网页/抓 URL）、`pi-subagents`（子代理委派）
- API key 只读环境变量 `DEEPSEEK_API_KEY`，不进 git、不进知识库

## 不要做什么

- 不要把 `deepseek-ai/deepseek-harness` 整仓克隆进知识库。官方生产入口是 npm 包。
- 不要把它当成第五生产端。任务识别、收尾门、SCOPE_KB 总线不动。
- dsh 仍是 developer preview，包版本会破兼容。
- 全局工作约束（环境级）：DSH 环境内所有执行类型的工作一律交付子代理执行（父代理只规划/委派/核对/插件代办）；权威见 `~/.dsh/AGENTS.md`。

## 回写

经验证的用法进：

- `AI知识体系/03-工具与方法/01-工具图谱/[L1] DeepSeek Harness与Pi速查-插件化Agent运行时.md`
- `AI知识体系/03-工具与方法/01-工具图谱/[L3] DeepSeek Harness与Pi安装SOP-V4双模型.md`
