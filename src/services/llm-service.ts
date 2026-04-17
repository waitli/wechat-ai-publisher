import fs from "node:fs/promises";
import { z } from "zod";
import { config } from "../config/index.js";
import { ArticleDraft, SourceBrief, SourceMaterial } from "../domain/article.js";
import { withRetry } from "../utils/retry.js";
import { PersistentRoundRobin } from "../utils/round-robin.js";
import { OpenAiCompatibleClient } from "./openai-compatible.js";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9pQ2D1UAAAAASUVORK5CYII=",
  "base64"
);
const ONE_PIXEL_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAkGBxAQEBAQEA8QEA8PDw8PDw8PDw8PDw8QFREWFhURFRUYHSggGBolGxUVITEhJSkrLi4uFx8zODMsNygtLisBCgoKDg0OGhAQGi0fHyUtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLf/AABEIAAEAAQMBIgACEQEDEQH/xAAVAAEBAAAAAAAAAAAAAAAAAAAABv/EABQBAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhADEAAAAZ8P/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPwCf/8QAFBEBAAAAAAAAAAAAAAAAAAAAEP/aAAgBAgEBPwCf/8QAFBEBAAAAAAAAAAAAAAAAAAAAEP/aAAgBAwEBPwCf/9k=",
  "base64"
);

type TextProviderSelection = {
  baseUrl: string;
  apiKey: string;
  model: string;
  slot: number;
};

const articleDraftSchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  coverPrompt: z.string().min(1),
  sections: z.array(z.object({
    heading: z.string().min(1),
    paragraphs: z.array(z.string().min(1)).min(1),
    imagePrompt: z.string().min(1).optional()
  })).min(2)
});

const sourceBriefSchema = z.object({
  title: z.string().min(1),
  sourceType: z.string().min(1),
  summary: z.string().min(1),
  keyPoints: z.array(z.string().min(1)).min(2),
  factualNotes: z.array(z.string().min(1)).default([])
});

