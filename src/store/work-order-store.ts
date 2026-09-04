import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { canonicalJson } from "../crypto/canonical-digest.js";
import type { TaskId } from "../domain/ids.js";
import { acceptSignedWorkOrderExecution, type AcceptedWorkOrderExecution, type PublicKeyResolver } from "../security/work-order-execution-gate.js";
import type { SignedWorkOrder } from "../security/work-order-signature.js";

export interface SignedWorkOrderStore {
  put(envelope: SignedWorkOrder): Promise<void>;
  get(taskId: TaskId, revision: number): Promise<SignedWorkOrder | null>;
}

function safeTask(taskId: TaskId): string {
  if (!/^TASK-[A-Za-z0-9._-]+$/.test(taskId)) throw new Error("INVALID_TASK_ID_FOR_WORK_ORDER_STORE");
  return taskId;
}

export class FileSignedWorkOrderStore implements SignedWorkOrderStore {
  constructor(private readonly root: string) {}
  private path(taskId: TaskId, revision: number): string {
    if (!Number.isInteger(revision) || revision < 0) throw new Error("INVALID_WORK_ORDER_REVISION");
    return join(this.root, `${safeTask(taskId)}.r${revision}.signed.json`);
  }

  async put(envelope: SignedWorkOrder): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const path = this.path(envelope.order.taskId, envelope.order.revision);
    try {
      const existing = JSON.parse(await readFile(path, "utf8")) as SignedWorkOrder;
      if (existing.orderFp !== envelope.orderFp || existing.signatureBase64 !== envelope.signatureBase64) {
        throw new Error("SIGNED_WORK_ORDER_REVISION_IMMUTABLE");
      }
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await writeFile(path, `${canonicalJson(envelope)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  }

  async get(taskId: TaskId, revision: number): Promise<SignedWorkOrder | null> {
    try { return JSON.parse(await readFile(this.path(taskId, revision), "utf8")) as SignedWorkOrder; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async replay(taskId: TaskId, revision: number, resolvePublicKey: PublicKeyResolver): Promise<AcceptedWorkOrderExecution> {
    const envelope = await this.get(taskId, revision);
    if (!envelope) throw new Error("SIGNED_WORK_ORDER_NOT_FOUND");
    return acceptSignedWorkOrderExecution(envelope, resolvePublicKey);
  }
}
