import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config/index.js";
import { RunRecord } from "../domain/article.js";
import { ArticleGenerator } from "../services/article-generator.js";
import { EmbeddingService } from "../services/embedding-service.js";
import { ImageGenerator } from "../services/image-generator.js";
import { LlmService } from "../services/llm-service.js";
import { MarkdownProcessor } from "../services/markdown-processor.js";
import { Publisher, PublishResult } from "../services/publisher.js";
import { UrlIngestionService } from "../services/url-ingestion-service.js";
import { VectorStore } from "../services/vector-store.js";
import { createRunId } from "../utils/ids.js";

export type RunOptions = {
  idea?: string;
  opinion?: string;
  url?: string;
  publish: boolean;
};

function normalizeText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function resolveTopic(options: RunOptions): string {
  const idea = normalizeText(options.idea);
  const opinion = normalizeText(options.opinion);
  const url = normalizeText(options.url);

  if (!idea && !(url && opinion)) {
    throw new Error("Provide either --idea, or use --url together with --opinion.");
  }

  if ((url && !opinion) || (!url && opinion && !idea)) {
    throw new Error("URL mode requires both --url and --opinion.");
  }

  return idea ?? opinion ?? url ?? "Untitled topic";
}

export async function generateDraftOnly(options: Omit<RunOptions, "publish">): Promise<RunRecord> {
  return runPublisherPipeline({ ...options, publish: false });
}

export async function runPublisherPipeline(options: RunOptions): Promise<RunRecord> {
  const runId = createRunId();
  const resolvedIdea = resolveTopic(options);
  const normalizedOpinion = normalizeText(options.opinion);
  const record: RunRecord = {
    runId,
    idea: resolvedIdea,
    startedAt: new Date().toISOString(),
    retrievedChunks: 0,
    images: [],
    published: false,
    status: "started"
  };

  try {
    const embeddingService = new EmbeddingService();
    const vectorStore = new VectorStore();
    const llmService = new LlmService();
    const articleGenerator = new ArticleGenerator(llmService);
    const imageGenerator = new ImageGenerator(llmService);
    const markdownProcessor = new MarkdownProcessor();
    const publisher = new Publisher();
    const urlIngestionService = new UrlIngestionService();

    const persona = await vectorStore.getCurrentPersona();

    const source = options.url
      ? await urlIngestionService.ingest(options.url)
      : undefined;

    if (persona) {
      record.personaTitle = persona.title;
      record.personaUpdatedAt = persona.updatedAt;
    }

    if (source) {
      record.sourceUrl = source.url;
      record.sourceTitle = source.title;
      record.sourceType = source.sourceType;
    }

    const sourceBrief = source
      ? await llmService.buildSourceBrief(
          normalizedOpinion
            ? { source, opinion: normalizedOpinion }
            : { source }
        )
      : undefined;

    const retrievalQuery = [
      resolvedIdea,
      normalizedOpinion,
      source?.title,
      sourceBrief?.summary
    ].filter((item): item is string => Boolean(item)).join("\n\n");

    const queryVector = await embeddingService.embed(retrievalQuery);
    const retrievedChunks = await vectorStore.search(queryVector, config.retrieval.topK);
    const references = retrievedChunks
      .slice(0, config.retrieval.maxReferenceChunks)
      .map((chunk) => chunk.text);

    record.retrievedChunks = retrievedChunks.length;

    const articleInput: Parameters<ArticleGenerator["generate"]>[0] = {
      idea: resolvedIdea,
      references
    };
    if (normalizedOpinion) {
      articleInput.opinion = normalizedOpinion;
    }
    if (persona) {
      articleInput.persona = persona;
    }
    if (source) {
      articleInput.source = source;
    }
    if (sourceBrief) {
      articleInput.sourceBrief = sourceBrief;
    }
    const article = await articleGenerator.generate(articleInput);
    const imageTasks = markdownProcessor.buildImageTasks(article);
    const generatedImages = await imageGenerator.generateForTasks(
      runId,
      config.paths.imageOutputDir,
      imageTasks
    );
    const markdown = markdownProcessor.renderDraft(article, generatedImages);
    const draftPath = await markdownProcessor.writeDraft(markdown);
    await markdownProcessor.archiveDraft(runId, markdown);

    record.draftPath = draftPath;
    record.images = generatedImages.map((item) => item.localPath);
    record.status = "draft_generated";

    if (options.publish) {
      const publishResult: PublishResult = await publisher.publish(draftPath);
      if (!publishResult.success) {
        throw new Error(publishResult.errorMessage ?? "Publish failed");
      }
      record.published = true;
      record.status = "published";
    }
  } catch (error) {
    record.status = "failed";
    record.errorMessage = error instanceof Error ? error.message : String(error);
  } finally {
    await fs.mkdir(config.paths.runHistoryDir, { recursive: true });
    const recordPath = path.join(config.paths.runHistoryDir, `${runId}.json`);
    await fs.writeFile(recordPath, JSON.stringify(record, null, 2), "utf8");
  }

  if (record.status === "failed") {
    throw new Error(record.errorMessage ?? "Pipeline failed");
  }

  return record;
}
