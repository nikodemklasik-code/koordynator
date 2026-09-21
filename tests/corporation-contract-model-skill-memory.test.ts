import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { accountabilityForRole, createAssignmentReceipt } from "../src/corporation/accountability.js";
import { chooseDelegation } from "../src/corporation/delegation.js";
import { createWorkFailure, routeFailure } from "../src/corporation/failure-routing.js";
import { CorporateLearningMemory } from "../src/corporation/learning-memory.js";
import { selectModel, type ModelProfile } from "../src/corporation/model-selection.js";
import { defaultOrganizationModel } from "../src/corporation/organization.js";
import { PluginRegistry } from "../src/corporation/plugins.js";
import { createVerificationReceipt } from "../src/corporation/receipts.js";
import { bindSkillsToTask, type SkillManifest } from "../src/corporation/skills.js";
import { VerifierTrustRegistry } from "../src/corporation/verification-trust.js";
import type { RoleContract, SolutionMetrics } from "../src/corporation/domain.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function role(): RoleContract {
  const now = new Date().toISOString();
  return {
    roleId: "ROLE-CODE-BUILDER",
    name: "Code Builder",
    departmentId: "DEPT-PRODUCTION",
    mission: "Implement one assigned code stage.",
    capabilities: ["code", "typescript"],
    allowedEffects: ["fs.write"],
    allowedTools: ["fs.read", "fs.write"],
    decisionRights: ["implement-within-scope"],
    successMeasures: ["build output exists", "execution receipt exists"],
    risk: "MEDIUM",
    status: "ACTIVE",
    version: 1,
    constitutionalSeed: false,
    createdBy: "HR",
    createdAt: now,
    updatedAt: now
  };
}

const model: ModelProfile = {
  profileId: "PROFILE-1",
  providerId: "provider-a",
  modelId: "model-code",
  family: "family-a",
  declaredStrengths: ["code", "reasoning"],
  supportedCapabilities: ["code", "typescript", "review"],
  supportedToolsets: ["fs.read", "fs.write"],
  constraints: [],
  contextClass: "LONG",
  structuredOutput: true,
  toolCalling: true,
  vision: false,
  backgroundWork: true,
  risk: "LOW",
  evidence: [{
    sourceId: "OFFICIAL-1",
    kind: "OFFICIAL_MODEL_CARD",
    reference: "provider/model-card",
    providerId: "provider-a",
    modelId: "model-code",
    modelVersion: "2026-09",
    documentDigest: "sha256:model-card-1",
    observedAt: new Date().toISOString(),
    claims: [
      "capability:code",
      "capability:typescript",
      "capability:review",
      "tool:fs.read",
      "tool:fs.write",
      "feature:structured-output",
      "feature:tool-calling",
      "context:long",
      "strength:code",
      "strength:reasoning"
    ]
  }]
};

const metrics: SolutionMetrics = {
  correctness: 0.95,
  security: 0.95,
  maintainability: 0.9,
  reversibility: 0.9,
  architectureFit: 0.9,
  productValue: 0.8,
  regressionRisk: 0.1,
  complexity: 0.2,
  moneyCost: 0,
  tokenCost: 0,
  latency: 0.1
};

function learningTrust(): VerifierTrustRegistry {
  return new VerifierTrustRegistry([
    {
      trustRootId: "trust-local",
      verifierId: "local-test",
      independentGroupId: "group-local",
      providerLineageId: "lineage-local",
      authority: "CORE",
      revoked: false,
      validFrom: new Date(Date.now() - 1000).toISOString()
    },
    {
      trustRootId: "trust-qc",
      verifierId: "qc-review",
      independentGroupId: "group-qc",
      providerLineageId: "lineage-qc",
      authority: "QC",
      revoked: false,
      validFrom: new Date(Date.now() - 1000).toISOString()
    }
  ]);
}

