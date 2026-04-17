# My WeChat AI Publisher

一个面向个人公众号的 AI 工作流项目。

它不是通用聊天机器人，而是一个固定流程的写作与发布工具：把你的选题、观点、历史文章和外部来源材料整合起来，生成公众号草稿，再通过 `wenyan` 发布到公众号草稿箱。

## 项目做什么

- 从本地历史文章中构建风格知识库
- 从 URL 抓取内容，提炼成写作素材
- 结合你的观点生成公众号文章
- 自动生成封面图和内文配图
- 渲染成 Markdown 并发布到公众号草稿箱

## 核心思路

这个项目把长期记忆放在工作流外部，而不是依赖聊天上下文：

- `history_articles/` 存最终定稿
- `LanceDB` 存历史文章切块和向量
- `URL` 来源负责提供事实和材料
- `--opinion` 负责提供文章主线和立场
- `AI` 负责整理、写作和排版

## 输入方式

当前 `generate` 和 `run` 支持两种模式：

- 选题模式：只传 `--idea`
- 来源模式：传 `--url` + `--opinion`

来源模式会先抓取链接内容，再把你的观点和来源材料合并成文章草稿。

## 安装

```bash
npm install
cp .env.example .env
```

## 环境配置

模型配置分成三组：

- 文本模型：`TEXT_LLM_BASE_URL` + `TEXT_LLM_API_KEY_1/2/3` + `TEXT_LLM_MODEL`
- 向量模型：`EMBEDDING_LLM_BASE_URL` + `EMBEDDING_LLM_API_KEY` + `EMBEDDING_LLM_MODEL`
- 生图模型：`IMAGE_LLM_BASE_URL` + `IMAGE_LLM_API_KEY` + `IMAGE_LLM_MODEL`

文本模型支持三个 key 轮询调用，状态会写到 `data/text-llm-round-robin.json`。

发布到公众号时，默认走本地 `wenyan publish`，需要：

- `WECHAT_APP_ID`
- `WECHAT_APP_SECRET`

如果走 Wenyan Server 模式，还可以配置：

- `WENYAN_SERVER_URL`
- `WENYAN_SERVER_API_KEY`
- `WENYAN_TARGET_APP_ID`

`.env` 不会被提交到仓库。

## 命令

```bash
npm run build-knowledge
npm run generate -- --idea "为什么现代打工人越来越喜欢做副业"
npm run generate -- --url "https://github.com/owner/repo" --opinion "我认为未来高频工作会逐渐从通用 agent 转向 AI 原生工作流工具"
npm run publish -- --file ./drafts/current/draft.md
npm run run -- --idea "为什么现代打工人越来越喜欢做副业"
npm run run -- --url "https://github.com/owner/repo" --opinion "我认为未来高频工作会逐渐从通用 agent 转向 AI 原生工作流工具"
```

## 示例

### 1. 只传选题

输入：

```bash
npm run generate -- --idea "为什么现代打工人越来越需要第二收入来源"
```

输出：

```json
{
  "runId": "20260416_151243",
  "idea": "为什么现代打工人越来越需要第二收入来源",
  "status": "draft_generated",
  "published": false,
  "draftPath": "./drafts/current/draft.md",
  "images": [
    "./assets/images/run_20260416_151243_cover.jpg",
    "./assets/images/run_20260416_151243_inline_0.jpg"
  ]
}
```

### 2. URL + 观点

输入：

```bash
npm run run -- --url "https://github.com/owner/repo" --opinion "我认为未来高频工作会从通用 agent 转向原生 AI 工作流工具"
```

输出：

```json
{
  "runId": "20260416_151243",
  "idea": "我认为未来高频工作会从通用 agent 转向原生 AI 工作流工具",
  "status": "published",
  "published": true,
  "sourceUrl": "https://github.com/owner/repo",
  "sourceType": "github_repo",
  "draftPath": "./drafts/current/draft.md"
}
```

## URL 来源写作

URL 来源模式的链路是：

```text
URL -> 抓取来源内容 -> AI 提炼来源简报 -> 结合你的观点 -> 生成草稿
```

当前支持两类来源：

- GitHub 仓库 URL：优先抓 repo 元数据和 README
- 普通网页 URL：抓 HTML 后提取标题、摘要和正文文本

文章主线由你的 `--opinion` 决定，来源内容只作为素材、证据和案例，不会强制把文章写成网页摘要。

## 向量库

知识库使用本地 `LanceDB`：

- 数据目录默认是 `data/vectordb.lancedb`
- 表名默认是 `style_history`
- `data/ingest-manifest.json` 记录最近一次构建摘要

只有 `history_articles/` 里的最终文章会进入知识库。

## 目录

```text
.
├── assets/
├── data/
├── drafts/
├── history_articles/
├── logs/
└── src/
```

## 工作流

1. 把定稿文章放进 `history_articles/`
2. 执行 `npm run build-knowledge` 构建本地风格知识库
3. 用 `npm run generate` 或 `npm run run` 生成草稿
4. 检查 `drafts/current/draft.md`
5. 用 `publish` 或 `run` 推送到公众号草稿箱

## 开发状态

当前项目已经包含：

- CLI 入口
- 历史文章扫描和切块
- 本地向量检索
- URL 内容抓取
- 结构化文章生成
- 图片生成
- Markdown 渲染
- `wenyan` 发布

后续可以继续增强的方向：

1. 增加更多 URL 站点适配器
2. 给来源简报增加更严格的结构化校验
3. 扩展文章模板和文章风格控制
4. 继续优化真实模型接入和容错
