import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { VerificationReceipt } from "./receipts.js";
import { verifyVerificationReceipt } from "./receipts.js";
import { VerifierTrustRegistry } from "./verification-trust.js";

export type FailureMemoryStatus =
  | "OPEN"
  | "DIAGNOSED"
  | "RESOLVED"
  | "RECURRENT"
  | "SUPERSEDED";

export type FailureMemoryRecord = {
  failureMemoryId: string;
  fingerprint: string;
  category: string;
  errorCode: string;
  symptom: string;
  rootCause?: string;
  status: FailureMemoryStatus;
  taskIds: string[];
  stageIds: string[];
  modelIds: string[];
  skillIds: string[];
  providerFamilies: string[];
  environmentFacts: string[];
  evidenceRefs: string[];
  failedAttemptRefs: string[];
  doNotRepeat: string[];
  recurrenceCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
};

export type SolutionMemoryRecord = {
  solutionMemoryId: string;
  problemFingerprint: string;
  solutionFingerprint: string;
  title: string;
  applicableContexts: string[];
  prerequisites: string[];
  strategyRefs: string[];
  skillIds: string[];
  modelFamilies: string[];
  verificationRefs: string[];
  verificationReceiptIds: string[];
  independentGroupIds: string[];
  providerLineageIds: string[];
  contraindications: string[];
  successCount: number;
  failureCount: number;
  regressionCount: number;
  meanMoneyCost: number;
  meanTokenCost: number;
  meanLatency: number;
  version: number;
  promotedSkillId?: string;
  firstVerifiedAt: string;
  lastVerifiedAt: string;
};

export type CorporateLearningState = {
  schemaVersion: 1;
  failures: FailureMemoryRecord[];
  solutions: SolutionMemoryRecord[];
  updatedAt: string;
};

function iso(): string {
  return new Date().toISOString();
}

function tokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9._-]+/)
      .filter((item) => item.length >= 3)
  );
}

function overlap(a: string, b: string): number {
  const left = tokens(a);
  const right = tokens(b);
  if (!left.size || !right.size) return 0;
  let common = 0;
  for (const token of left) if (right.has(token)) common += 1;
  return common / Math.max(left.size, right.size);
}

export class CorporateLearningMemory {
  private readonly path: string;

  constructor(
    stateDir: string,
    private readonly verifierTrust: VerifierTrustRegistry = new VerifierTrustRegistry()
  ) {
    this.path = join(resolve(stateDir), "corporation-v2", "learning-memory.json");
  }

  async snapshot(): Promise<CorporateLearningState> {
    try {
      return JSON.parse(await readFile(this.path, "utf8")) as CorporateLearningState;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return {
        schemaVersion: 1,
        failures: [],
        solutions: [],
        updatedAt: iso()
      };
    }
  }

  async rememberFailure(input: {
    fingerprint: string;
    category: string;
    errorCode: string;
    symptom: string;
    taskId: string;
    stageId: string;
    modelId?: string;
    skillIds?: string[];
    providerFamily?: string;
    environmentFacts?: string[];
    evidenceRefs?: string[];
    failedAttemptRefs?: string[];
    doNotRepeat?: string[];
    rootCause?: string;
    resolved?: boolean;
  }): Promise<FailureMemoryRecord> {
    const state = await this.snapshot();
    const existing = state.failures.find((item) => item.fingerprint === input.fingerprint);
    const at = iso();

    if (existing) {
      existing.taskIds = [...new Set([...existing.taskIds, input.taskId])];
      existing.stageIds = [...new Set([...existing.stageIds, input.stageId])];
      if (input.modelId) existing.modelIds = [...new Set([...existing.modelIds, input.modelId])];
      existing.skillIds = [...new Set([...existing.skillIds, ...(input.skillIds ?? [])])];
      if (input.providerFamily) {
        existing.providerFamilies = [...new Set([...existing.providerFamilies, input.providerFamily])];
      }
      existing.environmentFacts = [...new Set([...existing.environmentFacts, ...(input.environmentFacts ?? [])])];
      existing.evidenceRefs = [...new Set([...existing.evidenceRefs, ...(input.evidenceRefs ?? [])])];
      existing.failedAttemptRefs = [...new Set([...existing.failedAttemptRefs, ...(input.failedAttemptRefs ?? [])])];
      existing.doNotRepeat = [...new Set([...existing.doNotRepeat, ...(input.doNotRepeat ?? [])])];
      existing.recurrenceCount += 1;
      existing.lastSeenAt = at;
      existing.status = input.resolved ? "RESOLVED" : "RECURRENT";
      if (input.rootCause) existing.rootCause = input.rootCause;
      state.updatedAt = at;
      await this.persist(state);
      return structuredClone(existing);
    }

    const record: FailureMemoryRecord = {
      failureMemoryId: `FMEM-${randomUUID().slice(0, 10).toUpperCase()}`,
      fingerprint: input.fingerprint,
      category: input.category,
      errorCode: input.errorCode,
      symptom: input.symptom,
      ...(input.rootCause === undefined ? {} : { rootCause: input.rootCause }),
      status: input.resolved ? "RESOLVED" : input.rootCause ? "DIAGNOSED" : "OPEN",
      taskIds: [input.taskId],
      stageIds: [input.stageId],
      modelIds: input.modelId ? [input.modelId] : [],
      skillIds: [...new Set(input.skillIds ?? [])],
      providerFamilies: input.providerFamily ? [input.providerFamily] : [],
      environmentFacts: [...new Set(input.environmentFacts ?? [])],
      evidenceRefs: [...new Set(input.evidenceRefs ?? [])],
      failedAttemptRefs: [...new Set(input.failedAttemptRefs ?? [])],
      doNotRepeat: [...new Set(input.doNotRepeat ?? [])],
      recurrenceCount: 1,
      firstSeenAt: at,
      lastSeenAt: at
    };
    state.failures.push(record);
    state.updatedAt = at;
    await this.persist(state);
    return structuredClone(record);
  }

