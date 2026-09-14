import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { TaskId } from "../domain/ids.js";

export type DeliveryProcessState = "APPROVED" | "RUNNING" | "NEEDS_RESUME" | "FAILED";

export type DeliveryProcess = {
  processId: string;
  sessionId: string;
  taskId: TaskId;
  state: DeliveryProcessState;
  objective: string;
  modules: string[];
  allowedPaths: string[];
  acceptanceCriteria: string[];
  approvedScopeFingerprint: string;
  workOrderFingerprint: string;
  baseSha?: string;
  worktreePath?: string;
  branch?: string;
  commitSha?: string;
  createdAt: string;
  updatedAt: string;
};

export class DeliveryProcessError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
    this.name = "DeliveryProcessError";
  }
}

function root(stateDir: string): string {
  return join(resolve(stateDir), "delivery-processes");
}

function pathFor(stateDir: string, processId: string): string {
  if (!/^PROC-[A-Za-z0-9._-]+$/.test(processId)) throw new DeliveryProcessError("DELIVERY_PROCESS_ID_INVALID", 400);
  return join(root(stateDir), `${processId}.json`);
}

export class DeliveryProcessStore {
  constructor(private readonly stateDir: string) {}

  async put(process: DeliveryProcess): Promise<void> {
    await mkdir(root(this.stateDir), { recursive: true, mode: 0o700 });
    const now = process.updatedAt;
    await writeFile(pathFor(this.stateDir, process.processId), `${JSON.stringify({ ...process, updatedAt: now }, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
  }

  async get(processId: string): Promise<DeliveryProcess | null> {
    try {
      return JSON.parse(await readFile(pathFor(this.stateDir, processId), "utf8")) as DeliveryProcess;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async getBySessionId(sessionId: string): Promise<DeliveryProcess | null> {
    const all = await this.list();
    return all.find((item) => item.sessionId === sessionId) ?? null;
  }

  async getByTaskId(taskId: TaskId): Promise<DeliveryProcess | null> {
    const all = await this.list();
    return all.find((item) => item.taskId === taskId) ?? null;
  }

  async list(): Promise<DeliveryProcess[]> {
    try {
      const names = await readdir(root(this.stateDir));
      const rows: DeliveryProcess[] = [];
      for (const name of names) {
        if (!name.endsWith(".json")) continue;
        rows.push(JSON.parse(await readFile(join(root(this.stateDir), name), "utf8")) as DeliveryProcess);
      }
      return rows;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }
}
