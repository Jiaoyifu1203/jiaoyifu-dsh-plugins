# jiaoyifu-feishu v2 · 飞书总控台 → DeepSeek Harness

升级自 OpenClaw 飞书通道 / dsh-feishu-notify 的思路，v2 扩展为**全任务监管/介入/审批**总控台：同一个飞书自建应用（长连接模式，无需公网回调地址），把飞书变成 DSH 的随身控制台。

## 三层能力

| 层 | 能力 | 触发 |
|---|---|---|
| 对话桥 | 私聊消息 → 独立 agent 会话（同 Web UI 模型/技能/插件），回复回传 | 直接发消息 |
| 监管 | 列出全部会话 / 任务结束·出错自动推送 | `/tasks`；自动推送 |
| 介入+审批 | 给任意会话派指令；审批同时出现在飞书和 Web UI，任一端先答生效 | `/steer`；审批时自动推 |

## 飞书命令（私聊）

| 命令 | 作用 |
|---|---|
| `/ping` | 桥在线状态（活会话数、管理员绑定） |
| `/tasks` | 全部活会话：序号、运行中/空闲、标题、目录、已运行时长 |
| `/steer <序号|会话id> <指令>` | 介入：运行中的会话注入当前步骤（steer），空闲的派发新任务（followup） |
| `/ws [绝对路径]` | 工作区切换：不带参数看当前；带路径切到该目录（每用户独立，/reset 后新会话生效） |
| `批准 [短号]` / `拒绝 [短号]` | 审批决定；不带短号默认最新一条；超时只取消飞书等待，不自动拒绝 |
| `/reset` | 重置自己的对话会话 |
| 其他文本 | 自己的会话任务（每用户独立上下文） |

## 进度推送（人在外面的场景）

- 任务完成/出错：立即推给管理员（飞书会话的结束由对话回复流负责，不重复推）；
- 任务运行超过 `progressFirstAfterMs`（默认 60s）：推「⏳ 仍在运行 · 已 N 分钟 · 最近工具：xxx」，之后每 `progressIntervalMs`（默认 3 分钟）一条；
- 飞书自己的会话：进度推给该用户本人；Web UI 起的任务：推给管理员；
- 任务开始推送默认关（`notifyTurnStart: false`，易刷屏，需要可开）。

## PC / 移动端同步

飞书是服务端会话：同一个私聊在手机、电脑、iPad 上天然同步（同一份聊天记录）。另外飞书起的每个会话都是 dsh 的正式会话，**Web UI 侧栏也能看到同一条对话**（含轨迹），两边都可以继续操作。

## 审批双端同步

插件**不再**抢占 `approval/request` 瀑布。浏览器答案器（`dsh-host-apiproxy`）照常认领请求并弹 Web UI；本插件旁听同一条 mux 流（`GET /api/events.mux`），把 `approval/requested` 推给飞书管理员。

- 飞书和 Web UI **同时**看到同一条审批；
- 任一端先答生效（`POST /api/respond`；第二次返回 `not-pending`）；
- 飞书回「批准/拒绝 [短号]」走同一接口，Web 对话框同步关闭；
- Web 先点了 → 飞书补一句「已在 Web 端处理」；
- `approvalTimeoutMs` 到期只清飞书 pending 并提示「⏰ 等待超时」，**不**自动拒绝（Web 端可能还在等点击）；
- mux 打开会重放仍 pending 的审批（同 rpcId），重连按 `approvalId` 去重；
- 无绑定管理员时只走 Web UI，不推飞书。管理员绑定方式不变：首个私聊用户自动绑定（`~/.dsh/feishu-admin.json`）或配 `adminOpenIds`。

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
| `approvalTimeoutMs` | `1800000` | 审批等待上限（毫秒），超时只清飞书等待、不自动拒绝 |
| `pollIntervalMs` | `5000` | 监管轮询间隔 |
| `webBaseUrl` | `http://127.0.0.1:3080` | Web 控制台基址（仅回环）。优先 `ctx.webServer.port`，拿不到才用这项 |
| `idleTimeoutMs` | `600000` | 单轮对话最长等待 |
| `maxReplyChars` / `interimMessage` / `resetCommands` | — | 同 v1 |

## 生效与验收

1. 本机重启 `./scripts/start-web.sh`（`--profile web --patch` 形式，见仓库 README）。
2. 日志出现 `[jiaoyifu-feishu] ✅ 飞书长连接已建立（onReady）` = 连接成功；出现 ❌ 则按错误信息排查。
3. 飞书私聊发 `/ping` → 收到「✅ 飞书桥在线」；发 `/tasks` → 看到全部会话；发普通消息 → 正常任务回复。
4. Web UI 起一个会触发审批的任务（如改沙箱外文件）→ 飞书收到 🔐 且浏览器同时弹窗 → 任一端回答 → 另一端关闭或提示已处理。

## 铁律

- 密钥只进 `plugins/feishu.env`（gitignore、chmod 600），不进仓库/cordis.yml；
- 失败软着陆：缺凭据只警告不崩启动；resume 失败降级新建；mux 断开 5s 重连；无管理员时只走 Web UI；
- 长连接模式一个应用同时只能一个客户端在线：别同时跑两个 dsh web 实例（会互踢）。
