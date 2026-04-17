export type StyleChunk = {
  id: string;
  sourceFile: string;
  articleTitle: string;
  sectionTitle?: string;
  chunkIndex: number;
  text: string;
  textHash: string;
  vector: number[];
  createdAt: string;
};

export type RetrievedChunk = {
  sourceFile: string;
  articleTitle: string;
  text: string;
  score: number;
};

