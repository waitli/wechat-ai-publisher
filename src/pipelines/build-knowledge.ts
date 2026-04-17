import crypto from "node:crypto";
import path from "node:path";
import fs from "fs-extra";
import matter from "gray-matter";
import { config } from "../config/index.js";
import { StyleChunk } from "../domain/chunk.js";
import { EmbeddingService } from "../services/embedding-service.js";
import { VectorStore } from "../services/vector-store.js";

function chunkText(content: string): string[] {
  return content
    .split(/\n\s*\n/g)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length >= 80);
}

async function mapWithConcurrency<TInput, TOutput>(
  values: TInput[],
  limit: number,
  mapper: (value: TInput, index: number) => Promise<TOutput>
): Promise<TOutput[]> {
  const results: TOutput[] = new Array(values.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < values.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(values[currentIndex] as TInput, currentIndex);
    }
  }

  const workerCount = Math.max(1, Math.min(limit, values.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

export async function buildKnowledgeBase(): Promise<{
  scannedFiles: number;
  insertedChunks: number;
}> {
  const exists = await fs.pathExists(config.paths.historyArticlesPath);
  if (!exists) {
    throw new Error(`History articles path not found: ${config.paths.historyArticlesPath}`);
  }

  const fileNames = (await fs.readdir(config.paths.historyArticlesPath))
    .filter((name) => name.endsWith(".md"))
    .filter((name) => name.toLowerCase() !== "readme.md");
  const embeddingService = new EmbeddingService();
  const vectorStore = new VectorStore();
  const existingHashes = await vectorStore.listTextHashes();

  const pendingChunks: Omit<StyleChunk, "vector">[] = [];
  for (const fileName of fileNames) {
    const sourcePath = path.join(config.paths.historyArticlesPath, fileName);
    const raw = await fs.readFile(sourcePath, "utf8");
    const parsed = matter(raw);
    const title = typeof parsed.data.title === "string"
      ? parsed.data.title
      : path.basename(fileName, ".md");

    const chunks = chunkText(parsed.content);
    for (const [index, text] of chunks.entries()) {
      const textHash = crypto.createHash("sha256").update(text).digest("hex");
      if (existingHashes.has(textHash)) {
        continue;
      }

      pendingChunks.push({
        id: `${fileName}-${index}`,
        sourceFile: fileName,
        articleTitle: title,
        chunkIndex: index,
        text,
        textHash,
        createdAt: new Date().toISOString()
      });
    }
  }

  const newChunks = await mapWithConcurrency(pendingChunks, 4, async (chunk) => ({
    ...chunk,
    vector: await embeddingService.embed(chunk.text)
  }));

  await vectorStore.addChunks(newChunks);
  await vectorStore.writeBuildManifest({
    scannedFiles: fileNames.length,
    insertedChunks: newChunks.length,
    totalChunks: existingHashes.size + newChunks.length,
    builtAt: new Date().toISOString()
  });

  return {
    scannedFiles: fileNames.length,
    insertedChunks: newChunks.length
  };
}
