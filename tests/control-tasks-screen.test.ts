import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { canonicalDigest } from "../src/crypto/canonical-digest.js";
import type { WorkOrder } from "../src/domain/work-order.js";
import type { OrchestratorState } from "../src/domain/state.js";
import { FileStateStore } from "../src/store/file-state-store.js";
import { FileSignedWorkOrderStore } from "../src/store/work-order-store.js";
import { TaskReadModel } from "../src/control/task-read-model.js";
import { createControlServer } from "../src/control/server.js";

const roots: string[] = [];
const fp = (label: string) => canonicalDigest(label);

function order(taskId: `TASK-${string}`, revision: number, objective: string, module: string): WorkOrder {
  return {
    taskId,
    workspaceId: `WS-${taskId.slice(5)}`,
    revision,
    objective,
    scope: { modules: [module], allowedPaths: ["src/**"] },
    requiredInputs: [],
    capabilities: ["core.echo"],
    budget: { timeSec: 60, costLimit: 0, retries: 0, maxDagDepth: 4 },
    requiredGates: [],
    expectedEvidence: [],
    acceptanceCriteria: ["screen-visible"],
    failureCriteria: ["runtime-failure"],
    securityContractRef: fp("security"),
    performanceContractRef: fp("performance"),
    rollbackRequirement: "REVERSIBLE",
    humanApprovalPolicy: "AUTO_IF_POLICY_PASS",
    policyRef: { policyId: "release", bundleHash: fp("policy") }
  };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "koord-control-"));
  roots.push(root);
  const stateRoot = join(root, "state");
  const workOrderRoot = join(root, "work-orders");
  const states = new FileStateStore(stateRoot);
  const workOrders = new FileSignedWorkOrderStore(workOrderRoot);

  const hello: OrchestratorState = {
    taskId: "TASK-HELLO-001",
    workspaceId: "WS-HELLO-001",
    buildId: "BUILD-HELLO-001-R1",
    revision: 1,
    state: "CREATED",
    changedAt: "2026-09-05T01:00:00.000Z"
  };
  await states.save(hello);
  await states.save({ ...hello, state: "RELEASED", changedAt: "2026-09-05T01:05:00.000Z" });
  const helloOrder = order("TASK-HELLO-001", 1, "Greeting", "hello-world");
  await workOrders.put({ order: helloOrder, orderFp: canonicalDigest(helloOrder), keyId: "alice@company.local", signatureBase64: "test" });

  const pay: OrchestratorState = {
    taskId: "TASK-PAY-014",
    workspaceId: "WS-PAY-014",
    buildId: "BUILD-PAY-014-R2",
    revision: 2,
    state: "RETURNED",
    reasonCode: "STALE_POLICY",
    changedAt: "2026-09-05T02:00:00.000Z"
  };
  await states.save(pay);
  const payOrder = order("TASK-PAY-014", 2, "Payment service", "payment-service");
  await workOrders.put({ order: payOrder, orderFp: canonicalDigest(payOrder), keyId: "bob@company.local", signatureBase64: "test" });

  const approval: OrchestratorState = {
    taskId: "TASK-AUTH-003",
    workspaceId: "WS-AUTH-003",
    buildId: "BUILD-AUTH-003-R3",
    revision: 3,
    state: "APPROVED",
    changedAt: "2026-09-05T03:00:00.000Z"
  };
  await states.save(approval);
  const authOrder = order("TASK-AUTH-003", 3, "Auth flow", "auth-service");
  await workOrders.put({ order: authOrder, orderFp: canonicalDigest(authOrder), keyId: "carol@company.local", signatureBase64: "test" });

  return { root, stateRoot, workOrderRoot };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Tasks control screen read model", () => {
  it("projects real runtime state, signer, target, reason code and counts", async () => {
    const f = await fixture();
    const model = new TaskReadModel(f.stateRoot, f.workOrderRoot);
    const result = await model.list();

    expect(result.counts).toMatchObject({ all: 3, released: 1, returned: 1, awaitingApproval: 1 });
    expect(result.tasks[0]?.taskId).toBe("TASK-AUTH-003");
    expect(result.tasks.find((task) => task.taskId === "TASK-PAY-014")).toMatchObject({
      displayStatus: "RETURNED",
      reasonCode: "STALE_POLICY",
      target: "payment-service",
      initiatedBy: "bob@company.local"
    });
    expect(result.tasks.find((task) => task.taskId === "TASK-AUTH-003")?.displayStatus).toBe("AWAITING_HUMAN_APPROVAL");
  });

  it("filters and searches without inventing lifecycle state", async () => {
    const f = await fixture();
    const model = new TaskReadModel(f.stateRoot, f.workOrderRoot);
    const released = await model.list({ filter: "released" });
    const searched = await model.list({ query: "payment-service" });

    expect(released.tasks.map((task) => task.taskId)).toEqual(["TASK-HELLO-001"]);
    expect(searched.tasks.map((task) => task.taskId)).toEqual(["TASK-PAY-014"]);
  });
});

describe("Tasks control screen HTTP boundary", () => {
  it("serves the real task API and the operator console", async () => {
    const f = await fixture();
    const server = createControlServer({
      stateDir: f.root,
      webRoot: resolve("web/control"),
      environment: "PROD-EU-1",
      region: "eu-west-1",
      zone: "1a",
      operator: "operator@koordynator.local",
      ciVerify: "PASS",
      version: "0.2.0"
    });
    await new Promise<void>((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("TEST_SERVER_ADDRESS_INVALID");
      const base = `http://127.0.0.1:${address.port}`;

      const tasks = await fetch(`${base}/api/tasks?status=returned&q=stale_policy`).then((response) => response.json()) as { tasks: Array<{ taskId: string }> };
      expect(tasks.tasks.map((task) => task.taskId)).toEqual(["TASK-PAY-014"]);

      const health = await fetch(`${base}/api/health`).then((response) => response.json()) as { environment: string; ciVerify: string };
      expect(health).toMatchObject({ environment: "PROD-EU-1", ciVerify: "PASS" });

      const page = await fetch(`${base}/`).then((response) => response.text());
      expect(page).toContain("KOORDYNATOR CONTROL");
      expect(page).toContain("List and manage orchestration tasks.");

      const denied = await fetch(`${base}/api/tasks`, { method: "POST" });
      expect(denied.status).toBe(405);
    } finally {
      await new Promise<void>((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()));
    }
  });
});
