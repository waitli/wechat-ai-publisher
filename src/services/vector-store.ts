import fs from "node:fs/promises";
import path from "node:path";
import * as lancedb from "@lancedb/lancedb";
import { config } from "../config/index.js";
import { RetrievedChunk, StyleChunk } from "../domain/chunk.js";

type SearchRow = StyleChunk & {
  _distance?: number;
};

export class VectorStore {
  private async connect(): Promise<lancedb.Connection> {
    return lancedb.connect(config.paths.vectorDbPath);
  }

  private async openTableOn(connection: lancedb.Connection): Promise<lancedb.Table | null> {
    const tableNames = await connection.tableNames();

    if (!tableNames.includes(config.vectorStore.tableName)) {
      return null;
    }

    return connection.openTable(config.vectorStore.tableName);
  }

  private async openTable(): Promise<lancedb.Table | null> {
    const connection = await this.connect();
    return this.openTableOn(connection);
  }

  async loadChunks(): Promise<StyleChunk[]> {
    const table = await this.openTable();
    if (!table) {
      return [];
    }

    const rows = await table
      .query()
      .select([
        "id",
        "sourceFile",
        "articleTitle",
        "sectionTitle",
        "chunkIndex",
        "text",
        "textHash",
        "vector",
        "createdAt"
      ])
      .toArray();

    return rows as StyleChunk[];
  }

  async listTextHashes(): Promise<Set<string>> {
    const table = await this.openTable();
    if (!table) {
      return new Set<string>();
    }

    const rows = await table.query().select(["textHash"]).toArray();
    return new Set(
      rows
        .map((row) => row.textHash)
        .filter((textHash): textHash is string => typeof textHash === "string")
    );
  }

  async addChunks(chunks: StyleChunk[]): Promise<void> {
    if (chunks.length === 0) {
      return;
    }

    const connection = await this.connect();
    const table = await this.openTableOn(connection);

    if (!table) {
      await connection.createTable(config.vectorStore.tableName, chunks);
      return;
    }

    await table.add(chunks);
  }

  async writeBuildManifest(input: {
    scannedFiles: number;
    insertedChunks: number;
    totalChunks: number;
    builtAt: string;
  }): Promise<void> {
    const payload = {
      ...input,
      vectorDbPath: config.paths.vectorDbPath,
      tableName: config.vectorStore.tableName
    };

    await fs.mkdir(path.dirname(config.paths.ingestManifestPath), { recursive: true });
    await fs.writeFile(config.paths.ingestManifestPath, JSON.stringify(payload, null, 2), "utf8");
  }

  async search(queryVector: number[], topK: number): Promise<RetrievedChunk[]> {
    const table = await this.openTable();
    if (!table) {
      return [];
    }

    const rows = await table.vectorSearch(queryVector).limit(Math.max(topK * 3, topK)).toArray();
    const deduplicated: RetrievedChunk[] = [];
    const seen = new Set<string>();

    for (const row of rows as SearchRow[]) {
      const sourceFile = row.sourceFile;
      if (!sourceFile || seen.has(sourceFile)) {
        continue;
      }

      const distance = typeof row._distance === "number" ? row._distance : Number.POSITIVE_INFINITY;

      deduplicated.push({
        sourceFile,
        articleTitle: row.articleTitle,
        text: row.text,
        score: Number.isFinite(distance) ? 1 / (1 + distance) : 0
      });
      seen.add(sourceFile);
      if (deduplicated.length >= topK) {
        break;
      }
    }

    return deduplicated;
  }
}