describe("role accountability and separation of duties", () => {
  it("keeps a code builder focused on build work and routes its failure to separate units", () => {
    const contract = accountabilityForRole(role(), {
      responsibilityScope: ["implement assigned TypeScript change"],
      expectedOutputs: ["changed files", "build receipt"]
    });
    const assignment = createAssignmentReceipt({
      taskId: "CORP-1",
      stageId: "STAGE-BUILD",
      role: role(),
      accountability: contract,
      objective: "Implement the assigned code change only"
    });

    expect(assignment.prohibitedActions).toContain("repair-unrelated-system-failure");
    expect(assignment.prohibitedActions).toContain("self-certify-output");

    const failure = createWorkFailure({
      taskId: "CORP-1",
      stageId: "STAGE-BUILD",
      originatingUnit: "BUILD",
      originatingRoleId: role().roleId,
      errorCode: "TSC_FAIL",
      summary: "TypeScript compilation failed",
      evidenceRefs: ["build:tsc"],
      retryable: true,
      securityRelevant: false
    });

    const route = routeFailure(failure);
    expect(route.originatingUnitMayRepair).toBe(false);
    expect(route.nextUnits).toEqual(["DIAGNOSTICS", "REPAIR", "VERIFICATION", "QC"]);
  });
});

describe("corporate delegation", () => {
  it("uses the corporate chain for material work but permits a pre-authorised atomic fast path", () => {
    const organization = defaultOrganizationModel();

    const material = chooseDelegation({
      organization,
      departmentId: "DEPT-PRODUCTION",
      atomic: false,
      preauthorisedDirectExecution: false,
      emergencyP0: false
    });
    expect(material.mode).toBe("CORPORATE_CHAIN");
    expect(material.chain.length).toBeGreaterThan(2);

    const atomic = chooseDelegation({
      organization,
      departmentId: "DEPT-PRODUCTION",
      atomic: true,
      preauthorisedDirectExecution: true,
      emergencyP0: false
    });
    expect(atomic.mode).toBe("DIRECT_ATOMIC");
    expect(atomic.ownerPositionId).not.toBe(atomic.executorPositionId);
  });
});

describe("official model selection and task skill adaptation", () => {
  it("requires exact provider/model official claims before a model is eligible", () => {
    const selected = selectModel([model], {
      taskId: "CORP-2",
      requiredCapabilities: ["code", "typescript"],
      preferredStrengths: ["code"],
      requiredToolsets: ["fs.read", "fs.write"],
      requireStructuredOutput: true,
      requireToolCalling: true,
      requireVision: false,
      minimumContextClass: "MEDIUM"
    });
    expect(selected.profile.modelId).toBe("model-code");
    expect(selected.officialEligibilityEvidence).toEqual(["OFFICIAL-1"]);

    const wrongModelEvidence: ModelProfile = {
      ...model,
      evidence: [{ ...model.evidence[0]!, modelId: "different-model" }]
    };
    expect(() => selectModel([wrongModelEvidence], {
      taskId: "CORP-2",
      requiredCapabilities: ["code"],
      preferredStrengths: [],
      requiredToolsets: ["fs.read"],
      requireStructuredOutput: false,
      requireToolCalling: false,
      requireVision: false,
      minimumContextClass: "SHORT"
    })).toThrow("MODEL_SELECTION_NO_OFFICIALLY_ELIGIBLE_MODEL");
  });

  it("binds only trusted non-revoked skills within the official model ceiling", () => {
    const skills: SkillManifest[] = [
      {
        skillId: "skill-ts-implementation",
        name: "TypeScript implementation",
        version: "1.0.0",
        description: "Focused TypeScript implementation procedure",
        capabilities: ["code", "typescript"],
        requiredToolsets: ["fs.read", "fs.write"],
        compatibleModelFamilies: ["family-a"],
        incompatibleModelIds: [],
        riskClass: "LOW",
        source: "CORE",
        contentDigest: "sha256:skill-ts",
        publisherId: "core",
        trustRootId: "core-skills",
        permissions: ["fs.read", "fs.write"],
        reviewReceiptRefs: [],
        evidenceRefs: ["skill:test"]
      },
      {
        skillId: "skill-deploy",
        name: "Production deploy",
        version: "1.0.0",
        description: "Deploy skill",
        capabilities: ["deploy"],
        requiredToolsets: ["release"],
        compatibleModelFamilies: ["family-a"],
        incompatibleModelIds: [],
        riskClass: "HIGH",
        source: "LEARNED",
        contentDigest: "sha256:skill-deploy",
        publisherId: "learning",
        trustRootId: "learned-skills",
        permissions: ["release"],
        reviewReceiptRefs: [],
        evidenceRefs: []
      }
    ];

    const binding = bindSkillsToTask({
      model,
      skills,
      requirement: {
        taskId: "CORP-2",
        requiredCapabilities: ["code", "typescript"],
        requiredToolsets: ["fs.read", "fs.write"],
        preferredSkills: ["skill-ts-implementation"],
        forbiddenSkills: []
      }
    });

    expect(binding.skillIds).toEqual(["skill-ts-implementation"]);
    expect(binding.uncoveredCapabilities).toEqual([]);
    expect(binding.skillIds).not.toContain("skill-deploy");
  });
});

