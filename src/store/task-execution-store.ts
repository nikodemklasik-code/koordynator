import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FrozenCandidate } from "../domain/candidate.js";
import type { EvidenceReceipt } from "../domain/evidence.js";
import type { Digest, TaskId } from "../domain/ids.js";
import type { ReleaseRecord } from "../release/release-controller.js";
import { canonicalJson } from "../crypto/canonical-digest.js";

export type StoredTaskExecution = {
  taskId: TaskId;
  revision: number;
  workOrderFp: Digest;
  status: "RELEASED" | "RETURNED" | "AWAITING_HUMAN_APPROVAL";
  candidate: FrozenCandidate;
  receipts: EvidenceReceipt[];
  release?: ReleaseRecord;
  nextRevision?: number;
  reasons?: string[];
};

export interface TaskExecutionStore {
  put(record: StoredTaskExecution): Promise<void>;
  get(taskId: TaskId, revision: number): Promise<StoredTaskExecution | null>;
  latest(taskId: TaskId): Promise<StoredTaskExecution | null>;
}

function safeTask(taskId: TaskId): string {
  if (!/^TASK-[A-Za-z0-9._-]+$/.test(taskId)) throw new Error("INVALID_TASK_ID_FOR_EXECUTION_STORE");
  return taskId;
}

function safeRevision(revision: number): number {
  if (!Number.isInteger(revision) || revision < 0) throw new Error("INVALID_EXECUTION_REVISION");
  return revision;
}

export class FileTaskExecutionStore implements TaskExecutionStore {
  constructor(private readonly root: string) {}

  private path(taskId: TaskId, revision: number): string {
    return join(this.root, `${safeTask(taskId)}.r${safeRevision(revision)}.json`);
  }

  async put(record: StoredTaskExecution): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const target = this.path(record.taskId, record.revision);
    const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temp, `${canonicalJson(record)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temp, target);
  }

  async get(taskId: TaskId, revision: number): Promise<StoredTaskExecution | null> {
    try {
      return JSON.parse(await readFile(this.path(taskId, revision), "utf8")) as StoredTaskExecution;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async latest(taskId: TaskId): Promise<StoredTaskExecution | null> {
    let names: string[];
    try {
      names = await readdir(this.root);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    const escaped = safeTask(taskId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`^${escaped}\\.r(\\d+)\\.json$`);
    const revisions = names
      .map((name) => pattern.exec(name))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => Number(match[1]))
      .filter(Number.isInteger)
      .sort((a, b) => b - a);
    return revisions.length === 0 ? null : this.get(taskId, revisions[0]!);
  }
}
