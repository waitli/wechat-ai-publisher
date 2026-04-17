import { Command } from "commander";
import { buildKnowledgeBase } from "../pipelines/build-knowledge.js";
import { generateDraftOnly, runPublisherPipeline, RunOptions } from "../pipelines/run-publisher.js";
import { Publisher } from "../services/publisher.js";

const program = new Command();

function resolveArticleOptions(options: {
  idea?: string;
  url?: string;
  opinion?: string;
}): Pick<RunOptions, "idea" | "url" | "opinion"> {
  return {
    ...(options.idea ? { idea: options.idea } : {}),
    ...(options.url ? { url: options.url } : {}),
    ...(options.opinion ? { opinion: options.opinion } : {})
  };
}

program
  .name("wechat-ai-publisher")
  .description("Personal WeChat AI publishing workflow");

program
  .command("build-knowledge")
  .description("Scan history articles and build the local retrieval index")
  .action(async () => {
    const result = await buildKnowledgeBase();
    console.log(JSON.stringify(result, null, 2));
  });

program
  .command("generate")
  .option("--idea <text>", "Article idea")
  .option("--url <link>", "Source URL to extract content from")
  .option("--opinion <text>", "Your viewpoint to combine with the source content")
  .description("Generate a draft without publishing")
  .action(async (options: { idea?: string; url?: string; opinion?: string }) => {
    const result = await generateDraftOnly(resolveArticleOptions(options));
    console.log(JSON.stringify(result, null, 2));
  });

program
  .command("publish")
  .requiredOption("--file <path>", "Markdown file path")
  .description("Publish an existing markdown file")
  .action(async (options: { file: string }) => {
    const publisher = new Publisher();
    const result = await publisher.publish(options.file);
    console.log(JSON.stringify(result, null, 2));
    if (!result.success) {
      process.exitCode = 1;
    }
  });

program
  .command("run")
  .option("--idea <text>", "Article idea")
  .option("--url <link>", "Source URL to extract content from")
  .option("--opinion <text>", "Your viewpoint to combine with the source content")
  .description("Generate and publish in one pipeline")
  .action(async (options: { idea?: string; url?: string; opinion?: string }) => {
    const result = await runPublisherPipeline({
      ...resolveArticleOptions(options),
      publish: true
    });
    console.log(JSON.stringify(result, null, 2));
  });

await program.parseAsync(process.argv);
