import { canonicalDigest } from "../crypto/canonical-digest.js";
import type { Digest } from "../domain/ids.js";
import {
  decideRecovery,
  issueFingerprint,
  validateMaterializationOrder,
  type BinaryCheck,
  type IssueIdentity,
  type MaterializationOrder
} from "./autonomous-recovery.js";

export type ExecutionConditions = {
  agent: string;
  aiRoute: string;
  generation: number;
};

export type GuardianFinding = {
  value: BinaryCheck;
  issue?: IssueIdentity;
  reason?: string;
  proposedSolution?: string;
};

export type GuardianComparison = {
  opposing: GuardianFinding;
  qc1: GuardianFinding;
};

export type MaterializationResult<T> = {
  artifact: T;
  artifactFp: Digest;
};

export interface AgentMaterializer<T> {
  materialize(
    order: Readonly<MaterializationOrder>,
    conditions: Readonly<ExecutionConditions>,
    correction?: string
  ): Promise<MaterializationResult<T>>;
}

export interface GuardianComparator<T> {
  compare(order: Readonly<MaterializationOrder>, result: Readonly<MaterializationResult<T>>): Promise<GuardianComparison>;
}

export interface BrainExecutionConditions {
  change(current: Readonly<ExecutionConditions>): Promise<ExecutionConditions>;
}

export interface Rewident<E, T> {
  gather(input: {
    order: Readonly<MaterializationOrder>;
    result: Readonly<MaterializationResult<T>>;
    comparison: Readonly<GuardianComparison>;
    issueFp: Digest;
  }): Promise<E>;
}

export type HarmoniaConflictDecision =
  | { action: "dalej" }
  | { action: "do agenta"; correction: string }
  | { action: "zmień warunki wykonania" };

export interface HarmoniaConflictWeigher<E> {
  weigh(evidence: E): Promise<HarmoniaConflictDecision>;
}

export type MaterializationLoopOptions = {
  maxAgentCorrections: number;
  maxConditionChanges: number;
};

export type MaterializationTrace = {
  round: number;
  approach: 1 | 2;
  opposing: BinaryCheck;
  qc1: BinaryCheck;
  action: "dalej" | "do agenta" | "zmień warunki wykonania" | "Rewident";
  issueFp?: Digest;
};

export type MaterializationLoopResult<T> =
  | { status: "gotowe"; result: MaterializationResult<T>; conditions: ExecutionConditions; trace: MaterializationTrace[] }
  | { status: "potrzebny człowiek"; reason: string; conditions: ExecutionConditions; trace: MaterializationTrace[] };

function validateFinding(name: string, finding: GuardianFinding): void {
  if (finding.value === 1) return;
  if (!finding.issue) throw new Error(`${name}_ISSUE_REQUIRED`);
  if (!finding.reason?.trim()) throw new Error(`${name}_REASON_REQUIRED`);
  if (!finding.proposedSolution?.trim()) throw new Error(`${name}_SOLUTION_REQUIRED`);
}

function failingFindings(comparison: GuardianComparison): GuardianFinding[] {
  return [comparison.opposing, comparison.qc1].filter((finding) => finding.value === 0);
}

function primaryIssue(comparison: GuardianComparison): IssueIdentity {
  const finding = failingFindings(comparison)[0];
  if (!finding?.issue) throw new Error("ISSUE_IDENTITY_REQUIRED");
  return finding.issue;
}

function correctionFrom(comparison: GuardianComparison): string {
  return failingFindings(comparison)
    .map((finding) => finding.proposedSolution?.trim())
    .filter((value): value is string => Boolean(value))
    .join("\n");
}

export class AutonomousMaterializationLoop<T, E = unknown> {
  constructor(
    private readonly materializer: AgentMaterializer<T>,
    private readonly guardians: GuardianComparator<T>,
    private readonly brain: BrainExecutionConditions,
    private readonly rewident: Rewident<E, T>,
    private readonly harmonia: HarmoniaConflictWeigher<E>,
    private readonly options: MaterializationLoopOptions
  ) {
    if (!Number.isInteger(options.maxAgentCorrections) || options.maxAgentCorrections < 1) throw new Error("INVALID_AGENT_CORRECTION_BUDGET");
    if (!Number.isInteger(options.maxConditionChanges) || options.maxConditionChanges < 0) throw new Error("INVALID_CONDITION_CHANGE_BUDGET");
  }

