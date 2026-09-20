import { randomUUID } from "node:crypto";
import type { HllDecision, HllProvenance, HllStatement } from "./domain.js";
import { assertHllAllows } from "./hll.js";
import type { DecisionReceipt } from "./receipts.js";

export type NoveltySourceKind =
  | "SCIENTIFIC_PAPER"
  | "PATENT"
  | "STANDARD"
  | "REGULATION"
  | "PROVIDER_DOC"
  | "MODEL_RELEASE"
  | "SOFTWARE_RELEASE"
  | "REPOSITORY"
  | "CONFERENCE"
  | "MARKET"
  | "COMPETITOR"
  | "COMMUNITY"
  | "CUSTOMER"
  | "INTERNAL_EXPERIMENT";

export type NoveltySignal = {
  signalId: string;
  sourceKind: NoveltySourceKind;
  sourceRef: string;
  title: string;
  summary: string;
  observedAt: string;
  provenance: HllProvenance;
  evidenceRefs: string[];
  noveltyScore: number;
  relevanceScore: number;
  confidenceScore: number;
  status: "CAPTURED" | "TRIAGED" | "VERIFIED" | "ABSORBED" | "REJECTED";
  hllDecision?: HllDecision;
  hllStatement?: HllStatement;
  hllReceipt?: DecisionReceipt;
};

export type ScientificHypothesis = {
  hypothesisId: string;
  signalIds: string[];
  statement: string;
  falsificationCriteria: string[];
  evidenceFor: string[];
  evidenceAgainst: string[];
  status: "PROPOSED" | "TESTING" | "SUPPORTED" | "FALSIFIED" | "INCONCLUSIVE";
  hllDecision?: HllDecision;
  createdAt: string;
  updatedAt: string;
};

export type InnovationOpportunity = {
  opportunityId: string;
  signalIds: string[];
  hypothesisIds: string[];
  title: string;
  problem: string;
  proposedValue: string;
  targetDepartments: string[];
  targetProducts: string[];
  requiredExperiments: string[];
  strategicFit: string[];
  riskNotes: string[];
  status: "DISCOVERED" | "RESEARCHING" | "VALIDATED" | "INCUBATING" | "REJECTED" | "ABSORBED";
  hllDecision?: HllDecision;
  hllStatement?: HllStatement;
  hllReceipt?: DecisionReceipt;
  createdAt: string;
  updatedAt: string;
};

export type InnovationExperiment = {
  experimentId: string;
  opportunityId: string;
  hypothesisId?: string;
  objective: string;
  method: string;
  falsificationCriteria: string[];
  expectedEvidence: string[];
  result?: "SUPPORTED" | "FALSIFIED" | "INCONCLUSIVE";
  evidenceRefs: string[];
  createdAt: string;
  completedAt?: string;
};

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function iso(): string {
  return new Date().toISOString();
}

export class InnovationRadar {
  private readonly signals = new Map<string, NoveltySignal>();
  private readonly hypotheses = new Map<string, ScientificHypothesis>();
  private readonly opportunities = new Map<string, InnovationOpportunity>();
  private readonly experiments = new Map<string, InnovationExperiment>();

  captureSignal(input: Omit<NoveltySignal, "signalId" | "status" | "noveltyScore" | "relevanceScore" | "confidenceScore"> & {
    noveltyScore: number;
    relevanceScore: number;
    confidenceScore: number;
  }): NoveltySignal {
    const signal: NoveltySignal = {
      ...input,
      signalId: `SIGNAL-${randomUUID().slice(0, 10).toUpperCase()}`,
      evidenceRefs: [...new Set(input.evidenceRefs)],
      noveltyScore: clamp(input.noveltyScore),
      relevanceScore: clamp(input.relevanceScore),
      confidenceScore: clamp(input.confidenceScore),
      status: "CAPTURED"
    };
    this.signals.set(signal.signalId, signal);
    return structuredClone(signal);
  }

  triageSignal(signalId: string, decision?: HllDecision): NoveltySignal {
    const signal = this.requireSignal(signalId);
    if (decision) signal.hllDecision = decision;

    signal.status = decision?.truthState === "REJECTED" || decision?.verdict === "BLOCK"
      ? "REJECTED"
      : "TRIAGED";

    return structuredClone(signal);
  }

  verifySignal(signalId: string, assessment: {
    statement: HllStatement;
    decision: HllDecision;
    receipt: DecisionReceipt;
  }): NoveltySignal {
    const signal = this.requireSignal(signalId);
    try {
      assertHllAllows({
        statement: assessment.statement,
        decision: assessment.decision,
        receipt: assessment.receipt,
        action: "corporation.verify-innovation-signal"
      });
      signal.status = "VERIFIED";
    } catch {
      signal.status = assessment.decision.truthState === "REJECTED" || assessment.decision.verdict === "BLOCK"
        ? "REJECTED"
        : "TRIAGED";
    }
    signal.hllDecision = assessment.decision;
    signal.hllStatement = assessment.statement;
    signal.hllReceipt = assessment.receipt;
    return structuredClone(signal);
  }

  createHypothesis(input: {
    signalIds: string[];
    statement: string;
    falsificationCriteria: string[];
  }): ScientificHypothesis {
    input.signalIds.forEach((id) => this.requireSignal(id));
    const at = iso();
    const hypothesis: ScientificHypothesis = {
      hypothesisId: `HYP-${randomUUID().slice(0, 10).toUpperCase()}`,
      signalIds: [...new Set(input.signalIds)],
      statement: input.statement,
      falsificationCriteria: [...new Set(input.falsificationCriteria)],
      evidenceFor: [],
      evidenceAgainst: [],
      status: "PROPOSED",
      createdAt: at,
      updatedAt: at
    };
    this.hypotheses.set(hypothesis.hypothesisId, hypothesis);
    return structuredClone(hypothesis);
  }