  async rememberSolution(input: {
    problemFingerprint: string;
    solutionFingerprint: string;
    title: string;
    applicableContexts: string[];
    prerequisites?: string[];
    strategyRefs?: string[];
    skillIds?: string[];
    modelFamilies?: string[];
    verificationReceipts: VerificationReceipt[];
    contraindications?: string[];
    regression: boolean;
    moneyCost?: number;
    tokenCost?: number;
    latency?: number;
    promotedSkillId?: string;
  }): Promise<SolutionMemoryRecord> {
    const state = await this.snapshot();
    if (!input.verificationReceipts.length) throw new Error("LEARNING_VERIFICATION_RECEIPT_REQUIRED");

    for (const receipt of input.verificationReceipts) {
      verifyVerificationReceipt(receipt);
      this.verifierTrust.assertReceiptLineage({
        trustRootId: receipt.trustRootId,
        verifierId: receipt.verifierId,
        independentGroupId: receipt.independentGroupId,
        providerLineageId: receipt.providerLineageId
      });
    }

    const passing = input.verificationReceipts.filter((receipt) => receipt.result === "PASS");
    const independentGroups = new Set(passing.map((receipt) => receipt.independentGroupId));
    const criticalFailure = input.verificationReceipts.some((receipt) =>
      receipt.result === "FAIL"
      && receipt.severity === "CRITICAL"
      && receipt.failureClass !== undefined
      && ["CORRECTNESS", "SECURITY", "INTEGRITY", "PRIVACY", "COMPLIANCE"].includes(receipt.failureClass)
    );
    const passed = !criticalFailure && passing.length >= 2 && independentGroups.size >= 2;
    if (!passed && !input.verificationReceipts.some((receipt) => receipt.result === "FAIL")) {
      throw new Error("LEARNING_VERIFICATION_INSUFFICIENT");
    }

    const verificationRefs = [...new Set(input.verificationReceipts.flatMap((receipt) => receipt.evidenceRefs))];
    const verificationReceiptIds = [...new Set(input.verificationReceipts.map((receipt) => receipt.receiptId))];
    const providerLineageIds = [...new Set(input.verificationReceipts.map((receipt) => receipt.providerLineageId))];

    const existing = state.solutions.find((item) =>
      item.problemFingerprint === input.problemFingerprint
      && item.solutionFingerprint === input.solutionFingerprint
    );
    const at = iso();

    if (existing) {
      const observations = existing.successCount + existing.failureCount;
      const nextObservations = observations + 1;
      const avg = (previous: number, current: number) =>
        ((previous * observations) + current) / nextObservations;

      if (passed) existing.successCount += 1;
      else existing.failureCount += 1;
      if (input.regression) existing.regressionCount += 1;
      existing.meanMoneyCost = avg(existing.meanMoneyCost, input.moneyCost ?? 0);
      existing.meanTokenCost = avg(existing.meanTokenCost, input.tokenCost ?? 0);
      existing.meanLatency = avg(existing.meanLatency, input.latency ?? 0);
      existing.verificationRefs = [...new Set([...existing.verificationRefs, ...verificationRefs])];
      existing.verificationReceiptIds = [...new Set([...existing.verificationReceiptIds, ...verificationReceiptIds])];
      existing.independentGroupIds = [...new Set([...existing.independentGroupIds, ...independentGroups])];
      existing.providerLineageIds = [...new Set([...existing.providerLineageIds, ...providerLineageIds])];
      existing.applicableContexts = [...new Set([...existing.applicableContexts, ...input.applicableContexts])];
      existing.prerequisites = [...new Set([...existing.prerequisites, ...(input.prerequisites ?? [])])];
      existing.strategyRefs = [...new Set([...existing.strategyRefs, ...(input.strategyRefs ?? [])])];
      existing.skillIds = [...new Set([...existing.skillIds, ...(input.skillIds ?? [])])];
      existing.modelFamilies = [...new Set([...existing.modelFamilies, ...(input.modelFamilies ?? [])])];
      existing.contraindications = [...new Set([...existing.contraindications, ...(input.contraindications ?? [])])];
      existing.version += 1;
      existing.lastVerifiedAt = at;
      if (input.promotedSkillId) {
        if (existing.successCount < 3 || existing.independentGroupIds.length < 2 || existing.regressionCount > 0) {
          throw new Error("LEARNING_SKILL_PROMOTION_THRESHOLD_NOT_MET");
        }
        existing.promotedSkillId = input.promotedSkillId;
      }
      state.updatedAt = at;
      await this.persist(state);
      return structuredClone(existing);
    }

    const record: SolutionMemoryRecord = {
      solutionMemoryId: `SMEM-${randomUUID().slice(0, 10).toUpperCase()}`,
      problemFingerprint: input.problemFingerprint,
      solutionFingerprint: input.solutionFingerprint,
      title: input.title,
      applicableContexts: [...new Set(input.applicableContexts)],
      prerequisites: [...new Set(input.prerequisites ?? [])],
      strategyRefs: [...new Set(input.strategyRefs ?? [])],
      skillIds: [...new Set(input.skillIds ?? [])],
      modelFamilies: [...new Set(input.modelFamilies ?? [])],
      verificationRefs,
      verificationReceiptIds,
      independentGroupIds: [...independentGroups],
      providerLineageIds,
      contraindications: [...new Set(input.contraindications ?? [])],
      successCount: passed ? 1 : 0,
      failureCount: passed ? 0 : 1,
      regressionCount: input.regression ? 1 : 0,
      meanMoneyCost: input.moneyCost ?? 0,
      meanTokenCost: input.tokenCost ?? 0,
      meanLatency: input.latency ?? 0,
      version: 1,
      ...(input.promotedSkillId === undefined
        ? {}
        : passed && independentGroups.size >= 2 && !input.regression
          ? { promotedSkillId: input.promotedSkillId }
          : {}),
      firstVerifiedAt: at,
      lastVerifiedAt: at
    };
    state.solutions.push(record);
    state.updatedAt = at;
    await this.persist(state);
    return structuredClone(record);
  }

