import { generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalDigest } from "../src/crypto/canonical-digest.js";
import { measureBuildVector } from "../src/build/tree-fingerprint.js";
import type { WorkOrder } from "../src/domain/work-order.js";
import { signWorkOrder, verifySignedWorkOrder } from "../src/security/work-order-signature.js";
import type { OrchestratorRunRequest, OrchestratorRunResult } from "../src/orchestrator/orchestrator.js";
import { assertAutonomousRetryInvariant, type AutonomousRecoveryContext, type ReturnedRunResult } from "../src/orchestrator/autonomous-orchestrator.js";
import {
  CliDelegatedAutonomousRecovery,
  assertCliAutonomousExecutionAuthority,
  assertDelegatedExecutionPrivateKey,
  cliAutonomousExecutionAuthorityFingerprint,
  type CliAutonomousExecutionConfig
} from "../src/cli/delegated-autonomous-runner.js";
import {
  cliOmniRoutePrebuildAuthorityFingerprint,
  type CliOmniRoutePrebuildConfig
} from "../src/cli/omniroute-prebuild-runner.js";

const d = (value: unknown) => canonicalDigest(value);

function pem(key: ReturnType<typeof generateKeyPairSync>["publicKey"]): string {
  return key.export({ type: "spki", format: "pem" }).toString();
}

function prebuild(): CliOmniRoutePrebuildConfig {
  return {
    enabled: true,
    authorityInputUri: "harmonia://prebuild/TASK-DELEGATED-RECOVERY",
    instructions: "Zmaterializuj wyłącznie dostarczony plik. Bez inicjatywy.",
    expectedResult: "Plik przechodzi kontrolę źródła.",
    files: [
      {
        kind: "create",
        path: "src/value.ts",
        contentContract: "Bez korekty zachowaj kontrakt bazowy. Jeżeli przekazano correction, wykonaj correction dokładnie dla tego samego pliku."
      }
    ],
    qc1: [
      {
        name: "fixed-source",
        command: process.execPath,
        args: [
          "-e",
          "const fs=require('fs');if(fs.readFileSync('src/value.ts','utf8')!=='export const FIXED = true;\\n')process.exit(1)"
        ],
        proposedSolution: "Zastosuj dokładnie podpisaną korektę wykonawczą.",
        timeoutMs: 10_000
      }
    ],
    defaultModel: "openai/gpt-5.6-sol",
    maxLatencyMs: 120_000,
    telemetryTimeoutMs: 5_000,
    maxAgentCorrections: 1
  };
}

function autonomous(delegatePublicKeyPem: string): CliAutonomousExecutionConfig {
  return {
    enabled: true,
    authorityInputUri: "harmonia://autonomous/TASK-DELEGATED-RECOVERY",
    delegateKeyId: "brain-execution",
    delegatePublicKeyPem,
    recoveryCorrections: [
      {
        reason: "FAIL:unit",
        correction: "Dla src/value.ts zapisz dokładnie: export const FIXED = true; oraz końcowy znak nowej linii."
      }
    ]
  };
}

function workOrder(
  prebuildConfig: CliOmniRoutePrebuildConfig,
  autonomousConfig: CliAutonomousExecutionConfig
): WorkOrder {
  return {
    taskId: "TASK-DELEGATED-RECOVERY",
    workspaceId: "WS-DELEGATED-RECOVERY",
    revision: 0,
    objective: "Napraw dokładnie zatwierdzony element.",
    scope: { modules: ["core"], allowedPaths: ["src/**"] },
    requiredInputs: [
      {
        uri: prebuildConfig.authorityInputUri,
        digest: cliOmniRoutePrebuildAuthorityFingerprint(prebuildConfig)
      },
      {
        uri: autonomousConfig.authorityInputUri,
        digest: cliAutonomousExecutionAuthorityFingerprint(autonomousConfig)
      }
    ],
    capabilities: ["ai.code", "repo.write"],
    budget: { timeSec: 120, costLimit: 5, retries: 1, maxDagDepth: 4 },
    requiredGates: ["unit"],
    expectedEvidence: ["dependency"],
    acceptanceCriteria: ["unit gate passes"],
    failureCriteria: ["unit gate fails"],
    securityContractRef: d("security"),
    performanceContractRef: d("performance"),
    rollbackRequirement: "REVERSIBLE",
    humanApprovalPolicy: "AUTO_IF_POLICY_PASS",
    policyRef: { policyId: "release", bundleHash: d("policy") }
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
    ) return new Response("forbidden", { status: 403 });
    if (url.endsWith("/v1/chat/completions")) {
      const body = typeof init?.body === "string" ? init.body : "";
      expect(body).toContain("Dla src/value.ts zapisz dokładnie");
      return Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                files: [{ path: "src/value.ts", content: "export const FIXED = true;\n" }]
              })
            }
          }
        ]
      });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

async function recoveryContext(
  root: string,
  prebuildConfig: CliOmniRoutePrebuildConfig,
  autonomousConfig: CliAutonomousExecutionConfig,
  ownerPrivateKey: ReturnType<typeof generateKeyPairSync>["privateKey"],
  reasons: string[] = ["FAIL:unit"]
): Promise<AutonomousRecoveryContext> {
  const vector = await measureBuildVector(root, {
    dependencyFp: d("deps"),
    configFp: d("config"),
    generatedSourcesFp: d("generated"),
    toolchainFp: d("toolchain"),
    buildEnvironmentFp: d("environment")
  });
  const request: OrchestratorRunRequest = {
    signedWorkOrder: signWorkOrder(workOrder(prebuildConfig, autonomousConfig), "owner", ownerPrivateKey),
    buildVector: vector.vector,
    moduleManifestFp: d("manifest")
  };
  const result: ReturnedRunResult = {
    status: "RETURNED",
    candidate: {} as OrchestratorRunResult["candidate"],
    receipts: [],
    nextRevision: 1,
    reasons
  };
  return {
    request,
    result,
    recoveryAttempt: 1,
    remainingRetries: 1
  };
}

