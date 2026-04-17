import { Dispatcher, ProxyAgent } from "undici";
import { SourceMaterial } from "../domain/article.js";

type RequestInitWithDispatcher = RequestInit & {
  dispatcher?: Dispatcher;
};

type GithubRepoResponse = {
  full_name?: string;
  description?: string | null;
  html_url?: string;
  homepage?: string | null;
  stargazers_count?: number;
  forks_count?: number;
  open_issues_count?: number;
  language?: string | null;
  topics?: string[];
  updated_at?: string;
  default_branch?: string;
};

type GithubReadmeResponse = {
  content?: string;
  encoding?: string;
  download_url?: string | null;
};

const DEFAULT_USER_AGENT = "wechat-ai-publisher/0.1";
const MAX_SOURCE_CHARS = 18000;

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

function clampText(text: string, limit = MAX_SOURCE_CHARS): string {
  if (text.length <= limit) {
    return text;
  }

  return `${text.slice(0, limit)}\n\n[TRUNCATED]`;
}

function decodeHtmlEntities(input: string): string {
  return input
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return decodeHtmlEntities(match?.[1]?.trim() ?? "");
}

function extractMeta(html: string, name: string): string {
  const patterns = [
    new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([\\s\\S]*?)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+property=["']${name}["'][^>]+content=["']([\\s\\S]*?)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([\\s\\S]*?)["'][^>]+name=["']${name}["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([\\s\\S]*?)["'][^>]+property=["']${name}["'][^>]*>`, "i")
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return decodeHtmlEntities(match[1].trim());
    }
  }

  return "";
}

function stripHtml(html: string): string {
  const withoutNoise = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ");

  const withBreaks = withoutNoise
    .replace(/<\/(p|div|section|article|main|aside|li|ul|ol|h[1-6]|pre|code|blockquote|tr)>/gi, "\n")
    .replace(/<(br|hr)\s*\/?>/gi, "\n");

  const text = withBreaks
    .replace(/<[^>]+>/g, " ")
    .replace(/\r/g, "\n");

  return decodeHtmlEntities(text)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function parseGithubRepoUrl(url: URL): { owner: string; repo: string } | null {
  if (url.hostname !== "github.com") {
    return null;
  }

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) {
    return null;
  }

  if (["issues", "pull", "blob", "tree", "commit"].includes(parts[2] ?? "")) {
    return null;
  }

  return {
    owner: parts[0] ?? "",
    repo: parts[1] ?? ""
  };
}

export class UrlIngestionService {
  private readonly dispatcher = getProxyDispatcher();

  private async fetchText(url: string, headers?: Record<string, string>): Promise<{
    body: string;
    contentType: string;
    finalUrl: string;
  }> {
    const response = await fetchWithProxy(url, {
      headers: {
        "User-Agent": DEFAULT_USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.5",
        ...headers
      },
      signal: AbortSignal.timeout(20000)
    }, this.dispatcher);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to fetch URL (${response.status}): ${text.slice(0, 500)}`);
    }

    return {
      body: await response.text(),
      contentType: response.headers.get("content-type") ?? "",
      finalUrl: response.url
    };
  }

  private async fetchJson<T>(url: string, headers?: Record<string, string>): Promise<T> {
    const response = await fetchWithProxy(url, {
      headers: {
        "User-Agent": DEFAULT_USER_AGENT,
        Accept: "application/json",
        ...headers
      },
      signal: AbortSignal.timeout(20000)
    }, this.dispatcher);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to fetch JSON (${response.status}): ${text.slice(0, 500)}`);
    }

    return response.json() as Promise<T>;
  }

  private async ingestGithubRepo(url: URL, owner: string, repo: string): Promise<SourceMaterial> {
    const repoMeta = await this.fetchJson<GithubRepoResponse>(`https://api.github.com/repos/${owner}/${repo}`);

    let readmeText = "";
    try {
      const readme = await this.fetchJson<GithubReadmeResponse>(
        `https://api.github.com/repos/${owner}/${repo}/readme`
      );

      if (readme.content && readme.encoding === "base64") {
        readmeText = Buffer.from(readme.content, "base64").toString("utf8");
      } else if (readme.download_url) {
        const response = await this.fetchText(readme.download_url);
        readmeText = response.body;
      }
    } catch {
      readmeText = "";
    }

    const factualLines = [
      `Repository: ${repoMeta.full_name ?? `${owner}/${repo}`}`,
      repoMeta.description ? `Description: ${repoMeta.description}` : "",
      repoMeta.homepage ? `Homepage: ${repoMeta.homepage}` : "",
      typeof repoMeta.stargazers_count === "number" ? `Stars: ${repoMeta.stargazers_count}` : "",
      typeof repoMeta.forks_count === "number" ? `Forks: ${repoMeta.forks_count}` : "",
      typeof repoMeta.open_issues_count === "number" ? `Open issues: ${repoMeta.open_issues_count}` : "",
      repoMeta.language ? `Primary language: ${repoMeta.language}` : "",
      repoMeta.topics && repoMeta.topics.length > 0 ? `Topics: ${repoMeta.topics.join(", ")}` : "",
      repoMeta.updated_at ? `Updated at: ${repoMeta.updated_at}` : ""
    ].filter((line) => line.length > 0);

    const content = clampText([
      factualLines.join("\n"),
      readmeText ? `README:\n${readmeText}` : ""
    ].filter((part) => part.length > 0).join("\n\n"));

    return {
      url: repoMeta.html_url ?? url.toString(),
      sourceType: "github_repo",
      title: repoMeta.full_name ?? `${owner}/${repo}`,
      ...(repoMeta.description ? { summary: repoMeta.description } : {}),
      siteName: "GitHub",
      content,
      fetchedAt: new Date().toISOString()
    };
  }

  private async ingestWebPage(url: URL): Promise<SourceMaterial> {
    const response = await this.fetchText(url.toString());
    const isHtml = response.contentType.includes("text/html") || response.body.includes("<html");

    const title = isHtml ? extractTitle(response.body) : url.hostname;
    const summary = isHtml
      ? extractMeta(response.body, "description") || extractMeta(response.body, "og:description")
      : "";
    const siteName = isHtml
      ? extractMeta(response.body, "og:site_name") || url.hostname
      : url.hostname;

    const content = isHtml
      ? clampText(stripHtml(response.body))
      : clampText(response.body.trim());

    if (content.length === 0) {
      throw new Error(`No readable content extracted from URL: ${url.toString()}`);
    }

    return {
      url: response.finalUrl,
      sourceType: "web_page",
      title: title || response.finalUrl,
      ...(summary ? { summary } : {}),
      siteName,
      content,
      fetchedAt: new Date().toISOString()
    };
  }

  async ingest(rawUrl: string): Promise<SourceMaterial> {
    const normalized = new URL(rawUrl.trim());
    const github = parseGithubRepoUrl(normalized);

    if (github) {
      return this.ingestGithubRepo(normalized, github.owner, github.repo);
    }

    return this.ingestWebPage(normalized);
  }
}
