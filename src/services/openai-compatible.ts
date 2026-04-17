import fs from "node:fs/promises";
import { Dispatcher, ProxyAgent } from "undici";
import { withRetry } from "../utils/retry.js";

type TextMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
  error?: {
    message?: string;
  };
};

type EmbeddingResponse = {
  data?: {
    embedding?: number[];
    vector?: number[];
    embedding_vector?: number[];
    values?: number[];
  } | Array<{
    embedding?: number[];
    vector?: number[];
    embedding_vector?: number[];
    values?: number[];
  }>;
  embedding?: number[];
  vector?: number[];
  embedding_vector?: number[];
  values?: number[];
  error?: {
    message?: string;
  };
};

type ImageResponse = {
  data?: Array<{
    b64_json?: string;
    url?: string;
  }>;
  error?: {
    message?: string;
  };
};

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

function extractTextContent(content: string | Array<{ type?: string; text?: string }> | undefined): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => item.text ?? "")
      .join("")
      .trim();
  }

  return "";
}

function getProxyDispatcher(): Dispatcher | undefined {
  const proxyUrl = process.env.HTTPS_PROXY
    ?? process.env.https_proxy
    ?? process.env.HTTP_PROXY
    ?? process.env.http_proxy;

  if (!proxyUrl || !proxyUrl.startsWith("http")) {
    return undefined;
  }

  return new ProxyAgent(proxyUrl);
}

type RequestInitWithDispatcher = RequestInit & {
  dispatcher?: Dispatcher;
};

async function fetchWithProxy(
  input: string | URL | Request,
  init: RequestInit,
  dispatcher?: Dispatcher
): Promise<Response> {
  const finalInit: RequestInitWithDispatcher = dispatcher
    ? { ...init, dispatcher }
    : { ...init };
  return fetch(input, finalInit);
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new Error(`Invalid JSON response: ${text.slice(0, 500)}`, {
      cause: error
    });
  }
}

function extractEmbedding(response: EmbeddingResponse): number[] | null {
  const direct = response.embedding ?? response.vector ?? response.embedding_vector ?? response.values;
  if (Array.isArray(direct) && direct.length > 0) {
    return direct;
  }

  if (response.data && !Array.isArray(response.data)) {
    const nested = response.data.embedding
      ?? response.data.vector
      ?? response.data.embedding_vector
      ?? response.data.values;
    if (Array.isArray(nested) && nested.length > 0) {
      return nested;
    }
  }

  const fromData = Array.isArray(response.data) ? response.data[0] : null;
  if (!fromData) {
    return null;
  }

  const nested = fromData.embedding ?? fromData.vector ?? fromData.embedding_vector ?? fromData.values;
  return Array.isArray(nested) && nested.length > 0 ? nested : null;
}

export class OpenAiCompatibleClient {
  private readonly dispatcher = getProxyDispatcher();

  async createChatCompletion(input: {
    baseUrl: string;
    apiKey: string;
    model: string;
    messages: TextMessage[];
    temperature?: number;
  }): Promise<string> {
    const response = await withRetry(async () => {
      const resp = await fetchWithProxy(joinUrl(input.baseUrl, "/chat/completions"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${input.apiKey}`
        },
        body: JSON.stringify({
          model: input.model,
          messages: input.messages,
          temperature: input.temperature ?? 0.7
        })
      }, this.dispatcher);

      return parseJsonResponse<ChatCompletionResponse>(resp);
    }, { retries: 2, baseDelayMs: 500 });

    if (response.error?.message) {
      throw new Error(response.error.message);
    }

    const content = extractTextContent(response.choices?.[0]?.message?.content);
    if (content.length === 0) {
      throw new Error("Text model returned empty content.");
    }

    return content;
  }

  async createEmbedding(input: {
    baseUrl: string;
    apiKey: string;
    model: string;
    apiPath?: string;
    text: string;
  }): Promise<number[]> {
    const apiPath = input.apiPath && input.apiPath.length > 0
      ? input.apiPath
      : "/embeddings";

    const requestBody = apiPath === "/embeddings/multimodal"
      ? {
          model: input.model,
          input: [
            {
              type: "text",
              text: input.text
            }
          ]
        }
      : {
          model: input.model,
          input: input.text
        };

    const response = await withRetry(async () => {
      const resp = await fetchWithProxy(joinUrl(input.baseUrl, apiPath), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${input.apiKey}`
        },
        body: JSON.stringify(requestBody)
      }, this.dispatcher);

      return parseJsonResponse<EmbeddingResponse>(resp);
    }, { retries: 2, baseDelayMs: 500 });

    if (response.error?.message) {
      throw new Error(response.error.message);
    }

    const embedding = extractEmbedding(response);
    if (!embedding || embedding.length === 0) {
      throw new Error(`Embedding model returned empty vector. Response keys: ${Object.keys(response).join(",")}`);
    }

    return embedding;
  }

  async createImage(input: {
    baseUrl: string;
    apiKey: string;
    model: string;
    prompt: string;
    outputPath: string;
  }): Promise<void> {
    const response = await withRetry(async () => {
      const resp = await fetchWithProxy(joinUrl(input.baseUrl, "/images/generations"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${input.apiKey}`
        },
        body: JSON.stringify({
          model: input.model,
          prompt: input.prompt,
          size: "2048x2048"
        })
      }, this.dispatcher);

      return parseJsonResponse<ImageResponse>(resp);
    }, { retries: 2, baseDelayMs: 700 });

    if (response.error?.message) {
      throw new Error(response.error.message);
    }

    const first = response.data?.[0];
    if (!first) {
      throw new Error("Image model returned no image data.");
    }

    if (first.b64_json) {
      await fs.writeFile(input.outputPath, Buffer.from(first.b64_json, "base64"));
      return;
    }

    if (first.url) {
      const imageResponse = await fetchWithProxy(first.url, {}, this.dispatcher);
      if (!imageResponse.ok) {
        throw new Error(`Failed to download generated image: HTTP ${imageResponse.status}`);
      }

      const arrayBuffer = await imageResponse.arrayBuffer();
      await fs.writeFile(input.outputPath, Buffer.from(arrayBuffer));
      return;
    }

    throw new Error("Image response did not include b64_json or url.");
  }
}