  recordHypothesisEvidence(input: {
    hypothesisId: string;
    evidenceRef: string;
    supports: boolean;
    falsifies: boolean;
  }): ScientificHypothesis {
    const hypothesis = this.requireHypothesis(input.hypothesisId);
    if (input.supports) hypothesis.evidenceFor = [...new Set([...hypothesis.evidenceFor, input.evidenceRef])];
    if (input.falsifies) hypothesis.evidenceAgainst = [...new Set([...hypothesis.evidenceAgainst, input.evidenceRef])];
    hypothesis.status = input.falsifies
      ? "FALSIFIED"
      : hypothesis.evidenceFor.length
        ? "SUPPORTED"
        : "TESTING";
    hypothesis.updatedAt = iso();
    return structuredClone(hypothesis);
  }

  createOpportunity(input: Omit<InnovationOpportunity, "opportunityId" | "status" | "createdAt" | "updatedAt">): InnovationOpportunity {
    input.signalIds.forEach((id) => this.requireSignal(id));
    input.hypothesisIds.forEach((id) => this.requireHypothesis(id));
    const at = iso();
    const opportunity: InnovationOpportunity = {
      ...input,
      opportunityId: `INNOV-${randomUUID().slice(0, 10).toUpperCase()}`,
      signalIds: [...new Set(input.signalIds)],
      hypothesisIds: [...new Set(input.hypothesisIds)],
      targetDepartments: [...new Set(input.targetDepartments)],
      targetProducts: [...new Set(input.targetProducts)],
      requiredExperiments: [...new Set(input.requiredExperiments)],
      strategicFit: [...new Set(input.strategicFit)],
      riskNotes: [...new Set(input.riskNotes)],
      status: "DISCOVERED",
      createdAt: at,
      updatedAt: at
    };
    this.opportunities.set(opportunity.opportunityId, opportunity);
    return structuredClone(opportunity);
  }

  createExperiment(input: Omit<InnovationExperiment, "experimentId" | "createdAt" | "evidenceRefs"> & { evidenceRefs?: string[] }): InnovationExperiment {
    if (!this.opportunities.has(input.opportunityId)) throw new Error("INNOVATION_OPPORTUNITY_NOT_FOUND");
    if (input.hypothesisId) this.requireHypothesis(input.hypothesisId);
    const experiment: InnovationExperiment = {
      ...input,
      experimentId: `EXPERIMENT-${randomUUID().slice(0, 10).toUpperCase()}`,
      falsificationCriteria: [...new Set(input.falsificationCriteria)],
      expectedEvidence: [...new Set(input.expectedEvidence)],
      evidenceRefs: [...new Set(input.evidenceRefs ?? [])],
      createdAt: iso()
    };
    this.experiments.set(experiment.experimentId, experiment);
    return structuredClone(experiment);
  }

  completeExperiment(input: {
    experimentId: string;
    result: NonNullable<InnovationExperiment["result"]>;
    evidenceRefs: string[];
  }): InnovationExperiment {
    const experiment = this.experiments.get(input.experimentId);
    if (!experiment) throw new Error("INNOVATION_EXPERIMENT_NOT_FOUND");
    experiment.result = input.result;
    experiment.evidenceRefs = [...new Set([...experiment.evidenceRefs, ...input.evidenceRefs])];
    experiment.completedAt = iso();
    return structuredClone(experiment);
  }

  absorbOpportunity(opportunityId: string, assessment: {
    statement: HllStatement;
    decision: HllDecision;
    receipt: DecisionReceipt;
  }): InnovationOpportunity {
    const opportunity = this.opportunities.get(opportunityId);
    if (!opportunity) throw new Error("INNOVATION_OPPORTUNITY_NOT_FOUND");

    const related = [...this.experiments.values()].filter((item) => item.opportunityId === opportunityId);
    if (!related.length) throw new Error("INNOVATION_ABSORPTION_REQUIRES_EXPERIMENT");
    if (related.some((item) => !item.result)) throw new Error("INNOVATION_EXPERIMENT_INCOMPLETE");
    if (!related.some((item) => item.result === "SUPPORTED")) throw new Error("INNOVATION_NO_SUPPORTED_EXPERIMENT");

    assertHllAllows({
      statement: assessment.statement,
      decision: assessment.decision,
      receipt: assessment.receipt,
      action: "corporation.absorb-innovation"
    });

    opportunity.status = "ABSORBED";
    opportunity.hllDecision = assessment.decision;
    opportunity.hllStatement = assessment.statement;
    opportunity.hllReceipt = assessment.receipt;
    opportunity.updatedAt = iso();
    for (const signalId of opportunity.signalIds) {
      const signal = this.signals.get(signalId);
      if (signal && signal.status === "VERIFIED") signal.status = "ABSORBED";
    }
    return structuredClone(opportunity);
  }

  snapshot() {
    return {
      signals: [...this.signals.values()].map((item) => structuredClone(item)),
      hypotheses: [...this.hypotheses.values()].map((item) => structuredClone(item)),
      opportunities: [...this.opportunities.values()].map((item) => structuredClone(item)),
      experiments: [...this.experiments.values()].map((item) => structuredClone(item))
    };
  }

  private requireSignal(signalId: string): NoveltySignal {
    const signal = this.signals.get(signalId);
    if (!signal) throw new Error("INNOVATION_SIGNAL_NOT_FOUND");
    return signal;
  }

  private requireHypothesis(hypothesisId: string): ScientificHypothesis {
    const hypothesis = this.hypotheses.get(hypothesisId);
    if (!hypothesis) throw new Error("INNOVATION_HYPOTHESIS_NOT_FOUND");
    return hypothesis;
  }
}
