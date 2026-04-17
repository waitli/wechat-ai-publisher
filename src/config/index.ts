import path from "node:path";
import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envBoolean = z.preprocess((value) => {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "off", ""].includes(normalized)) {
      return false;
    }
  }

  return value;
}, z.boolean());

const configSchema = z.object({
  APP_MODE: z.enum(["mock", "live"]).default("mock"),
  TEXT_LLM_BASE_URL: z.string().default(""),
  TEXT_LLM_API_KEY_1: z.string().default(""),
  TEXT_LLM_API_KEY_2: z.string().default(""),
  TEXT_LLM_API_KEY_3: z.string().default(""),
  TEXT_LLM_MODEL: z.string().default(""),
  TEXT_LLM_ROUND_ROBIN_STATE_PATH: z.string().default("./data/text-llm-round-robin.json"),
  EMBEDDING_LLM_BASE_URL: z.string().default(""),
  EMBEDDING_LLM_API_KEY: z.string().default(""),
  EMBEDDING_LLM_MODEL: z.string().default(""),
  EMBEDDING_LLM_API_PATH: z.string().default("/embeddings"),
  IMAGE_LLM_BASE_URL: z.string().default(""),
  IMAGE_LLM_API_KEY: z.string().default(""),
  IMAGE_LLM_MODEL: z.string().default(""),
  VECTOR_DB_PATH: z.string().default("./data/vectordb.lancedb"),
  VECTOR_TABLE_NAME: z.string().default("style_history"),
  INGEST_MANIFEST_PATH: z.string().default("./data/ingest-manifest.json"),
  HISTORY_ARTICLES_PATH: z.string().default("./history_articles"),
  DRAFT_OUTPUT_PATH: z.string().default("./drafts/current/draft.md"),
  IMAGE_OUTPUT_DIR: z.string().default("./assets/images"),
  RUN_HISTORY_DIR: z.string().default("./data/run-history"),
  WECHAT_APP_ID: z.string().default(""),
  WECHAT_APP_SECRET: z.string().default(""),
  WENYAN_THEME: z.string().default("lapis"),
  WENYAN_BIN: z.string().default("wenyan"),
  WENYAN_SERVER_URL: z.string().default(""),
  WENYAN_SERVER_API_KEY: z.string().default(""),
  WENYAN_TARGET_APP_ID: z.string().default(""),
  RETRIEVAL_TOP_K: z.coerce.number().int().positive().default(5),
  MAX_REFERENCE_CHUNKS: z.coerce.number().int().positive().default(5),
  PUBLISH_DRY_RUN: envBoolean.default(true)
});

const parsed = configSchema.parse(process.env);

const resolvePath = (value: string): string => path.resolve(process.cwd(), value);

export const config = {
  appMode: parsed.APP_MODE,
  llm: {
    text: {
      baseUrl: parsed.TEXT_LLM_BASE_URL,
      apiKeys: [
        parsed.TEXT_LLM_API_KEY_1,
        parsed.TEXT_LLM_API_KEY_2,
        parsed.TEXT_LLM_API_KEY_3
      ].filter((value) => value.length > 0),
      model: parsed.TEXT_LLM_MODEL,
      roundRobinStatePath: resolvePath(parsed.TEXT_LLM_ROUND_ROBIN_STATE_PATH)
    },
    embedding: {
      baseUrl: parsed.EMBEDDING_LLM_BASE_URL,
      apiKey: parsed.EMBEDDING_LLM_API_KEY,
      model: parsed.EMBEDDING_LLM_MODEL,
      apiPath: parsed.EMBEDDING_LLM_API_PATH
    },
    image: {
      baseUrl: parsed.IMAGE_LLM_BASE_URL,
      apiKey: parsed.IMAGE_LLM_API_KEY,
      model: parsed.IMAGE_LLM_MODEL
    }
  },
  paths: {
    vectorDbPath: resolvePath(parsed.VECTOR_DB_PATH),
    ingestManifestPath: resolvePath(parsed.INGEST_MANIFEST_PATH),
    historyArticlesPath: resolvePath(parsed.HISTORY_ARTICLES_PATH),
    draftOutputPath: resolvePath(parsed.DRAFT_OUTPUT_PATH),
    imageOutputDir: resolvePath(parsed.IMAGE_OUTPUT_DIR),
    runHistoryDir: resolvePath(parsed.RUN_HISTORY_DIR)
  },
  vectorStore: {
    tableName: parsed.VECTOR_TABLE_NAME
  },
  publishing: {
    wechatAppId: parsed.WECHAT_APP_ID,
    wechatAppSecret: parsed.WECHAT_APP_SECRET,
    theme: parsed.WENYAN_THEME,
    bin: parsed.WENYAN_BIN,
    serverUrl: parsed.WENYAN_SERVER_URL,
    serverApiKey: parsed.WENYAN_SERVER_API_KEY,
    targetAppId: parsed.WENYAN_TARGET_APP_ID,
    dryRun: parsed.PUBLISH_DRY_RUN
  },
  retrieval: {
    topK: parsed.RETRIEVAL_TOP_K,
    maxReferenceChunks: parsed.MAX_REFERENCE_CHUNKS
  }
} as const;

export type AppConfig = typeof config;
