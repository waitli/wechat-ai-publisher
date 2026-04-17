export type SectionDraft = {
  heading: string;
  paragraphs: string[];
  imagePrompt?: string | undefined;
};

export type ArticleDraft = {
  title: string;
  summary: string;
  coverPrompt: string;
  sections: SectionDraft[];
};

export type SourceMaterial = {
  url: string;
  sourceType: "github_repo" | "web_page";
  title: string;
  summary?: string;
  siteName?: string;
  content: string;
  fetchedAt: string;
};

export type SourceBrief = {
  title: string;
  sourceType: string;
  summary: string;
  keyPoints: string[];
  factualNotes: string[];
};

export type RunRecord = {
  runId: string;
  idea: string;
  startedAt: string;
  retrievedChunks: number;
  sourceUrl?: string;
  sourceTitle?: string;
  sourceType?: string;
  draftPath?: string;
  images: string[];
  published: boolean;
  status: "started" | "draft_generated" | "published" | "failed";
  errorMessage?: string;
};
