import { mkdir, open, readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { canonicalJson } from "../crypto/canonical-digest.js";
import type { TaskId } from "../domain/ids.js";
import type { OrchestratorState } from "../domain/state.js";
import type { StateStore } from "./state-store.js";

function safeTaskName(taskId: TaskId): string {
  if (!/^TASK-[A-Za-z0-9._-]+$/.test(taskId)) throw new Error("INVALID_TASK_ID_FOR_STORE");
  return taskId;
}

async function durableWrite(path: string, content: string): Promise<void> {
  const handle = await open(path, "w", 0o600);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export class FileStateStore implements StateStore {
  constructor(private readonly root: string) {}

  async load(taskId: TaskId): Promise<OrchestratorState | null> {
    const name = safeTaskName(taskId);
    try {
      return JSON.parse(await readFile(join(this.root, `${name}.json`), "utf8")) as OrchestratorState;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async save(state: OrchestratorState): Promise<void> {
    const name = safeTaskName(state.taskId);
    await mkdir(this.root, { recursive: true, mode: 0o700 });

    const historyPath = join(this.root, `${name}.jsonl`);
    const history = await open(historyPath, "a", 0o600);
    try {
      await history.writeFile(`${canonicalJson(state)}\n`, "utf8");
      await history.sync();
    } finally {
      await history.close();
    }

    const currentPath = join(this.root, `${name}.json`);
    const tempPath = join(this.root, `${name}.${process.pid}.tmp`);
    await durableWrite(tempPath, canonicalJson(state));
    await rename(tempPath, currentPath);
  }

  async history(taskId: TaskId): Promise<OrchestratorState[]> {
    const name = safeTaskName(taskId);
    try {
      const raw = await readFile(join(this.root, `${name}.jsonl`), "utf8");
      return raw.split("\n").filter(Boolean).map((line) => JSON.parse(line) as OrchestratorState);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }
}