function extractJsonBlock(raw: string): string {
  const fencedMatch = raw.match(/```json\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const objectStart = raw.indexOf("{");
  const objectEnd = raw.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) {
    return raw.slice(objectStart, objectEnd + 1);
  }

  return raw.trim();
}

function truncateForRepair(raw: string, limit = 12000): string {
  if (raw.length <= limit) {
    return raw;
  }

  const head = raw.slice(0, Math.floor(limit / 2));
  const tail = raw.slice(-Math.floor(limit / 2));
  return `${head}\n\n...TRUNCATED...\n\n${tail}`;
}

function compactText(raw: string, limit = 12000): string {
  const trimmed = raw.trim();
  if (trimmed.length <= limit) {
    return trimmed;
  }

  return `${trimmed.slice(0, limit)}\n\n[TRUNCATED]`;
}

export class LlmService {
  private readonly roundRobin = new PersistentRoundRobin(
    config.llm.text.roundRobinStatePath
  );
  private readonly client = new OpenAiCompatibleClient();

  private async selectTextProvider(): Promise<TextProviderSelection | null> {
    const selection = await this.roundRobin.pick(config.llm.text.apiKeys);
    if (!selection) {
      return null;
    }

    return {
      baseUrl: config.llm.text.baseUrl,
      apiKey: selection.value,
      model: config.llm.text.model,
      slot: selection.index + 1
    };
  }

  private async createTextCompletion(input: {
    provider: TextProviderSelection;
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
    temperature: number;
  }): Promise<string> {
    return this.client.createChatCompletion({
      baseUrl: input.provider.baseUrl,
      apiKey: input.provider.apiKey,
      model: input.provider.model,
      messages: input.messages,
      temperature: input.temperature
    });
  }

  async buildSourceBrief(input: {
    source: SourceMaterial;
    opinion?: string;
  }): Promise<SourceBrief> {
    const provider = await this.selectTextProvider();
    if (!provider || config.appMode !== "live") {
      const paragraphs = input.source.content
        .split(/\n{2,}/)
        .map((item) => item.trim())
        .filter((item) => item.length > 0);

      return {
        title: input.source.title,
        sourceType: input.source.sourceType,
        summary: input.source.summary
          ?? paragraphs[0]
          ?? `来源内容来自 ${input.source.url}`,
        keyPoints: paragraphs.slice(0, 4).map((item) => item.slice(0, 160)),
        factualNotes: [
          `Source URL: ${input.source.url}`,
          input.source.siteName ? `Site: ${input.source.siteName}` : "",
          `Fetched at: ${input.source.fetchedAt}`
        ].filter((item) => item.length > 0)
      };
    }

    const systemPrompt = [
      "你是一个中文资料分析助手。",
      "你必须只输出 JSON，不要输出解释、Markdown 或代码块。",
      "JSON 字段必须是：title, sourceType, summary, keyPoints, factualNotes。"
    ].join("\n");

    const userPrompt = [
      `来源 URL: ${input.source.url}`,
      `来源类型: ${input.source.sourceType}`,
      `来源标题: ${input.source.title}`,
      input.source.summary ? `来源摘要: ${input.source.summary}` : "",
      input.source.siteName ? `站点: ${input.source.siteName}` : "",
      input.opinion ? `用户观点: ${input.opinion}` : "",
      "",
      "请从下面的来源内容中提炼一个写作素材简报。",
      "要求：",
      "1. summary 用中文，2-4 句，讲清这个链接最重要的内容。",
      "2. keyPoints 输出 3-6 条，适合后续写文章时引用。",
      "3. factualNotes 只保留可确认的事实信息，不要写猜测。",
      "",
      "来源内容：",
      compactText(input.source.content, 14000)
    ].filter((line) => line.length > 0).join("\n");

    const completion = await withRetry(
      async () => this.createTextCompletion({
        provider,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.2
      }),
      { retries: 1, baseDelayMs: 500 }
    );

    const json = extractJsonBlock(completion);
    return sourceBriefSchema.parse(JSON.parse(json));
  }

  private async generateArticleWithLiveModel(input: {
    idea: string;
    references: string[];
    opinion?: string;
    source?: SourceMaterial;
    sourceBrief?: SourceBrief;
  }): Promise<ArticleDraft> {
    const provider = await this.selectTextProvider();
    if (!provider) {
      throw new Error("No TEXT_LLM_API_KEY configured for live text generation.");
    }

    const referenceText = input.references.length > 0
      ? input.references.map((item, index) => `参考片段 ${index + 1}:\n${item}`).join("\n\n")
      : "暂无可用历史片段，请保持自然、克制、分析型中文公众号写法。";

    const sourceContext = input.source && input.sourceBrief
      ? [
          `来源标题：${input.source.title}`,
          `来源 URL：${input.source.url}`,
          `来源类型：${input.source.sourceType}`,
          input.source.siteName ? `来源站点：${input.source.siteName}` : "",
          "",
          "来源素材简报：",
          input.sourceBrief.summary,
          "",
          "来源关键点：",
          ...input.sourceBrief.keyPoints.map((item, index) => `${index + 1}. ${item}`),
          "",
          "可确认事实：",
          ...(input.sourceBrief.factualNotes.length > 0
            ? input.sourceBrief.factualNotes.map((item, index) => `${index + 1}. ${item}`)
            : ["1. 无额外事实备注"])
        ].filter((line) => line.length > 0).join("\n")
      : "暂无外部来源。";

    const writingIntent = input.opinion
      ? `用户观点：${input.opinion}`
      : `文章主线：${input.idea}`;

    const systemPrompt = [
      "你是一个中文公众号写作助手。",
      "你必须只输出 JSON，不要输出解释、Markdown、代码块标题或额外说明。",
      "JSON 字段必须是：title, summary, coverPrompt, sections。",
      "sections 是数组，每个元素必须包含 heading, paragraphs，可选 imagePrompt。",
      "coverPrompt 和 imagePrompt 必须使用英文。",
      "文章语言必须是简体中文。",
      "如果提供了来源材料，要以用户观点为主线，把来源内容当作证据、案例或反向论据，不要写成单纯摘要。"
    ].join("\n");

    const userPrompt = [
      `选题：${input.idea}`,
      writingIntent,
      "",
      "风格参考：",
      referenceText,
      "",
      "来源材料：",
      sourceContext,
      "",
      "写作要求：",
      "1. 输出一篇适合公众号的完整文章结构。",
      "2. 标题自然，不要口号化。",
      "3. summary 1-2 句。",
      "4. sections 保持 3-5 节，每节 2-3 段，每段是自然中文段落。",
      "5. 至少提供一个 coverPrompt，且至少两节包含 imagePrompt。",
      "6. 如果来源材料里有具体事实，不要改写成无法验证的新事实。",
      "",
      "输出示例结构：",
      JSON.stringify({
        title: "文章标题",
        summary: "一段摘要",
        coverPrompt: "English prompt",
        sections: [
          {
            heading: "第一节标题",
            paragraphs: ["段落1", "段落2"],
            imagePrompt: "English prompt"
          }
        ]
      })
    ].join("\n");

    const generateOnce = async (messages: Array<{ role: "system" | "user" | "assistant"; content: string }>, temperature: number): Promise<{ draft: ArticleDraft; raw: string }> => {
      const completion = await this.createTextCompletion({
        provider,
        messages,
        temperature
      });

      const json = extractJsonBlock(completion);
      return {
        draft: articleDraftSchema.parse(JSON.parse(json)),
        raw: completion
      };
    };

    try {
      const firstPass = await withRetry(
        async () => generateOnce([
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ], 0.8),
        { retries: 1, baseDelayMs: 600 }
      );
      return firstPass.draft;
    } catch (error) {
      const repairContext = error instanceof Error ? error.message : String(error);
      const repairCompletion = await this.createTextCompletion({
        provider,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              userPrompt,
              "",
              "下面是你上一次输出的内容，请修复成合法 JSON，必须只输出 JSON，不要添加任何解释：",
              truncateForRepair(repairContext)
            ].join("\n")
          }
        ],
        temperature: 0.2
      });

      const repairJson = extractJsonBlock(repairCompletion);
      return articleDraftSchema.parse(JSON.parse(repairJson));
    }
  }

  async generateArticle(input: {
    idea: string;
    references: string[];
    opinion?: string;
    source?: SourceMaterial;
    sourceBrief?: SourceBrief;
  }): Promise<ArticleDraft> {
    if (
      config.appMode === "live"
      && config.llm.text.baseUrl.length > 0
      && config.llm.text.model.length > 0
      && config.llm.text.apiKeys.length > 0
    ) {
      return this.generateArticleWithLiveModel(input);
    }

    const snippets = input.references.slice(0, 2).join(" ");
    const framing = input.opinion ?? input.idea;
    const sourceLine = input.source
      ? `文章会围绕来源《${input.source.title}》展开，并结合“${framing}”这个判断来组织论述。`
      : `围绕“${framing}”来组织论述。`;
    const sourceSummary = input.sourceBrief?.summary ?? input.source?.summary ?? "";

    return {
      title: `关于“${framing}”的一次结构化草稿`,
      summary: `围绕“${framing}”的公众号文章初稿，结合你的观点和来源材料组织分析。`,
      coverPrompt: `editorial illustration about ${framing}, clean composition, magazine cover`,
      sections: [
        {
          heading: "问题从哪里开始",
          paragraphs: [
            sourceLine,
            sourceSummary || snippets || "这里会在接入真实模型后注入来源摘要或历史文章片段，帮助模型贴近既有表达习惯。"
          ],
          imagePrompt: `conceptual illustration for ${framing}, modern editorial style`
        },
        {
          heading: "为什么它会持续发生",
          paragraphs: [
            `第二部分适合展开你对“${framing}”的核心判断，并把来源内容当作案例或证据来支撑。`,
            "正式接入模型后，这里会由结构化输出驱动，而不是手写模板。"
          ]
        },
        {
          heading: "最后给出可执行结论",
          paragraphs: [
            "收束时不只复述观点，而是给出读者能带走的判断框架或行动建议。"
          ],
          imagePrompt: `closing editorial visual for ${framing}, subtle lighting`
        }
      ]
    };
  }

  async generateImage(prompt: string, outputPath: string): Promise<void> {
    if (
      config.appMode === "live"
      && config.llm.image.baseUrl.length > 0
      && config.llm.image.apiKey.length > 0
      && config.llm.image.model.length > 0
    ) {
      await this.client.createImage({
        baseUrl: config.llm.image.baseUrl,
        apiKey: config.llm.image.apiKey,
        model: config.llm.image.model,
        prompt,
        outputPath
      });
      return;
    }

    const payload = outputPath.endsWith(".jpg") || outputPath.endsWith(".jpeg")
      ? ONE_PIXEL_JPEG
      : ONE_PIXEL_PNG;
    await fs.writeFile(outputPath, payload);
    void prompt;
  }
}
