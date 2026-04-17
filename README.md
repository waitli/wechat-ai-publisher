# My WeChat AI Publisher

基于 TypeScript 的个人公众号自动写作与发布项目骨架。

## 当前状态

这是一版工程骨架，已经包含：

- 目录结构和环境配置
- CLI 入口
- 历史文章扫描与切块
- LanceDB 本地向量检索
- 结构化文章生成接口
- Markdown 渲染与图片占位替换
- 发布模块和 dry-run 模式

当前默认运行在 `mock` 模式，便于先打通流程。后续可以在不改 CLI 的前提下替换为真实的 LLM、LanceDB 和 `wenyan`。

现在 `generate` / `run` 同时支持两种输入模式：

- 传统模式：只传 `--idea`
- 来源模式：传 `--url` + `--opinion`，先抓取链接内容，再结合你的观点写文章

## 安装

```bash
npm install
cp .env.example .env
```

## 环境变量

模型配置已经拆成三组：

- 文本模型：`TEXT_LLM_BASE_URL` + `TEXT_LLM_API_KEY_1/2/3` + `TEXT_LLM_MODEL`
- 向量模型：`EMBEDDING_LLM_BASE_URL` + `EMBEDDING_LLM_API_KEY` + `EMBEDDING_LLM_MODEL`
- 生图模型：`IMAGE_LLM_BASE_URL` + `IMAGE_LLM_API_KEY` + `IMAGE_LLM_MODEL`

文本模型会把三个 key 按轮询方式选用，轮询状态文件默认是 `data/text-llm-round-robin.json`。

发布到公众号时，默认走本地 `wenyan publish`，需要：

- `WECHAT_APP_ID`
- `WECHAT_APP_SECRET`

如果走 Wenyan Server 模式，还可以配置：

- `WENYAN_SERVER_URL`
- `WENYAN_SERVER_API_KEY`
- `WENYAN_TARGET_APP_ID`

## 命令

```bash
npm run build-knowledge
npm run generate -- --idea "为什么现代打工人越来越喜欢做副业"
npm run generate -- --url "https://github.com/owner/repo" --opinion "我认为未来高频工作会逐渐从通用 agent 转向 AI 原生工作流工具"
npm run publish -- --file ./drafts/current/draft.md
npm run run -- --idea "为什么现代打工人越来越喜欢做副业"
npm run run -- --url "https://github.com/owner/repo" --opinion "我认为未来高频工作会逐渐从通用 agent 转向 AI 原生工作流工具"
```

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

## 向量存储

当前知识库已经切到 LanceDB 本地库：

- 数据目录默认是 `data/vectordb.lancedb`
- 表名默认是 `style_history`
- `data/ingest-manifest.json` 记录最近一次构建摘要，而不是原始 chunk 数据

## URL 来源写作

来源模式会先执行这条链路：

```text
URL -> 抓取来源内容 -> AI 提炼来源简报 -> 结合你的观点 -> 生成草稿
```

当前内置两类来源：

- GitHub 仓库 URL：优先抓 repo 元数据和 README
- 普通网页 URL：抓 HTML 后提取标题、摘要和正文文本

文章主线仍然由你的 `--opinion` 决定，来源内容只作为素材、证据和案例，不会强制把文章写成网页摘要。

## 下一步

1. 接入真实 Embedding / Text / Image provider。
2. 对结构化文章输出做严格 schema 校验和重试。
3. 联调本地 `wenyan publish` 与 server 模式。
