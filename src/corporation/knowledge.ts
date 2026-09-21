import { randomUUID } from "node:crypto";
import type { HllDecision, HllProvenance } from "./domain.js";

export type KnowledgeState =
  | "DRAFT"
  | "SUPPORTED"
  | "CONTESTED"
  | "RATIFIED"
  | "SUPERSEDED";

export type StageKnowledgeItem = {
  knowledgeId: string;
  taskId: string;
  stageId: string;
  departmentId: string;
  roleId: string;
  kind:
    | "INPUT"
    | "ASSUMPTION"
    | "EVIDENCE"
    | "DECISION"
    | "RISK"
    | "QUESTION"
    | "OUTPUT"
    | "HANDOFF";
  statement: string;
  state: KnowledgeState;
  provenance: HllProvenance;
  evidenceRefs: string[];
  hllDecision?: HllDecision;
  createdAt: string;
  supersedesKnowledgeId?: string;
};

export type StageKnowledgePackage = {
  packageId: string;
  taskId: string;
  stageId: string;
  departmentId: string;
  roleId: string;
  inputs: string[];
  assumptions: string[];
  evidenceRefs: string[];
  decisions: string[];
  unresolvedQuestions: string[];
  risks: string[];
  outputs: string[];
  acceptanceCriteria: string[];
  handoffNotes: string[];
  knowledgeIds: string[];
  createdAt: string;
};

export type KnowledgeHandoff = {
  handoffId: string;
  taskId: string;
  fromStageId: string;
  toStageId: string;
  packageId: string;
  requiredKnowledgeStates: KnowledgeState[];
  status: "PROPOSED" | "READY" | "BLOCKED" | "ACCEPTED";
  blockingReasons: string[];
  createdAt: string;
  acceptedAt?: string;
};

export class StageKnowledgeLedger {
  private readonly items = new Map<string, StageKnowledgeItem>();

  add(input: Omit<StageKnowledgeItem, "knowledgeId" | "createdAt">): StageKnowledgeItem {
    const item: StageKnowledgeItem = {
      ...input,
      knowledgeId: `KNOW-${randomUUID().slice(0, 10).toUpperCase()}`,
      evidenceRefs: [...new Set(input.evidenceRefs)],
      createdAt: new Date().toISOString()
    };
    this.items.set(item.knowledgeId, item);
    return structuredClone(item);
  }

  listForStage(taskId: string, stageId: string): StageKnowledgeItem[] {
    return [...this.items.values()]
      .filter((item) => item.taskId === taskId && item.stageId === stageId)
      .map((item) => structuredClone(item));
  }

  packageForStage(input: {
    taskId: string;
    stageId: string;
    departmentId: string;
    roleId: string;
    acceptanceCriteria: string[];
  }): StageKnowledgePackage {
    const items = this.listForStage(input.taskId, input.stageId)
      .filter((item) => item.state !== "SUPERSEDED");

    const byKind = (kind: StageKnowledgeItem["kind"]): string[] =>
      items.filter((item) => item.kind === kind).map((item) => item.statement);

    return {
      packageId: `KPACK-${randomUUID().slice(0, 10).toUpperCase()}`,
      taskId: input.taskId,
      stageId: input.stageId,
      departmentId: input.departmentId,
      roleId: input.roleId,
      inputs: byKind("INPUT"),
      assumptions: byKind("ASSUMPTION"),
      evidenceRefs: [...new Set(items.flatMap((item) => item.evidenceRefs))],
      decisions: byKind("DECISION"),
      unresolvedQuestions: items
        .filter((item) => item.kind === "QUESTION" && item.state !== "RATIFIED")
        .map((item) => item.statement),
      risks: byKind("RISK"),
      outputs: byKind("OUTPUT"),
      acceptanceCriteria: [...input.acceptanceCriteria],
      handoffNotes: byKind("HANDOFF"),
      knowledgeIds: items.map((item) => item.knowledgeId),
      createdAt: new Date().toISOString()
    };
  }

  proposeHandoff(input: {
    taskId: string;
    fromStageId: string;
    toStageId: string;
    package: StageKnowledgePackage;
    requireRatifiedEvidence?: boolean;
  }): KnowledgeHandoff {
    const items = input.package.knowledgeIds
      .map((id) => this.items.get(id))
      .filter((item): item is StageKnowledgeItem => Boolean(item));

    const blockingReasons: string[] = [];
    if (input.package.unresolvedQuestions.length) blockingReasons.push("UNRESOLVED_QUESTIONS");
    if (!input.package.outputs.length) blockingReasons.push("OUTPUT_MISSING");
    if (!input.package.evidenceRefs.length) blockingReasons.push("EVIDENCE_MISSING");

    if (input.requireRatifiedEvidence !== false) {
      const material = items.filter((item) => ["EVIDENCE", "DECISION", "OUTPUT"].includes(item.kind));
      if (material.some((item) => item.state !== "RATIFIED")) blockingReasons.push("MATERIAL_KNOWLEDGE_NOT_RATIFIED");
    }

    return {
      handoffId: `HANDOFF-${randomUUID().slice(0, 10).toUpperCase()}`,
      taskId: input.taskId,
      fromStageId: input.fromStageId,
      toStageId: input.toStageId,
      packageId: input.package.packageId,
      requiredKnowledgeStates: ["RATIFIED"],
      status: blockingReasons.length ? "BLOCKED" : "READY",
      blockingReasons,
      createdAt: new Date().toISOString()
    };
  }
}
