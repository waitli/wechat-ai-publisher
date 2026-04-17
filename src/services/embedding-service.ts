import crypto from "node:crypto";
import { config } from "../config/index.js";
import { OpenAiCompatibleClient } from "./openai-compatible.js";

export class EmbeddingService {
  private readonly client = new OpenAiCompatibleClient();

  async embed(text: string): Promise<number[]> {
    if (
      config.appMode === "live"
      && config.llm.embedding.baseUrl.length > 0
      && config.llm.embedding.apiKey.length > 0
      && config.llm.embedding.model.length > 0
    ) {
      return this.client.createEmbedding({
        baseUrl: config.llm.embedding.baseUrl,
        apiKey: config.llm.embedding.apiKey,
        model: config.llm.embedding.model,
        apiPath: config.llm.embedding.apiPath,
        text
      });
    }

    const digest = crypto.createHash("sha256").update(text).digest();
    const vectorLength = 16;
    const vector: number[] = [];

    for (let index = 0; index < vectorLength; index += 1) {
      const value = digest[index] ?? 0;
      vector.push(value / 255);
    }

    return vector;
  }
}
