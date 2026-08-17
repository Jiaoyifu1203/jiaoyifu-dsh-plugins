# jiaoyifu-studio · 脚姨夫内容工作台

> 复刻小红书爆款笔记《DeepSeek Harness 爆改自媒体工作台》（作者 oil欧呦 / 工作台 Oil Creator），
> 升级为 jiaoyifu 插件：**本地内容目录 + DSH agent + 同源工作台面板**。品牌与产线换成脚姨夫自己的。

## 复刻对照

| 笔记里的 Oil Creator | jiaoyifu-studio |
|---|---|
| 左上 logo / slogan / dsh-theme 皮肤 | 暂不做皮肤（换皮不换心，二期接 dsh-theme） |
| 「内容」Tab（本地目录映射） | `/jiaoyifu/studio` 面板 · 左内容库列表（封面/标题/状态/时间） |
| 五 Tab 详情：概览 / 视频 / 脚本 / 字幕 / 文章 | 同结构五 Tab（面板中栏） |
| 选题卡 + `topic.md` | `topic.md` + 概览「选题卡」 |
| 平台卡：小红书/B站/抖音/视频号/公众号 + 同步已发布 | 概览五平台卡：发布状态 + 播放/赞/评/藏 + 链接，本地 meta.json |
| `/firm content` 选中当期为上下文 | `/content <slug>` 绑定 + `agent/pre-step` 每轮注入 |
| 生成封面/字幕/文章的 skill 全集成 | 复用现有技能：`jiaoyifu-zhuzigao`（字幕）/ `jiaoyifu-image-prompt`（封面）/ `jiaoyifu-xiaohongshu-content`（文案），产出直接写进本期目录 |
| 自动同步走本机、不走 API | v1 只做本地 meta.json 与手动/对话回填；RPA 草稿发布二期 |

## 目录规范（目录即数据库）

```
~/.dsh/content/<slug>/        # 可用 cordis.yml contentRoot 改根
  meta.json   元数据 + 期状态 + 各平台发布状态与数据
  topic.md    选题
  script.md   脚本
  subs.srt    字幕（SRT）
  article.md  文章
  cover.{png,jpg,jpeg,webp}
  video.mp4   成片
```

- 期状态：`not_started` 未开始 → `preparing` 准备中 → `ready` 待发布 → `published` 已发布
- 平台：`xhs` / `bilibili` / `douyin` / `shipinhao` / `gzh`
- 平台状态：`unpublished` / `draft` 草稿已备 / `published`
- **发布铁律：自动发布默认只写草稿，公开动作留给人**（笔记评论区集中警告封号风险）

## 用法

```bash
# 重启后生效（会话沙箱内不能重启 3080 实例，本机终端执行）
./scripts/start-web.sh
```

- **面板**：浏览器打开 http://127.0.0.1:3080/jiaoyifu/studio
- **对话**：
  - 「帮我新建一期《标题》」→ 模型调 `content_new`
  - `/content <slug>` → 绑定本期为会话上下文（后续自动注入）
  - `/studio` → 面板地址
- **工具**（模型可自主调用）：`content_list` / `content_get` / `content_new` / `content_write` / `content_status` / `content_bind` / `content_unbind`

## 设计约定（jiaoyifu 铁律）

- 零 UI 构建：面板是内联 HTML（`panel.ts` 导出模板字符串，无打包步骤；面板 JS 内禁用反引号与 `${`）。
- 零外部依赖：meta 用 JSON，不引入 YAML 库。
- 数据落盘 `~/.dsh`：内容库 `~/.dsh/content`、会话绑定 `~/.dsh/studio-bind.json`。
- 面板路由经 `ctx.webServer.register`（host 服务，web profile 必有）；若服务缺失，插件自动降级为「仅工具模式」。
- 升级自：Oil Creator 工作台演示（作者未开源，按口播/字幕/画面复原数据流，未抄代码）。
