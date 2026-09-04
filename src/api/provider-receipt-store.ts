import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { TaskId } from "../domain/ids.js";
import type { ProviderExecutionReceipt } from "./provider-receipt.js";

export interface ProviderReceiptStore {
  put(receipt: ProviderExecutionReceipt): Promise<void>;
  listByTask(taskId: TaskId): Promise<ProviderExecutionReceipt[]>;
}

export class MemoryProviderReceiptStore implements ProviderReceiptStore {
  private readonly items = new Map<string, ProviderExecutionReceipt>();

  async put(receipt: ProviderExecutionReceipt): Promise<void> {
    const existing = this.items.get(receipt.receiptFp);
    if (existing && JSON.stringify(existing) !== JSON.stringify(receipt)) throw new Error("PROVIDER_RECEIPT_IMMUTABLE");
    this.items.set(receipt.receiptFp, structuredClone(receipt));
  }

  async listByTask(taskId: TaskId): Promise<ProviderExecutionReceipt[]> {
    return [...this.items.values()]
      .filter((receipt) => receipt.taskId === taskId)
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.receiptFp.localeCompare(b.receiptFp))
      .map((receipt) => structuredClone(receipt));
  }
}

function safeTaskId(taskId: TaskId): string {
  if (!/^TASK-[A-Za-z0-9._-]+$/.test(taskId)) throw new Error("INVALID_TASK_ID_FOR_PROVIDER_RECEIPT_STORE");
  return taskId;
}

function safeReceiptFile(receiptFp: string): string {
  const match = /^sha256:([a-f0-9]{64})$/i.exec(receiptFp);
  if (!match) throw new Error("INVALID_PROVIDER_RECEIPT_FP");
  return `${match[1]}.json`;
}

export class FileProviderReceiptStore implements ProviderReceiptStore {
  constructor(private readonly root: string) {}

  private taskDir(taskId: TaskId): string { return join(this.root, safeTaskId(taskId)); }

  async put(receipt: ProviderExecutionReceipt): Promise<void> {
    const dir = this.taskDir(receipt.taskId);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const path = join(dir, safeReceiptFile(receipt.receiptFp));
    const payload = `${JSON.stringify(receipt, null, 2)}\n`;
    try {
      const existing = await readFile(path, "utf8");
      if (existing !== payload) throw new Error("PROVIDER_RECEIPT_IMMUTABLE");
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await writeFile(path, payload, { encoding: "utf8", mode: 0o600, flag: "wx" });
  }

  async listByTask(taskId: TaskId): Promise<ProviderExecutionReceipt[]> {
    const dir = this.taskDir(taskId);
    try {
      const files = (await readdir(dir)).filter((name) => name.endsWith(".json")).sort();
      const receipts = await Promise.all(files.map(async (name) => JSON.parse(await readFile(join(dir, name), "utf8")) as ProviderExecutionReceipt));
      return receipts.sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.receiptFp.localeCompare(b.receiptFp));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }
}