  async navigateProblem(input: {
    fingerprint?: string;
    errorCode?: string;
    text: string;
  }): Promise<{
    matchingFailures: FailureMemoryRecord[];
    candidateSolutions: SolutionMemoryRecord[];
    doNotRepeat: string[];
  }> {
    const state = await this.snapshot();
    const failures = state.failures
      .map((item) => ({
        item,
        score:
          (input.fingerprint && item.fingerprint === input.fingerprint ? 2 : 0)
          + (input.errorCode && item.errorCode === input.errorCode ? 1 : 0)
          + overlap(`${item.category} ${item.errorCode} ${item.symptom} ${item.rootCause ?? ""}`, input.text)
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map((entry) => entry.item);

    const problemFingerprints = new Set([
      ...(input.fingerprint ? [input.fingerprint] : []),
      ...failures.map((item) => item.fingerprint)
    ]);

    const solutions = state.solutions
      .filter((item) => problemFingerprints.has(item.problemFingerprint))
      .sort((a, b) => {
        const reliabilityA = a.successCount / Math.max(1, a.successCount + a.failureCount + a.regressionCount);
        const reliabilityB = b.successCount / Math.max(1, b.successCount + b.failureCount + b.regressionCount);
        if (reliabilityA !== reliabilityB) return reliabilityB - reliabilityA;
        return b.lastVerifiedAt.localeCompare(a.lastVerifiedAt);
      })
      .slice(0, 12);

    return {
      matchingFailures: structuredClone(failures),
      candidateSolutions: structuredClone(solutions),
      doNotRepeat: [...new Set(failures.flatMap((item) => item.doNotRepeat))]
    };
  }

  private async persist(state: CorporateLearningState): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const tmp = `${this.path}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
    await rename(tmp, this.path);
  }
}
