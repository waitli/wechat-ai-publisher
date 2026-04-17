import { ArticleDraft, SourceBrief, SourceMaterial } from "../domain/article.js";
import { LlmService } from "./llm-service.js";

export class ArticleGenerator {
  constructor(private readonly llmService: LlmService) {}

  async generate(input: {
    idea: string;
    references: string[];
    opinion?: string;
    source?: SourceMaterial;
    sourceBrief?: SourceBrief;
  }): Promise<ArticleDraft> {
    return this.llmService.generateArticle(input);
  }
}
