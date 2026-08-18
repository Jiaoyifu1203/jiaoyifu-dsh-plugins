# jiaoyifu-studio · 脚姨夫内容工作台（含视频生产流水线）

> 复刻小红书爆款笔记《DeepSeek Harness 爆改自媒体工作台》（作者 oil欧呦 / 工作台 Oil Creator），
> 升级为 jiaoyifu 插件：**本地内容目录 + DSH agent + 同源工作台面板**。品牌与产线换成脚姨夫自己的。
> v1.1 增益：**视频生产流水线**（产线概念升级自开源 [MoneyPrinterTurbo](https://github.com/harry0703/MoneyPrinterTurbo)，MIT），
> 按 jiaoyifu 铁律做成本机零 API 版：`say` TTS + `afinfo` 计时 + `ffmpeg` 合成。

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

## 视频生产流水线（v1.1 · 升级自 MoneyPrinterTurbo）

| MoneyPrinterTurbo 环节 | 它的做法 | jiaoyifu-studio 本地化 |
|---|---|---|
| 视频脚本 | LLM 按主题生成 | DSH 对话生成，写 `script.md`（content_write） |
| 素材 | Pexels/Pixabay API 关键词下载 | 本地 `materials/` 图片按文件名序轮播（无则纯色底）；下载 API 二期 |
| 配音 | Edge TTS / Azure（云） | macOS `say` 本机 TTS（中文音色自动探测，可配语速），零 API 零费用 |
| 字幕 | whisper 识别 | 按句配音时长（`afinfo` 实测）累加生成 SRT，零识别误差 |
| BGM | 内置音乐库 | 本地 `bgm/` 第一个音频循环混音（amix 0.25 权重，可关） |
| 合成 | moviepy | `ffmpeg`：素材轮播/纯色底 + 配音 + amix BGM + 烧字幕 -> `video.mp4`（写进本期目录） |

- **流水线**：`文案(script.md)` -> `配音(voice/NN.aiff + voice.json)` -> `字幕(subs.srt)` -> `成片(video.mp4)`，阶段状态存 `meta.json` 的 `video` 字段。
- **工具**：`video_probe`（能力/音色探测）· `video_voice`（逐句配音+计时）· `video_subs`（SRT 时间轴）· `video_compose`（ffmpeg 合成，缺字幕/BGM 自动降级重试）。
- **面板**：视频 Tab = 成片播放器 + 流水线卡片（四阶段进度 + 音色选择 + ①②③ 按钮 + 分辨率/烧字幕/BGM 选项）。
- **降级**：无 `say`（非 macOS）/无 `ffmpeg`（brew install ffmpeg）时按钮禁用并给出指引，配音/字幕/合成互不阻塞。
- 合成走本机命令（与笔记「不走 API」同思路）；发布铁律不变：**只写草稿，公开动作留给人**。

## 目录规范（目录即数据库）

```
~/.dsh/content/<slug>/        # 可用 cordis.yml contentRoot 改根
  meta.json   元数据 + 期状态 + 各平台发布状态与数据 + 视频产线阶段(video)
  topic.md    选题
  script.md   脚本（视频产线的文案源）
  subs.srt    字幕（SRT，产线生成或技能写入）
  article.md  文章
  cover.{png,jpg,jpeg,webp}
  video.mp4   成片（产线合成产物）
  voice/      逐句 TTS：01.aiff、02.aiff… + voice.json（句子/时长清单）
  materials/  素材图片（jpg/png/webp，按文件名序轮播）
  bgm/        可选背景音乐（取第一个音频文件）
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
- **工具**（模型可自主调用）：
  - 内容：`content_list` / `content_get` / `content_new` / `content_write` / `content_status` / `content_bind` / `content_unbind`
  - 视频产线：`video_probe` / `video_voice` / `video_subs` / `video_compose`
- **产线用法**（对话或面板均可）：
  1. 写脚本：「帮我给这一期写 60 秒口播脚本」（写入 script.md）
  2. 绑定后一句跑全链：「给这期配音、出字幕、合成成片」（模型依次调 video_voice -> video_subs -> video_compose）
  3. 面板视频 Tab：选音色 -> ① 生成配音 -> ② 生成字幕 -> ③ 合成成片，完成即出现在播放器

## 设计约定（jiaoyifu 铁律）

- 零 UI 构建：面板是内联 HTML（`panel.ts` 导出模板字符串，无打包步骤；面板 JS 内禁用反引号与 `${`）。
- 零外部依赖：meta 用 JSON，不引入 YAML 库。
- 数据落盘 `~/.dsh`：内容库 `~/.dsh/content`、会话绑定 `~/.dsh/studio-bind.json`。
- 面板路由经 `ctx.webServer.register`（host 服务，web profile 必有）；若服务缺失，插件自动降级为「仅工具模式」。
- 升级自：Oil Creator 工作台演示（作者未开源，按口播/字幕/画面复原数据流，未抄代码）；
  视频产线升级自 [MoneyPrinterTurbo](https://github.com/harry0703/MoneyPrinterTurbo)（MIT）的流水线概念，未复用其代码（moviepy/Pexels/云 TTS 全部替换为本机方案）。
