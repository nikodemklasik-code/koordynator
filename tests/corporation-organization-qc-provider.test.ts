import { describe, expect, it } from "vitest";
import {
  assertHierarchyValid,
  defaultOrganizationModel
} from "../src/corporation/organization.js";
import {
  evaluateQualityGate,
  paidVerificationNeedsFallback,
  type VerificationPath
} from "../src/corporation/quality-control.js";
import {
  ProviderFabric,
  type ProviderCapability
} from "../src/corporation/provider-fabric.js";

describe("Corporation organization model", () => {
  it("seeds full corporate functions with a CEO/head -> director -> manager -> lead -> agent hierarchy", () => {
    const model = defaultOrganizationModel();

    expect(model.departments.map((item) => item.departmentId)).toEqual(expect.arrayContaining([
      "DEPT-CEO",
      "DEPT-PRODUCT",
      "DEPT-MARKETING",
      "DEPT-LEGAL",
      "DEPT-HR",
      "DEPT-FINANCE",
      "DEPT-PRODUCTION",
      "DEPT-TESTING",
      "DEPT-QC",
      "DEPT-SECURITY",
      "DEPT-OPERATIONS",
      "DEPT-INTERNAL-DEVELOPMENT"
    ]));

    const qc = model.departments.find((item) => item.departmentId === "DEPT-QC");
    expect(qc?.independentControl).toBe(true);
    expect(qc?.screenSlug).toBe("corporation/qc");

    const productPositions = model.positions.filter((item) => item.departmentId === "DEPT-PRODUCT");
    expect(productPositions.map((item) => item.rank)).toEqual(expect.arrayContaining([
      "HEAD", "DIRECTOR", "MANAGER", "LEAD", "AGENT"
    ]));

    expect(() => assertHierarchyValid(model)).not.toThrow();
  });
});

describe("Quality Control sovereignty", () => {
  it("does not allow a paid external verification path to close a mandatory gate by itself", () => {
    const paths: VerificationPath[] = [{
      pathId: "paid-model",
      kind: "PAID_PROVIDER",
      executorId: "provider-a",
      providerFamily: "family-a",
      independentGroup: "family-a",
      externalDependency: true,
      metered: true,
      result: "PASS",
      evidenceRefs: ["receipt:paid"]
    }];

    const result = evaluateQualityGate(paths);

    expect(result.status).toBe("INCONCLUSIVE");
    expect(result.reasons).toEqual(expect.arrayContaining([
      "INSUFFICIENT_PASSING_PATHS",
      "NO_NON_METERED_CLOSURE_PATH",
      "NO_SOVEREIGN_CLOSURE_PATH"
    ]));
    expect(paidVerificationNeedsFallback(paths)).toBe(true);
  });

  it("passes when independent verification includes a sovereign non-metered closure path", () => {
    const paths: VerificationPath[] = [
      {
        pathId: "local-test",
        kind: "DETERMINISTIC_TEST",
        executorId: "local-vitest",
        independentGroup: "deterministic-tests",
        externalDependency: false,
        metered: false,
        result: "PASS",
        evidenceRefs: ["test:pass"]
      },
      {
        pathId: "free-cross-check",
        kind: "FREE_PROVIDER",
        executorId: "free-provider",
        providerFamily: "family-b",
        independentGroup: "family-b",
        externalDependency: true,
        metered: false,
        result: "PASS",
        evidenceRefs: ["review:pass"]
      }
    ];

    const result = evaluateQualityGate(paths);

    expect(result.status).toBe("PASS");
    expect(result.reasons).toEqual([]);
  });
});

describe("Provider Fabric", () => {
  const providers: ProviderCapability[] = [
    {
      providerId: "local",
      modelId: "local-reasoner",
      family: "local",
      capabilities: ["reasoning", "code-review"],
      toolsets: ["fs.read"],
      skills: ["review"],
      supportsToolCalling: true,
      supportsStructuredOutput: true,
      supportsVision: false,
      supportsLongContext: false,
      supportsBackgroundWork: true,
      costClass: "LOCAL",
      healthy: true,
      rateLimited: false,
      externalDependency: false,
      risk: "LOW"
    },
    {
      providerId: "free-a",
      modelId: "model-a",
      family: "family-a",
      capabilities: ["reasoning", "code-review"],
      toolsets: ["fs.read"],
      skills: ["review"],
      supportsToolCalling: true,
      supportsStructuredOutput: true,
      supportsVision: false,
      supportsLongContext: true,
      supportsBackgroundWork: true,
      costClass: "FREE",
      healthy: true,
      rateLimited: false,
      externalDependency: true,
      risk: "LOW"
    },
    {
      providerId: "paid-b",
      modelId: "model-b",
      family: "family-b",
      capabilities: ["reasoning", "code-review"],
      toolsets: ["fs.read"],
      skills: ["review"],
      supportsToolCalling: true,
      supportsStructuredOutput: true,
      supportsVision: true,
      supportsLongContext: true,
      supportsBackgroundWork: true,
      costClass: "PAID_API",
      healthy: true,
      rateLimited: false,
      externalDependency: true,
      risk: "MEDIUM"
    }
  ];

  it("builds single, fallback, combo and cross-check strategies without paid-provider lock-in", () => {
    const fabric = new ProviderFabric(providers);
    const strategies = fabric.buildStrategies({
      requiredCapabilities: ["reasoning", "code-review"],
      requiredToolsets: ["fs.read"],
      requiredSkills: ["review"],
      verification: true
    });

    expect(strategies.some((item) => item.kind === "SINGLE" && item.members[0]?.providerId === "local")).toBe(true);
    expect(strategies.some((item) => item.kind === "FALLBACK_CHAIN")).toBe(true);
    expect(strategies.some((item) => item.kind === "CROSS_CHECK" && item.providerFamilies.length >= 2)).toBe(true);
    expect(strategies.filter((item) => item.members.some((member) => member.costClass === "PAID_API"))
      .every((item) => item.hasNonPaidPath)).toBe(true);
  });
});
