# dsh-model-agent

DeepSeek Harness（DSH）插件：**模型可切换的全权委派工具**。把「整包交给子代理干」做成一个工具，
执行模型三档可选、首次选定后落盘沿用、随时对话切换。

## 提供的工具

| 工具 | 干什么 |
|---|---|
| `model_agent` | 整包委派：自包含任务交给子代理执行，返回最终结果。可选 `model` 参数指定执行模型（会成为新默认） |
| `model_agent_config` | 查询/设置默认执行模型（对话式切换，立即落盘） |

## 执行模型三档

| key | 后端 | 子代理能力 |
|---|---|---|
| `grok` | ACP：grok CLI（**登录账户 OAuth，无需 API key**） | grok 原生工具（bash/文件/web 搜索），继承父会话工作目录；无 DSH 插件工具 |
| `deepseek-v4-flash` | spawn：harness 内子代理 | harness 全部工具，快·省档 |
| `deepseek-v4-pro` | spawn：harness 内子代理 | harness 全部工具，主模型档 |

## 模型配置协议

1. **首次**：未配置默认模型时，`model_agent` 返回引导文本 -> 父代理用 ask_user_question 让用户选定 -> 带参调用，自动落盘 `~/.dsh/model-agent.json`
2. **每次委派**：工具结果带 `【执行模型：…】`标记，父代理向用户明确本次模型
3. **沿用**：之后的委派默认用上次配置
4. **切换**：用户说「换 XX 模型」-> `model_agent_config {model}` 改默认，或单次委派传 `model` 参数（成为新默认）

## 安装（DSH 插件加载）

1) 官方包依赖（grok 档需要）：

```bash
npx --yes @deepseek-ai/dsh plugin --profile web add @deepseek-ai/dsh-subagent-acp
```

2) 在你的 cordis 补丁里加两段（路径换成你的绝对路径）：

```yaml
- insert:
    # grok CLI 子代理提供方（登录账户，无需 API key）
    - id: grok-acp-provider
      name: '@deepseek-ai/dsh-subagent-acp'
      config:
        providerName: grok
        command: '/Users/you/.grok/bin/grok'
        args: ['--no-auto-update', '--always-approve', 'agent', 'stdio']
        permission: allow
        env:
          GROK_HOME: '/Users/you/.grok'
    # 本插件
    - id: dsh-model-agent
      name: '/path/to/this/repo/plugins/dsh-model-agent/src/index.ts'
      config:
        toolName: model_agent
        configPath: ""        # 留空 = ~/.dsh/model-agent.json
        defaultModel: ""      # 留空 = 首次调用时向用户确认
```

3) 重启 dsh（`--patch` 该补丁文件）。

## 配置项

| 键 | 默认 | 说明 |
|---|---|---|
| `toolName` | `model_agent` | 委派工具名 |
| `configPath` | `~/.dsh/model-agent.json` | 模型默认配置落盘路径 |
| `defaultModel` | 空 | 首次默认模型；空 = 首次委派时问用户 |
| `requireApproval` | `true` | 委派前审批门（Web 弹窗 + 飞书镜像双端可见，批准才执行）；`false` 关闭 |
| `models` | 内置三档 | 自定义模型表（kind: spawn/acp + provider + agentOptions） |

## 能力边界（ACP 档）

grok 子进程是外部 CLI（ACP 协议）：自带原生工具、继承工作目录，但**拿不到 DSH 宿主的插件工具**
（content_*/track_*/vision_*/skill_* 等）。推荐分工：子代理干读文件/跑命令/调研/实现，
插件工具环节由父代理代办（配套技能 `skills/dsh-model-agent-delegation` 是完整协议）。

spawn 档（flash/pro）子代理运行在 harness 内部，天然拥有全部注册工具，无此限制。

## 运行要求

- DSH（`@deepseek-ai/dsh`）0.1.0-rc 系列；grok 档需 grok CLI 已登录（`grok` 命令可用）
- spawn 档需已配置 deepseek 模型 provider（如 deepseek-official）
