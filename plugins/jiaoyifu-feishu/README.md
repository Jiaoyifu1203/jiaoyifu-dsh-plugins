# jiaoyifu-feishu v2 · 飞书总控台 → DeepSeek Harness

升级自 OpenClaw 飞书通道 / dsh-feishu-notify 的思路，v2 扩展为**全任务监管/介入/审批**总控台：同一个飞书自建应用（长连接模式，无需公网回调地址），把飞书变成 DSH 的随身控制台。

## 三层能力

| 层 | 能力 | 触发 |
|---|---|---|
| 对话桥 | 私聊消息 → 独立 agent 会话（同 Web UI 模型/技能/插件），回复回传 | 直接发消息 |
| 监管 | 列出全部会话 / 任务结束·出错自动推送 | `/tasks`；自动推送 |
| 介入+审批 | 给任意会话派指令；审批问题推飞书、回「批准/拒绝」决定 | `/steer`；审批时自动推 |

## 飞书命令（私聊）

| 命令 | 作用 |
|---|---|
| `/ping` | 桥在线状态（活会话数、管理员绑定） |
| `/tasks` | 全部活会话：序号、运行中/空闲、标题、目录、已运行时长 |
| `/steer <序号|会话id> <指令>` | 介入：运行中的会话注入当前步骤（steer），空闲的派发新任务（followup） |
| `/ws [绝对路径]` | 工作区切换：不带参数看当前；带路径切到该目录（每用户独立，/reset 后新会话生效） |
| `批准 [短号]` / `拒绝 [短号]` | 审批决定；不带短号默认最新一条；超时 30 分钟自动拒绝（fail-closed） |
| `/reset` | 重置自己的对话会话 |
| 其他文本 | 自己的会话任务（每用户独立上下文） |

## 进度推送（人在外面的场景）

- 任务完成/出错：立即推给管理员（飞书会话的结束由对话回复流负责，不重复推）；
- 任务运行超过 `progressFirstAfterMs`（默认 60s）：推「⏳ 仍在运行 · 已 N 分钟 · 最近工具：xxx」，之后每 `progressIntervalMs`（默认 3 分钟）一条；
- 飞书自己的会话：进度推给该用户本人；Web UI 起的任务：推给管理员；
- 任务开始推送默认关（`notifyTurnStart: false`，易刷屏，需要可开）。

## PC / 移动端同步

飞书是服务端会话：同一个私聊在手机、电脑、iPad 上天然同步（同一份聊天记录）。另外飞书起的每个会话都是 dsh 的正式会话，**Web UI 侧栏也能看到同一条对话**（含轨迹），两边都可以继续操作。

## 审批接管机制

插件以 `prepend: true` 注册 `approval/request` 瀑布监听，**抢在浏览器弹窗之前**接管审批：有绑定管理员（第一个私聊用户自动绑定，落盘 `~/.dsh/feishu-admin.json`，或配 `adminOpenIds`）就把审批问题推飞书等待决定；无管理员则 `next()` 交还浏览器，Web UI 弹窗照常。

## 行为与安全

- 只回**私聊**（p2p），群聊忽略（`allowedChatTypes` 可配）；
- 会话落盘 `~/.dsh/feishu-sessions.json`，重启尝试 resume；
- App Secret 只走 `plugins/feishu.env`：优先环境变量 `FEISHU_APP_SECRET`（start-web.sh 自动加载），**插件兜底自己读仓库 `plugins/feishu.env`**，不依赖 shell 是否 source；
- 代理防护：自动把 `open.feishu.cn` 等加入 `NO_PROXY`，防止本机代理劫持飞书 wss；
- 连接诊断日志：onReady/onError/onReconnecting 全打印，连不上不再静默。

## 配置（plugins/cordis.yml → jiaoyifu-feishu.config）

| 项 | 默认 | 说明 |
|---|---|---|
| `appId` | 无 | 飞书自建应用 App ID（`cli_…`） |
| `appSecretEnv` | `FEISHU_APP_SECRET` | 环境变量名（缺省时插件自读 plugins/feishu.env） |
| `allowedChatTypes` | `["p2p"]` | 允许响应的会话类型 |
| `workspaceDir` | dsh 启动目录 | 飞书任务的 cwd |
| `adminOpenIds` | `[]` | 监管管理员 open_id 列表；空 = 首个私聊用户自动绑定 |
| `notifyTurnEnd` | `true` | 任务结束/出错推飞书 |
| `notifyTurnStart` | `false` | 任务开始推飞书（易刷屏） |
| `progressFirstAfterMs` | `60000` | 运行多久后开始报进度 |
| `progressIntervalMs` | `180000` | 进度推送最小间隔 |
| `approvalTimeoutMs` | `1800000` | 审批等待上限（毫秒），超时 fail-closed |
| `pollIntervalMs` | `5000` | 监管轮询间隔 |
| `idleTimeoutMs` | `600000` | 单轮对话最长等待 |
| `maxReplyChars` / `interimMessage` / `resetCommands` | — | 同 v1 |

## 生效与验收

1. 本机重启 `./scripts/start-web.sh`（`--profile web --patch` 形式，见仓库 README）。
2. 日志出现 `[jiaoyifu-feishu] ✅ 飞书长连接已建立（onReady）` = 连接成功；出现 ❌ 则按错误信息排查。
3. 飞书私聊发 `/ping` → 收到「✅ 飞书桥在线」；发 `/tasks` → 看到全部会话；发普通消息 → 正常任务回复。
4. Web UI 起一个会触发审批的任务（如改沙箱外文件）→ 飞书收到 🔐 审批请求 → 回「批准」→ 任务继续。

## 铁律

- 密钥只进 `plugins/feishu.env`（gitignore、chmod 600），不进仓库/cordis.yml；
- 失败软着陆：缺凭据只警告不崩启动；resume 失败降级新建；无管理员时审批交还浏览器；
- 长连接模式一个应用同时只能一个客户端在线：别同时跑两个 dsh web 实例（会互踢）。