  async run(order: MaterializationOrder, initialConditions: ExecutionConditions): Promise<MaterializationLoopResult<T>> {
    validateMaterializationOrder(order);
    const immutableOrderFp = canonicalDigest(order);
    const trace: MaterializationTrace[] = [];
    let conditions = { ...initialConditions };
    let previousIssueFp: Digest | undefined;
    let correction: string | undefined;
    let corrections = 0;
    let conditionChanges = 0;
    let round = 0;

    while (true) {
      round += 1;
      if (canonicalDigest(order) !== immutableOrderFp) throw new Error("MATERIALIZATION_ORDER_MUTATED");

      const result = await this.materializer.materialize(order, conditions, correction);
      const comparison = await this.guardians.compare(order, result);
      validateFinding("OPPOSING", comparison.opposing);
      validateFinding("QC1", comparison.qc1);

      if (comparison.opposing.value === 1 && comparison.qc1.value === 1) {
        trace.push({ round, approach: 1, opposing: 1, qc1: 1, action: "dalej" });
        return { status: "gotowe", result, conditions, trace };
      }

      const issue = primaryIssue(comparison);
      const currentIssueFp = issueFingerprint(issue);
      const sameIssue = previousIssueFp !== undefined && previousIssueFp === currentIssueFp;
      const approach: 1 | 2 = sameIssue ? 2 : 1;
      const decision = decideRecovery({
        approach,
        opposing: comparison.opposing.value,
        qc1: comparison.qc1.value,
        issue,
        ...(previousIssueFp === undefined ? {} : { previousIssueFp })
      });
      trace.push({
        round,
        approach,
        opposing: comparison.opposing.value,
        qc1: comparison.qc1.value,
        action: decision.action,
        issueFp: currentIssueFp
      });

      if (decision.action === "Rewident") {
        const evidence = await this.rewident.gather({ order, result, comparison, issueFp: currentIssueFp });
        const weighed = await this.harmonia.weigh(evidence);
        if (weighed.action === "dalej") {
          return { status: "gotowe", result, conditions, trace };
        }
        if (weighed.action === "do agenta") {
          correction = weighed.correction.trim();
          if (!correction) throw new Error("HARMONIA_CORRECTION_REQUIRED");
          corrections += 1;
          previousIssueFp = currentIssueFp;
          continue;
        }
        if (conditionChanges >= this.options.maxConditionChanges) {
          return { status: "potrzebny człowiek", reason: "Wyczerpano dozwolone zmiany warunków wykonania.", conditions, trace };
        }
        conditions = await this.brain.change(conditions);
        conditionChanges += 1;
        corrections = 0;
        correction = undefined;
        previousIssueFp = undefined;
        continue;
      }

      if (decision.action === "zmień warunki wykonania") {
        if (conditionChanges >= this.options.maxConditionChanges) {
          return { status: "potrzebny człowiek", reason: "Ten sam błąd wykonania wrócił po wykorzystaniu drabiny zmian warunków.", conditions, trace };
        }
        conditions = await this.brain.change(conditions);
        conditionChanges += 1;
        corrections = 0;
        correction = undefined;
        previousIssueFp = undefined;
        continue;
      }

      correction = correctionFrom(comparison);
      if (!correction) throw new Error("AGENT_CORRECTION_REQUIRED");
      corrections += 1;
      if (corrections > this.options.maxAgentCorrections) {
        if (conditionChanges >= this.options.maxConditionChanges) {
          return { status: "potrzebny człowiek", reason: "Wyczerpano drabinę korekt i zmian warunków wykonania.", conditions, trace };
        }
        conditions = await this.brain.change(conditions);
        conditionChanges += 1;
        corrections = 0;
        correction = undefined;
        previousIssueFp = undefined;
        continue;
      }
      previousIssueFp = currentIssueFp;
    }
  }
}
