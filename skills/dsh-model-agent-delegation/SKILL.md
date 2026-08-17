---
name: dsh-model-agent-delegation
description: model_agent 全权委派的组合分工操作路径。用户说「用 grok agent 完成任务」「交给子代理」「全权委托」时，走 model_agent 工具整包委派：执行模型（grok 登录账户 / deepseek-v4-flash / deepseek-v4-pro）首次由用户选定后落盘沿用，每次委派前向用户明确当前模型，换模型通过对话（model_agent_config 或 model 参数）完成；grok 子代理负责读文件/跑命令/调研/实现，DSH 插件工具（content_*/track_*/vision_*/skill_*/scout）环节由父代理代办。触发词：用 grok agent、grok agent 全权委托、交给 grok、交给子代理、全权委托、用哪个模型、换模型、model_agent。不在普通单步任务（查个文件、改一行代码）时触发——只在用户明确要求整包委派或调整委派模型时激活。
---

# model_agent 全权委派 · 组合分工操作路径

`model_agent` 是模型可切换的全权委派工具（插件 dsh-model-agent）。执行模型三档：

| key | 后端 | 子代理能力 |
|---|---|---|
| `grok` | ACP：grok CLI（登录账户，无 API key） | grok 原生工具（bash/文件/web），继承工作目录；**无 DSH 插件工具** |
| `deepseek-v4-flash` | spawn：harness 内子代理 | harness 全部工具，快·省 |
| `deepseek-v4-pro` | spawn：harness 内子代理 | harness 全部工具，主模型档 |

## 1. 模型配置协议（先记这张流程）

1. **首次**：调 `model_agent_config`（不带参数）查配置；若未配置默认模型，用 ask_user_question 让用户选（说明三档差异），选定后以 `model` 参数委派（自动落盘 `~/.dsh/model-agent.json`）或先 `model_agent_config {model}` 设默认。
2. **每次委派前**：用一句话向用户明确本次执行模型（如「本轮由 deepseek-v4-flash 执行」）。
3. **沿用**：之后的委派默认用上次配置，不再追问。
4. **换模型（对话调整）**：用户说「换 grok」「用 flash」→ `model_agent_config {model}` 改默认；或单次委派时给 `model_agent` 传 `model` 参数（也会成为新默认）。

## 2. 分工铁律

| 环节 | 谁执行 |
|---|---|
| 读文件、跑命令、写代码、调研、web 检索、实现、验证、交付 | **model_agent 子代理**（整包执行，不拆子任务、不抢活） |
| 内容库（content_*）、任务账本（track_*）、视觉（vision_*）、技能路由（skill_route/skill_catalog）、轻量扫描（scout） | **父代理代办**——grok 子代理没有这些工具，flash/pro 有但插件环节统一父代理兜底更稳 |
| 交接打包、接收结果、核对验收、合并交付 | **父代理** |

## 3. 标准操作路径（一次委托）

1. **报模型**：告知用户本次执行模型（未配置先问）。
2. **打包交接**：自包含 prompt（目标+上下文路径+验收标准+「插件工具环节由父代理代办」声明）→ 调 `model_agent`。
3. **核对**：结果核对；未达标可补说明二次委派（沿用同一模型）。
4. **插件代办**：内容库入库、账本推进、视觉核对等由父代理补做。
5. **合并交付**：grok/子代理产出 + 父代理插件操作结果合并汇报。

## 4. 排查要点

- 工具未注册（历史事故：重启丢补丁）→ 提示用户重启 `./scripts/start-web.sh`，确认 cordis.yml 含 `grok-acp-provider` + `dsh-model-agent` 两段。
- `model_agent` 返回「提供方 "grok" 未就绪」→ grok CLI 问题（启动日志看 `not registered yet`）。
- 配置落盘在 `~/.dsh/model-agent.json`（服务器进程写）；模型表可改插件源码 `DEFAULT_MODELS` 或 cordis.yml `config.models`。
