import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { CapabilityRequest } from "../src/api/capability-api.js";
import type {
  OmniRouteModelSelectionRequest,
  OmniRouteModelSelector
} from "../src/api/omniroute-model-selector.js";
import { canonicalDigest } from "../src/crypto/canonical-digest.js";
import type { Digest } from "../src/domain/ids.js";
import type { MaterializationOrder } from "../src/engine/autonomous-recovery.js";
import type { ExactPackRequestContext } from "../src/engine/exact-pack-agent-materializer.js";
import type { OrchestratorRunRequest } from "../src/orchestrator/orchestrator.js";
import {
  OmniRouteExactPackSource,
  createHarmoniaExactPackDirective,
  type PackAiExecutor
} from "../src/orchestrator/omniroute-exact-pack-source.js";

const raw = (value: string): Digest => `sha256:${createHash("sha256").update(value).digest("hex")}`;

function order(): MaterializationOrder {
  return {
    taskId: "TASK-DYNAMIC-MODEL",
    instructions: "Zainstaluj wyłącznie materiał Harmonii.",
    allowedPaths: ["src/**"],
    suppliedMaterialFp: canonicalDigest("source"),
    expectedResult: "Dokładny plik wynikowy.",
    initiative: "brak"
  };
}

function context(aiRoute = "OmniRoute"): ExactPackRequestContext {
  return {
    order: order(),
    conditions: { agent: "Agent", aiRoute, generation: 0 },
    currentRequest: {
      signedWorkOrder: {
        order: {
          workspaceId: "WS-DYNAMIC-MODEL",
          budget: { timeSec: 60, costLimit: 2 }
        }
      },
      buildVector: {}
    } as unknown as OrchestratorRunRequest
  };
}

function directive() {
  const current = order();
  return createHarmoniaExactPackDirective({
    taskId: current.taskId,
    orderFp: canonicalDigest(current),
    files: [{
      kind: "replace",
      path: "src/a.ts",
      beforeFp: raw("old"),
      contentContract: "export const value = 2; oraz końcowy znak nowej linii"
    }]
  });
}

function executor(capture: (request: CapabilityRequest) => void): PackAiExecutor {
  return {
    async execute<T>(request) {
      capture(request);
      return {
        result: {
          output: {
            choices: [{ message: { content: JSON.stringify({ files: [{ path: "src/a.ts", content: "export const value = 2;\n" }] }) } }]
          } as T
        }
      };
    }
  };
}

describe("OmniRoute exact-pack dynamic model binding", () => {
  it("uses telemetry selection for the generic OmniRoute route and persists its receipt fingerprint", async () => {
    let selected = 0;
    let captured: CapabilityRequest | undefined;
    const selector: OmniRouteModelSelector = {
      async select(request: Readonly<OmniRouteModelSelectionRequest>) {
        selected += 1;
        expect(request).toMatchObject({ purpose: "EXACT_PACK", maxLatencyMs: 60000 });
        return {
          modelId: "openai/gpt-5.6-sol",
          score: 107,
          reasons: ["fidelity=100", "latencyScore=7"],
          snapshotAt: "2026-09-10T10:30:00.000Z",
          selectionFp: canonicalDigest("selection")
        };
      }
    };
    const source = new OmniRouteExactPackSource(executor((request) => { captured = request; }), {
      directive: () => directive(),
      modelSelector: selector
    });

    await source.next(context());

    expect(selected).toBe(1);
    expect((captured?.input as { model?: string } | undefined)?.model).toBe("openai/gpt-5.6-sol");
    expect(source.records()[0]?.aiRoute).toBe("openai/gpt-5.6-sol");
    expect(source.records()[0]?.modelSelection?.selectionFp).toBe(canonicalDigest("selection"));
  });

  it("preserves an explicit non-forbidden route without asking the telemetry selector to overrule Mózg", async () => {
    let selected = 0;
    let captured: CapabilityRequest | undefined;
    const selector: OmniRouteModelSelector = {
      async select() {
        selected += 1;
        throw new Error("selector must not run");
      }
    };
    const source = new OmniRouteExactPackSource(executor((request) => { captured = request; }), {
      directive: () => directive(),
      modelSelector: selector
    });

    await source.next(context("anthropic/claude-sonnet-5"));

    expect(selected).toBe(0);
    expect((captured?.input as { model?: string } | undefined)?.model).toBe("anthropic/claude-sonnet-5");
    expect(source.records()[0]?.modelSelection).toBeUndefined();
  });
});
