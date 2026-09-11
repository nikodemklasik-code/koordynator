import { createPrivateKey, randomUUID, type KeyObject } from "node:crypto";
import { canonicalDigest } from "../crypto/canonical-digest.js";
import type { Digest, TaskId, WorkspaceId } from "../domain/ids.js";
import { validateWorkOrder, type WorkOrder } from "../domain/work-order.js";
import { signWorkOrder, type SignedWorkOrder } from "../security/work-order-signature.js";
import { FileSignedWorkOrderStore } from "../store/work-order-store.js";
import { FileStateStore } from "../store/file-state-store.js";
import { controlRoots } from "./task-read-model.js";

export type MaterialisationRequest = {
  objective: string;
  modules: string[];
  allowedPaths: string[];
  acceptanceCriteria: string[];
};

export type MaterialisationResult = {
  taskId: TaskId;
  workspaceId: WorkspaceId;
  revision: number;
  state: "CREATED";
  orderFp: Digest;
  keyId: string;
  createdAt: string;
};

export class MaterialisationError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
    this.name = "MaterialisationError";
  }
}

const MAX_ITEMS = 40;

function cleanList(value: unknown, code: string, { max = MAX_ITEMS } = {}): string[] {
  if (!Array.isArray(value)) throw new MaterialisationError(code, 400);
  const items = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .slice(0, max);
  if (items.length === 0) throw new MaterialisationError(code, 400);
  if (items.some((item) => item.length > 400)) throw new MaterialisationError(code, 400);
  return [...new Set(items)];
}

/** Scope paths must stay inside the workspace: no traversal, no absolute paths. */
function cleanPaths(value: unknown): string[] {
  const paths = cleanList(value, "MATERIALISATION_SCOPE_INVALID");
  for (const path of paths) {
    if (path.startsWith("/") || path.includes("..") || /[\u0000-\u001f]/.test(path)) {
      throw new MaterialisationError("MATERIALISATION_SCOPE_INVALID", 400);
    }
  }
  return paths;
}

function slug(objective: string): string {
  const base = objective
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase()
    .slice(0, 28);
  return base || "PROJECT";
}

/**
 * Turns an agreed chat plan into a signed WorkOrder plus durable CREATED state, so the task
 * appears in Tasks exactly like a CLI-signed one. The signing key stays server-side; callers
 * must gate this behind an explicit user request.
 */
export class MaterialisationService {
  private readonly privateKey: KeyObject;

  constructor(
    privateKeyPem: string,
    private readonly keyId: string,
    private readonly stateDir: string,
    private readonly policyId = "chat-materialisation"
  ) {
    try {
      this.privateKey = createPrivateKey(privateKeyPem);
    } catch {
      throw new MaterialisationError("MATERIALISATION_SIGNING_KEY_INVALID", 500);
    }
  }

  async materialise(input: MaterialisationRequest): Promise<MaterialisationResult> {
    const objective = typeof input?.objective === "string" ? input.objective.trim() : "";
    if (!objective || objective.length > 500) throw new MaterialisationError("MATERIALISATION_OBJECTIVE_INVALID", 400);

    const modules = cleanList(input?.modules, "MATERIALISATION_MODULES_INVALID");
    const allowedPaths = cleanPaths(input?.allowedPaths);
    const acceptanceCriteria = cleanList(input?.acceptanceCriteria, "MATERIALISATION_CRITERIA_INVALID");

    const suffix = randomUUID().slice(0, 8).toUpperCase();
    const taskId = `TASK-${slug(objective)}-${suffix}` as TaskId;
    const workspaceId = `WS-${slug(objective)}-${suffix}` as WorkspaceId;
    const revision = 1;

    const order: WorkOrder = {
      taskId,
      workspaceId,
      revision,
      objective,
      scope: { modules, allowedPaths },
      requiredInputs: [],
      capabilities: ["core.echo"],
      budget: { timeSec: 1800, costLimit: 0, retries: 1, maxDagDepth: 6 },
      requiredGates: ["unit", "static"],
      expectedEvidence: ["contract"],
      acceptanceCriteria,
      failureCriteria: ["runtime-failure", "gate-failure"],
      securityContractRef: canonicalDigest({ contract: "security", taskId }),
      performanceContractRef: canonicalDigest({ contract: "performance", taskId }),
      rollbackRequirement: "REVERSIBLE",
      // Chat-originated work still goes through the normal policy gate downstream.
      humanApprovalPolicy: "HUMAN_REQUIRED",
      policyRef: { policyId: this.policyId, bundleHash: canonicalDigest({ policy: this.policyId }) }
    };

    validateWorkOrder(order);
    const envelope: SignedWorkOrder = signWorkOrder(order, this.keyId, this.privateKey);

    const roots = controlRoots(this.stateDir);
    await new FileSignedWorkOrderStore(roots.workOrderRoot).put(envelope);

    const createdAt = new Date().toISOString();
    await new FileStateStore(roots.stateRoot).save({
      taskId,
      workspaceId,
      buildId: `BUILD-${slug(objective)}-${suffix}-R${revision}`,
      revision,
      state: "CREATED",
      changedAt: createdAt
    });

    return { taskId, workspaceId, revision, state: "CREATED", orderFp: envelope.orderFp, keyId: this.keyId, createdAt };
  }
}
