import fs from "node:fs/promises";
import path from "node:path";

type RoundRobinState = {
  nextIndex: number;
};

export class PersistentRoundRobin {
  constructor(private readonly statePath: string) {}

  async pick<T>(values: T[]): Promise<{ value: T; index: number } | null> {
    if (values.length === 0) {
      return null;
    }

    const state = await this.readState();
    const index = state.nextIndex % values.length;
    const nextIndex = (index + 1) % values.length;

    await this.writeState({ nextIndex });

    return {
      value: values[index] as T,
      index
    };
  }

  private async readState(): Promise<RoundRobinState> {
    try {
      const raw = await fs.readFile(this.statePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<RoundRobinState>;
      if (typeof parsed.nextIndex === "number" && parsed.nextIndex >= 0) {
        return { nextIndex: parsed.nextIndex };
      }
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code !== "ENOENT") {
        throw error;
      }
    }

    return { nextIndex: 0 };
  }

  private async writeState(state: RoundRobinState): Promise<void> {
    await fs.mkdir(path.dirname(this.statePath), { recursive: true });
    await fs.writeFile(this.statePath, JSON.stringify(state, null, 2), "utf8");
  }
}

