import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config/index.js";
import { ArticleDraft } from "../domain/article.js";
import { GeneratedImage, ImageTask } from "../domain/image-task.js";

const toRelativePath = (absolutePath: string): string =>
  path.relative(path.dirname(config.paths.draftOutputPath), absolutePath).replaceAll("\\", "/");

export class MarkdownProcessor {
  buildImageTasks(draft: ArticleDraft): ImageTask[] {
    const tasks: ImageTask[] = [
      {
        kind: "cover",
        prompt: draft.coverPrompt,
        index: 0
      }
    ];

    draft.sections.forEach((section, index) => {
      if (section.imagePrompt) {
        tasks.push({
          kind: "inline",
          prompt: section.imagePrompt,
          index
        });
      }
    });

    return tasks;
  }

  renderDraft(draft: ArticleDraft, images: GeneratedImage[]): string {
    const cover = images.find((image) => image.task.kind === "cover");
    const inlineImages = new Map(
      images
        .filter((image) => image.task.kind === "inline")
        .map((image) => [image.task.index, image])
    );

    const lines: string[] = [
      "---",
      `title: "${draft.title.replaceAll("\"", "\\\"")}"`,
      `summary: "${draft.summary.replaceAll("\"", "\\\"")}"`,
      `cover: "${cover ? toRelativePath(cover.localPath) : "[[IMAGE_PROMPT: missing-cover]]"}"`,
      "---",
      ""
    ];

    draft.sections.forEach((section, index) => {
      lines.push(`## ${section.heading}`, "");
      for (const paragraph of section.paragraphs) {
        lines.push(paragraph, "");
      }

      const inlineImage = inlineImages.get(index);
      if (inlineImage) {
        lines.push(`![](${toRelativePath(inlineImage.localPath)})`, "");
      }
    });

    return lines.join("\n").trimEnd() + "\n";
  }

  async writeDraft(markdown: string): Promise<string> {
    await fs.mkdir(path.dirname(config.paths.draftOutputPath), { recursive: true });
    await fs.writeFile(config.paths.draftOutputPath, markdown, "utf8");
    return config.paths.draftOutputPath;
  }

  async archiveDraft(runId: string, markdown: string): Promise<string> {
    const archivePath = path.resolve(
      process.cwd(),
      "drafts",
      "archive",
      `draft_${runId}.md`
    );
    await fs.mkdir(path.dirname(archivePath), { recursive: true });
    await fs.writeFile(archivePath, markdown, "utf8");
    return archivePath;
  }
}

