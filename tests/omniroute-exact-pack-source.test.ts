import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalDigest } from "../src/crypto/canonical-digest.js";
import type { Digest } from "../src/domain/ids.js";
import type { MaterializationOrder } from "../src/engine/autonomous-recovery.js";
import type { ExactPackRequestContext } from "../src/engine/exact-pack-agent-materializer.js";
import type { ExecutionConditions } from "../src/engine/materialization-loop.js";
import type { OrchestratorRunRequest } from "../src/orchestrator/orchestrator.js";
import {
  OmniRouteExactPackSource,
  createHarmoniaExactPackDirective,
  type PackAiExecutor
} from "../src/orchestrator/omniroute-exact-pack-source.js";
import type { CapabilityRequest } from "../src/api/capability-api.js";

const d = (value: unknown): Digest => canonicalDigest(value);
const raw = (value: string): Digest => `sha256:${createHash("sha256").update(value).digest("hex")}`;

function order(): MaterializationOrder {
  return {
    taskId: "TASK-OMNI-PACK",
    instructions: "Zmaterializuj wyłącznie wskazane pliki zgodnie z kontraktem Harmonii.",
    allowedPaths: ["src/**"],
    suppliedMaterialFp: d("source"),
    expectedResult: "src/a.ts zawiera dokładny rezultat kontraktu.",
    initiative: "brak"
  };
}

function currentRequest(): OrchestratorRunRequest {
  return {
    signedWorkOrder: {
      order: {
        workspaceId: "WS-OMNI-PACK",
        budget: { timeSec: 60, costLimit: 2 }
      }
    },
    buildVector: {}
  } as unknown as OrchestratorRunRequest;
}

function context(aiRoute = "OmniRoute", correction?: string): ExactPackRequestContext {
  const conditions: ExecutionConditions = { agent: "Agent", aiRoute, generation: 0 };
  return {
    order: order(),
    conditions,
    currentRequest: currentRequest(),
    ...(correction === undefined ? {} : { correction })
  };
}

function directive() {
  const o = order();
  return createHarmoniaExactPackDirective({
    taskId: o.taskId,
    orderFp: canonicalDigest(o),
    files: [{
      kind: "replace",
      path: "src/a.ts",
      beforeFp: raw("old"),
      contentContract: "Zwróć dokładną docelową treść pliku: export const value = 2; z końcowym znakiem nowej linii."
    }]
  });
}

function executorReturning(files: Array<{ path: string; content: string }>, capture?: (request: CapabilityRequest) => void): PackAiExecutor {
  return {
    async execute<T>(request: CapabilityRequest) {
      capture?.(request);
      return {
        result: {
          output: {
            choices: [{ message: { content: JSON.stringify({ files }) } }]
          } as T
        }
      };
    }
  };
}

describe("OmniRoute exact-pack source", () => {
  it("lets AI fill only contents while Harmonia fixes paths, operation kind and before fingerprint", async () => {
    const source = new OmniRouteExactPackSource(
      executorReturning([{ path: "src/a.ts", content: "export const value = 2;\n" }]),
      { directive: () => directive() }
    );

    const pack = await source.next(context());
    expect(pack.operations).toEqual([{
      kind: "replace",
      path: "src/a.ts",
      content: "export const value = 2;\n",
      beforeFp: raw("old"),
      afterFp: raw("export const value = 2;\n")
    }]);
    expect(source.records()).toHaveLength(1);
    expect(source.records()[0]?.aiRoute).toBe("auto/best-free");
    expect(source.records()[0]?.directiveFp).toBe(directive().directiveFp);
  });

  it("rejects any undeclared file returned by the model", async () => {
    const source = new OmniRouteExactPackSource(
      executorReturning([
        { path: "src/a.ts", content: "export const value = 2;\n" },
        { path: "src/surprise.ts", content: "export const surprise = true;\n" }
      ]),
      { directive: () => directive() }
    );

    await expect(source.next(context())).rejects.toThrow("OMNIROUTE_PACK_FILE_COUNT_MISMATCH");
    expect(source.records()).toHaveLength(0);
  });

  it("rejects a mutated or out-of-scope Harmonia directive before calling AI", async () => {
    let calls = 0;
    const o = order();
    const valid = createHarmoniaExactPackDirective({
      taskId: o.taskId,
      orderFp: canonicalDigest(o),
      files: [{ kind: "create", path: "secrets/key.txt", contentContract: "x" }]
    });
    const source = new OmniRouteExactPackSource(
      executorReturning([], () => { calls += 1; }),
      { directive: () => valid }
    );

    await expect(source.next(context())).rejects.toThrow("HARMONIA_PACK_PATH_OUT_OF_SCOPE:secrets/key.txt");
    expect(calls).toBe(0);
  });

  it("passes the exact correction into the next immutable AI request", async () => {
    let captured: CapabilityRequest | undefined;
    const source = new OmniRouteExactPackSource(
      executorReturning([{ path: "src/a.ts", content: "export const value = 2;\n" }], (request) => { captured = request; }),
      { directive: () => directive() }
    );

    await source.next(context("OmniRoute", "Ustaw dokładnie value = 2; nie zmieniaj niczego poza tym plikiem."));
    expect(captured?.capability).toBe("ai.code");
    expect(captured?.role).toBe("PLANNER");
    expect(JSON.stringify(captured?.input)).toContain("Ustaw dokładnie value = 2");
    expect(captured?.requirements.allowProviderFailover).toBe(false);
  });

  it("forbids an explicit DeepSeek route", async () => {
    let calls = 0;
    const source = new OmniRouteExactPackSource(
      executorReturning([], () => { calls += 1; }),
      { directive: () => directive() }
    );

    await expect(source.next(context("deepseek/anything"))).rejects.toThrow("FORBIDDEN_MODEL_ROUTE");
    expect(calls).toBe(0);
  });
});