describe("delegated autonomous CLI recovery", () => {
  it("materializes the signed correction and returns a delegated revision without governance drift", async () => {
    const root = await mkdtemp(join(tmpdir(), "koord-delegated-recovery-"));
    const previous = process.env.OMNIROUTE_API_KEY;
    process.env.OMNIROUTE_API_KEY = "test-secret-never-logged";
    try {
      await mkdir(join(root, "src"), { recursive: true });
      await writeFile(join(root, "src/value.ts"), "export const FIXED = false;\n", "utf8");
      const owner = generateKeyPairSync("ed25519");
      const delegate = generateKeyPairSync("ed25519");
      const p = prebuild();
      const a = autonomous(pem(delegate.publicKey));
      const context = await recoveryContext(root, p, a, owner.privateKey);
      const recovery = new CliDelegatedAutonomousRecovery({
        sourceDir: root,
        prebuild: p,
        authority: a,
        delegatePrivateKey: delegate.privateKey,
        fetchImpl: fakeFetch()
      });

      const decision = await recovery.recover(context);
      expect(decision.action).toBe("retry");
      if (decision.action !== "retry") throw new Error("EXPECTED_RETRY");
      expect(decision.request.signedWorkOrder.keyId).toBe("brain-execution");
      expect(decision.request.signedWorkOrder.order.revision).toBe(1);
      expect(verifySignedWorkOrder(decision.request.signedWorkOrder, delegate.publicKey)).toBe(true);
      expect(await readFile(join(root, "src/value.ts"), "utf8")).toBe("export const FIXED = true;\n");
      expect(() => assertAutonomousRetryInvariant(context.request, context.result, decision.request)).not.toThrow();
    } finally {
      if (previous === undefined) delete process.env.OMNIROUTE_API_KEY;
      else process.env.OMNIROUTE_API_KEY = previous;
      await rm(root, { recursive: true, force: true });
    }
  });

  it("stops instead of inventing a correction that was not signed by the owner", async () => {
    const root = await mkdtemp(join(tmpdir(), "koord-delegated-stop-"));
    try {
      await mkdir(join(root, "src"), { recursive: true });
      await writeFile(join(root, "src/value.ts"), "export const FIXED = false;\n", "utf8");
      const owner = generateKeyPairSync("ed25519");
      const delegate = generateKeyPairSync("ed25519");
      const p = prebuild();
      const a = autonomous(pem(delegate.publicKey));
      const context = await recoveryContext(root, p, a, owner.privateKey, ["FAIL:security"]);
      const recovery = new CliDelegatedAutonomousRecovery({
        sourceDir: root,
        prebuild: p,
        authority: a,
        delegatePrivateKey: delegate.privateKey,
        fetchImpl: fakeFetch()
      });
      const decision = await recovery.recover(context);
      expect(decision.action).toBe("stop");
      if (decision.action === "stop") expect(decision.reason).toContain("Brak podpisanej korekty wykonawczej");
      expect(await readFile(join(root, "src/value.ts"), "utf8")).toBe("export const FIXED = false;\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a mismatched delegated private key and tampered authority digest", async () => {
    const root = await mkdtemp(join(tmpdir(), "koord-delegated-key-"));
    try {
      await mkdir(join(root, "src"), { recursive: true });
      await writeFile(join(root, "src/value.ts"), "export const FIXED = false;\n", "utf8");
      const owner = generateKeyPairSync("ed25519");
      const delegate = generateKeyPairSync("ed25519");
      const wrong = generateKeyPairSync("ed25519");
      const p = prebuild();
      const a = autonomous(pem(delegate.publicKey));
      expect(() => assertDelegatedExecutionPrivateKey(a, wrong.privateKey)).toThrow("CLI_AUTONOMOUS_DELEGATE_KEY_MISMATCH");

      const context = await recoveryContext(root, p, a, owner.privateKey);
      const tamperedOrder = structuredClone(context.request.signedWorkOrder.order);
      const authority = tamperedOrder.requiredInputs.find((input) => input.uri === a.authorityInputUri)!;
      authority.digest = d("tampered-authority");
      const tampered = signWorkOrder(tamperedOrder, "owner", owner.privateKey);
      expect(() => assertCliAutonomousExecutionAuthority(tampered, a)).toThrow("CLI_AUTONOMOUS_AUTHORITY_MISMATCH");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("treats required input digests as immutable governance across retries", async () => {
    const root = await mkdtemp(join(tmpdir(), "koord-governance-input-"));
    try {
      await mkdir(join(root, "src"), { recursive: true });
      await writeFile(join(root, "src/value.ts"), "export const FIXED = false;\n", "utf8");
      const owner = generateKeyPairSync("ed25519");
      const delegate = generateKeyPairSync("ed25519");
      const p = prebuild();
      const a = autonomous(pem(delegate.publicKey));
      const context = await recoveryContext(root, p, a, owner.privateKey);
      const nextOrder = structuredClone(context.request.signedWorkOrder.order);
      nextOrder.revision = 1;
      nextOrder.requiredInputs[0]!.digest = d("different-input");
      const next: OrchestratorRunRequest = {
        ...context.request,
        signedWorkOrder: signWorkOrder(nextOrder, "brain-execution", delegate.privateKey)
      };
      expect(() => assertAutonomousRetryInvariant(context.request, context.result, next)).toThrow("AUTONOMOUS_RETRY_SCOPE_CHANGED");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