describe("durable failure and solution memory", () => {
  it("learns solutions only from independent trusted verification receipts", async () => {
    const root = await mkdtemp(join(tmpdir(), "corp-memory-"));
    roots.push(root);
    const trust = learningTrust();
    const memory = new CorporateLearningMemory(root, trust);

    await memory.rememberFailure({
      fingerprint: "typescript:exact-optional",
      category: "BUILD_FAILURE",
      errorCode: "TS2375",
      symptom: "exactOptionalPropertyTypes assignment failed",
      taskId: "CORP-3",
      stageId: "STAGE-BUILD",
      modelId: "model-code",
      skillIds: ["skill-ts-implementation"],
      evidenceRefs: ["ci:391"],
      failedAttemptRefs: ["candidate:B"],
      doNotRepeat: ["do not assign undefined to exact optional property"],
      rootCause: "optional property emitted with explicit undefined"
    });

    const second = await memory.rememberFailure({
      fingerprint: "typescript:exact-optional",
      category: "BUILD_FAILURE",
      errorCode: "TS2375",
      symptom: "exactOptionalPropertyTypes assignment failed again",
      taskId: "CORP-4",
      stageId: "STAGE-BUILD",
      evidenceRefs: ["ci:392"],
      failedAttemptRefs: ["candidate:C"],
      doNotRepeat: ["do not use stale object-spread pattern"]
    });
    expect(second.recurrenceCount).toBe(2);
    expect(second.status).toBe("RECURRENT");

    const artifactFingerprint = "artifact:conditional-spread";
    const receipts = [
      createVerificationReceipt({
        artifactFingerprint,
        verifierId: "local-test",
        trustRootId: "trust-local",
        independentGroupId: "group-local",
        providerLineageId: "lineage-local",
        result: "PASS",
        metrics,
        evidenceRefs: ["ci:393"]
      }),
      createVerificationReceipt({
        artifactFingerprint,
        verifierId: "qc-review",
        trustRootId: "trust-qc",
        independentGroupId: "group-qc",
        providerLineageId: "lineage-qc",
        result: "PASS",
        metrics,
        evidenceRefs: ["qc:393"]
      })
    ];

    await memory.rememberSolution({
      problemFingerprint: "typescript:exact-optional",
      solutionFingerprint: "conditional-spread",
      title: "Conditional property spread",
      applicableContexts: ["TypeScript exactOptionalPropertyTypes"],
      verificationReceipts: receipts,
      regression: false,
      moneyCost: 0,
      tokenCost: 0,
      latency: 1
    });

    const found = await memory.navigateProblem({
      errorCode: "TS2375",
      text: "TypeScript exact optional assignment failure"
    });

    expect(found.matchingFailures[0]?.fingerprint).toBe("typescript:exact-optional");
    expect(found.candidateSolutions[0]?.solutionFingerprint).toBe("conditional-spread");
    expect(found.candidateSolutions[0]?.verificationReceiptIds).toHaveLength(2);
    expect(found.doNotRepeat).toContain("do not assign undefined to exact optional property");
  });
});

describe("plugin core", () => {
  it("keeps providers, verifiers and memory replaceable behind stable plugin manifests", async () => {
    const registry = new PluginRegistry();
    registry.register({
      manifest: {
        pluginId: "verifier-local",
        name: "Local deterministic verifier",
        version: "1.0.0",
        kind: "VERIFIER",
        capabilities: ["typescript.verify"],
        requiredKernelApi: "1",
        optional: false,
        externalDependency: false,
        risk: "LOW"
      },
      health: async () => ({ healthy: true })
    });

    expect(registry.byCapability("typescript.verify")[0]?.pluginId).toBe("verifier-local");
    expect((await registry.health())[0]?.healthy).toBe(true);
  });
});
