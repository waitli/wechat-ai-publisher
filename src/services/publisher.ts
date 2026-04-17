import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { config } from "../config/index.js";

const execFileAsync = promisify(execFile);

export type PublishResult = {
  success: boolean;
  command: string;
  stdout?: string | undefined;
  stderr?: string | undefined;
  errorMessage?: string | undefined;
};

export class Publisher {
  private async resolveRunner(): Promise<{ command: string; argsPrefix: string[] }> {
    const configured = config.publishing.bin;

    if (configured.includes(path.sep) || configured.startsWith(".")) {
      const resolvedPath = path.resolve(process.cwd(), configured);
      const realPath = await fs.realpath(resolvedPath).catch(() => resolvedPath);

      if (realPath.endsWith(".js")) {
        return {
          command: process.execPath,
          argsPrefix: [realPath]
        };
      }

      return {
        command: realPath,
        argsPrefix: []
      };
    }

    return {
      command: configured,
      argsPrefix: []
    };
  }

  private validatePublishingConfig(): void {
    if (config.publishing.serverUrl.length > 0) {
      if (config.publishing.serverApiKey.length === 0) {
        throw new Error("WENYAN_SERVER_API_KEY is required when WENYAN_SERVER_URL is set.");
      }
      return;
    }

    if (config.publishing.wechatAppId.length === 0) {
      throw new Error("WECHAT_APP_ID is required for local wenyan publish.");
    }

    if (config.publishing.wechatAppSecret.length === 0) {
      throw new Error("WECHAT_APP_SECRET is required for local wenyan publish.");
    }
  }

  async publish(filePath: string): Promise<PublishResult> {
    const runner = await this.resolveRunner();
    const args = [
      ...runner.argsPrefix,
      "publish",
      "-f",
      filePath,
      "-t",
      config.publishing.theme
    ];

    if (config.publishing.serverUrl.length > 0) {
      args.push("--server", config.publishing.serverUrl);
      args.push("--api-key", config.publishing.serverApiKey);
    }

    if (config.publishing.targetAppId.length > 0) {
      args.push("--app-id", config.publishing.targetAppId);
    }

    const command = `${runner.command} ${args.join(" ")}`;

    if (config.publishing.dryRun) {
      return {
        success: true,
        command,
        stdout: "Dry run enabled. Command was not executed."
      };
    }

    this.validatePublishingConfig();

    try {
      const result = await execFileAsync(runner.command, args, {
        env: {
          ...process.env,
          WECHAT_APP_ID: config.publishing.wechatAppId,
          WECHAT_APP_SECRET: config.publishing.wechatAppSecret
        }
      });

      return {
        success: true,
        command,
        stdout: result.stdout,
        stderr: result.stderr
      };
    } catch (error) {
      const execError = error as Error & { stdout?: string; stderr?: string };
      return {
        success: false,
        command,
        stdout: execError.stdout,
        stderr: execError.stderr,
        errorMessage: execError.message
      };
    }
  }
}
