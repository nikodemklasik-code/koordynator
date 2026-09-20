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
import { createVerificationReceipt } from "../src/corporation/receipts.js";
import { VerifierTrustRegistry } from "../src/corporation/verification-trust.js";
import type { SolutionMetrics } from "../src/corporation/domain.js";

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
  const metrics: SolutionMetrics = {
    correctness: 0.95,
    security: 0.95,
    maintainability: 0.9,
    reversibility: 0.9,
    architectureFit: 0.9,
    productValue: 0.8,
    regressionRisk: 0.1,
    complexity: 0.2,
    moneyCost: 0.1,
    tokenCost: 0.1,
    latency: 0.1
  };

  const trust = new VerifierTrustRegistry([
    {
      trustRootId: "trust-local",
      verifierId: "local-vitest",
      independentGroupId: "deterministic-tests",
      providerLineageId: "local-toolchain",
      authority: "CORE",
      revoked: false,
      validFrom: new Date(Date.now() - 1000).toISOString()
    },
    {
      trustRootId: "trust-free",
      verifierId: "free-provider",
      independentGroupId: "family-b",
      providerLineageId: "provider-family-b",
      authority: "QC",
      revoked: false,
      validFrom: new Date(Date.now() - 1000).toISOString()
    },
    {
      trustRootId: "trust-paid",
      verifierId: "provider-a",
      independentGroupId: "family-a",
      providerLineageId: "provider-family-a",
      authority: "PROVIDER",
      revoked: false,
      validFrom: new Date(Date.now() - 1000).toISOString()
    }
  ]);

  const path = (input: {
    pathId: string;
    kind: VerificationPath["kind"];
    verifierId: string;
    trustRootId: string;
    independentGroupId: string;
    providerLineageId: string;
    externalDependency: boolean;
    metered: boolean;
    result: "PASS" | "FAIL" | "INCONCLUSIVE";
    severity?: "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    failureClass?: "CORRECTNESS" | "SECURITY" | "INTEGRITY" | "PRIVACY" | "COMPLIANCE" | "PERFORMANCE" | "RELIABILITY" | "OTHER";
  }): VerificationPath => {
    const artifactFingerprint = "artifact:qc";
    return {
      pathId: input.pathId,
      kind: input.kind,
      externalDependency: input.externalDependency,
      metered: input.metered,
      receipt: createVerificationReceipt({
        artifactFingerprint,
        verifierId: input.verifierId,
        trustRootId: input.trustRootId,
        independentGroupId: input.independentGroupId,
        providerLineageId: input.providerLineageId,
        result: input.result,
        ...(input.severity === undefined ? {} : { severity: input.severity }),
        ...(input.failureClass === undefined ? {} : { failureClass: input.failureClass }),
        metrics,
        evidenceRefs: [`receipt:${input.pathId}`]
      })
    };
  };

  it("does not allow a paid external verification path to close a mandatory gate by itself", () => {
    const paths: VerificationPath[] = [path({
      pathId: "paid-model",
      kind: "PAID_PROVIDER",
      verifierId: "provider-a",
      trustRootId: "trust-paid",
      independentGroupId: "family-a",
      providerLineageId: "provider-family-a",
      externalDependency: true,
      metered: true,
      result: "PASS"
    })];

    const result = evaluateQualityGate(paths, trust);

    expect(result.status).toBe("INCONCLUSIVE");
    expect(result.reasons).toEqual(expect.arrayContaining([
      "INSUFFICIENT_PASSING_PATHS",
      "NO_NON_METERED_CLOSURE_PATH",
      "NO_SOVEREIGN_CLOSURE_PATH",
      "NO_DETERMINISTIC_CLOSURE_PATH"
    ]));
    expect(paidVerificationNeedsFallback(paths)).toBe(true);
  });

  it("passes when independent verification includes deterministic sovereign closure and a second lineage", () => {
    const paths: VerificationPath[] = [
      path({
        pathId: "local-test",
        kind: "DETERMINISTIC_TEST",
        verifierId: "local-vitest",
        trustRootId: "trust-local",
        independentGroupId: "deterministic-tests",
        providerLineageId: "local-toolchain",
        externalDependency: false,
        metered: false,
        result: "PASS"
      }),
      path({
        pathId: "free-cross-check",
        kind: "FREE_PROVIDER",
        verifierId: "free-provider",
        trustRootId: "trust-free",
        independentGroupId: "family-b",
        providerLineageId: "provider-family-b",
        externalDependency: true,
        metered: false,
        result: "PASS"
      })
    ];

    const result = evaluateQualityGate(paths, trust);
    expect(result.status).toBe("PASS");
    expect(result.reasons).toEqual([]);
  });

  it("blocks a critical correctness failure even when other paths pass", () => {
    const paths: VerificationPath[] = [
      path({
        pathId: "local-test",
        kind: "DETERMINISTIC_TEST",
        verifierId: "local-vitest",
        trustRootId: "trust-local",
        independentGroupId: "deterministic-tests",
        providerLineageId: "local-toolchain",
        externalDependency: false,
        metered: false,
        result: "PASS"
      }),
      path({
        pathId: "free-cross-check",
        kind: "FREE_PROVIDER",
        verifierId: "free-provider",
        trustRootId: "trust-free",
        independentGroupId: "family-b",
        providerLineageId: "provider-family-b",
        externalDependency: true,
        metered: false,
        result: "PASS"
      }),
      path({
        pathId: "critical-fail",
        kind: "PAID_PROVIDER",
        verifierId: "provider-a",
        trustRootId: "trust-paid",
        independentGroupId: "family-a",
        providerLineageId: "provider-family-a",
        externalDependency: true,
        metered: true,
        result: "FAIL",
        severity: "CRITICAL",
        failureClass: "CORRECTNESS"
      })
    ];

    const result = evaluateQualityGate(paths, trust);
    expect(result.status).toBe("FAIL");
    expect(result.reasons).toContain("CRITICAL_VERIFICATION_FAILURE_PRESENT");
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
