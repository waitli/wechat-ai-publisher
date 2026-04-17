import fs from "node:fs/promises";
import path from "node:path";
import { GeneratedImage, ImageTask } from "../domain/image-task.js";
import { LlmService } from "./llm-service.js";

export class ImageGenerator {
  constructor(private readonly llmService: LlmService) {}

  async generateForTasks(runId: string, outputDir: string, tasks: ImageTask[]): Promise<GeneratedImage[]> {
    await fs.mkdir(outputDir, { recursive: true });

    const results: GeneratedImage[] = [];
    for (const task of tasks) {
      const suffix = task.kind === "cover" ? "cover" : `inline_${task.index}`;
      const fileName = `run_${runId}_${suffix}.jpg`;
      const outputPath = path.join(outputDir, fileName);
      await this.llmService.generateImage(task.prompt, outputPath);
      results.push({ task, localPath: outputPath });
    }

    return results;
  }
}
