# deepseek-harness 工作区规则（工作区投影）

> 环境级权威规则见 `~/.dsh/AGENTS.md`（DSH 全部会话自动加载）。本文件只补工作区特有信息。

## 硬约束（来自环境级，此处仅重申）

执行类工作（写文件/跑命令/改代码/调研/实现/验证/交付）一律交付子代理；父代理只做规划、委派、核对、插件代办（content_*/track_*/vision_*/skill_*/scout）、汇报。开场：执行类任务先出识别卡（任务ID 走 track 账本 ISS-xxx），用户确认后执行。收尾：有效产出完成后第一条询问必须是「是否进入收尾流程？」，按 Micro/Light/Full 三档收尾。冲突时以 `~/.dsh/AGENTS.md` 为准。

## 工作区指针

- 项目上下文与历史：`CONTEXT.md`
- 委派协议技能：`skills/dsh-model-agent-delegation/SKILL.md`
- 启动：Finder 双击 `启动DeepSeekHarness.command`，或终端 `./scripts/start-web.sh`（默认 http://127.0.0.1:3080）
- 插件集：`plugins/README.md`
