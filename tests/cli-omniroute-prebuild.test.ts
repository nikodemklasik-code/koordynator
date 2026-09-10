import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalDigest } from "../src/crypto/canonical-digest.js";
import { measureBuildVector } from "../src/build/tree-fingerprint.js";
import type { WorkOrder } from "../src/domain/work-order.js";
import type { OrchestratorRunRequest, OrchestratorRunResult } from "../src/orchestrator/orchestrator.js";
import {
  cliOmniRoutePrebuildAuthorityFingerprint,
  runCliOmniRoutePrebuild,
  type CliOmniRoutePrebuildConfig
} from "../src/cli/omniroute-prebuild-runner.js";

function config(): CliOmniRoutePrebuildConfig {
  return {
    enabled: true,
    authorityInputUri: "harmonia://prebuild/TASK-CLI-PREBUILD",
    instructions: "Zmaterializuj wyłącznie dostarczony materiał. Bez inicjatywy.",
    expectedResult: "Dokładny plik TypeScript.",
    files: [
      {
        kind: "create",
        path: "src/live.ts",
        contentContract: "Treść dokładnie: export const CLI_PREBUILD_OK = true; oraz końcowy znak nowej linii."
      }
    ],
    qc1: [
      {
        name: "exact-content",
        command: process.execPath,
        args: [
          "-e",
          "const fs=require('fs');if(fs.readFileSync('src/live.ts','utf8')!=='export const CLI_PREBUILD_OK = true;\\n')process.exit(1)"
        ],
        proposedSolution: "Zapisz dokładnie treść wymaganą przez kontrakt.",
        timeoutMs: 10_000
      }
    ],
    defaultModel: "openai/gpt-5.6-sol",
    maxLatencyMs: 120_000,
    telemetryTimeoutMs: 5_000,
    maxAgentCorrections: 2
  };
}

async function request(root: string, prebuild: CliOmniRoutePrebuildConfig): Promise<OrchestratorRunRequest> {
  const fixed = {
    dependencyFp: canonicalDigest("deps"),
    configFp: canonicalDigest("config"),
    generatedSourcesFp: canonicalDigest("generated"),
    toolchainFp: canonicalDigest("toolchain"),
    buildEnvironmentFp: canonicalDigest("environment")
  };
  const measured = await measureBuildVector(root, fixed);
  const workOrder: WorkOrder = {
    taskId: "TASK-CLI-PREBUILD",
    workspaceId: "WS-CLI-PREBUILD",
    revision: 0,
    objective: "Zweryfikuj produkcyjny prebuild.",
    scope: { modules: ["test"], allowedPaths: ["src/**"] },
    requiredInputs: [
      {
        uri: prebuild.authorityInputUri,
        digest: cliOmniRoutePrebuildAuthorityFingerprint(prebuild)
      }
    ],
    capabilities: ["ai.code"],
    budget: { timeSec: 120, costLimit: 5, retries: 1, maxDagDepth: 2 },
    requiredGates: [],
    expectedEvidence: [],
    acceptanceCriteria: ["prebuild 1/1"],
    failureCriteria: ["materializacja niezgodna"],
    securityContractRef: canonicalDigest("security"),
    performanceContractRef: canonicalDigest("performance"),
    rollbackRequirement: "REVERSIBLE",
    humanApprovalPolicy: "AUTO_IF_POLICY_PASS",
    policyRef: { policyId: "test", bundleHash: canonicalDigest("policy") }
  };
  return {
    signedWorkOrder: {
      order: workOrder,
      orderFp: canonicalDigest(workOrder),
      keyId: "test",
      signatureBase64: "placeholder"
    },
    buildVector: measured.vector,
    moduleManifestFp: canonicalDigest("manifest")
  };
}

function fakeFetch(): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.endsWith("/healthz")) return new Response("ok", { status: 200 });
    if (url.endsWith("/api/v1/models") || url.endsWith("/v1/models")) {
      return Response.json({ data: [{ id: "openai/gpt-5.6-sol" }] });
    }
    if (
      url.endsWith("/api/token-health")
      || url.endsWith("/api/rate-limits")
      || url.endsWith("/api/usage/budget")
      || url.endsWith("/api/usage/model-latency-stats")
      || url.endsWith("/api/pricing/models")
    ) {
      return new Response("forbidden", { status: 403 });
    }
    if (url.endsWith("/v1/chat/completions")) {
      expect(init?.headers).toBeDefined();
      return Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({ files: [{ path: "src/live.ts", content: "export const CLI_PREBUILD_OK = true;\n" }] })
            }
          }
        ]
      });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

describe("CLI OmniRoute prebuild", () => {
  it("binds the complete prebuild authority to a signed required input digest", async () => {
    const prebuild = config();
    const root = await mkdtemp(join(tmpdir(), "koord-cli-authority-"));
    try {
      const current = await request(root, prebuild);
      const tampered = { ...prebuild, expectedResult: "Inny wynik." };
      const downstream = { async run(): Promise<OrchestratorRunResult> { throw new Error("must not run"); } };
      await expect(runCliOmniRoutePrebuild(downstream, current, root, tampered, { fetchImpl: fakeFetch() }))
        .rejects.toThrow("CLI_PREBUILD_AUTHORITY_MISMATCH");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("runs exact-pack materialization, opposing guard and QC1 before downstream", async () => {
    const previous = process.env.OMNIROUTE_API_KEY;
    process.env.OMNIROUTE_API_KEY = "test-secret-never-logged";
    const root = await mkdtemp(join(tmpdir(), "koord-cli-prebuild-"));
    const prebuild = config();
    let downstreamCalls = 0;
    try {
      const current = await request(root, prebuild);
      const downstream = {
        async run(): Promise<OrchestratorRunResult> {
          downstreamCalls += 1;
          return {
            status: "RELEASED",
            candidate: {} as OrchestratorRunResult["candidate"],
            receipts: []
          };
        }
      };
      const outcome = await runCliOmniRoutePrebuild(downstream, current, root, prebuild, { fetchImpl: fakeFetch() });
      expect(outcome.status).toBe("EXECUTED");
      expect(downstreamCalls).toBe(1);
      expect(await readFile(join(root, "src/live.ts"), "utf8")).toBe("export const CLI_PREBUILD_OK = true;\n");
      expect(outcome.trace).toHaveLength(1);
      expect(outcome.trace[0]).toMatchObject({ opposing: 1, qc1: 1, action: "dalej" });
    } finally {
      if (previous === undefined) delete process.env.OMNIROUTE_API_KEY;
      else process.env.OMNIROUTE_API_KEY = previous;
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a forbidden default model before any provider call", () => {
    const prebuild = { ...config(), defaultModel: "deepseek/anything" };
    expect(() => cliOmniRoutePrebuildAuthorityFingerprint(prebuild)).toThrow("CLI_PREBUILD_FORBIDDEN_MODEL");
  });
});
