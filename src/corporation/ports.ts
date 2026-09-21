import type {
  CorporateEvent,
  CorporationSnapshot,
  ExecutorDescriptor,
  HllBrainAction,
  HllDecision,
  HllStatement,
  SolutionCandidate
} from "./domain.js";
import type { DecisionReceipt, HllRecordReceipt } from "./receipts.js";

export type HllAssessment = {
  decision: HllDecision;
  receipt: DecisionReceipt;
};

export type HllCommitment = {
  brainDecisionHash: string;
  canonicalRecordHash: string;
  receipt: HllRecordReceipt;
};

export interface HllPort {
  assess(statement: HllStatement): Promise<HllAssessment>;
  commit(input: {
    statement: HllStatement;
    assessment: HllAssessment;
    action: HllBrainAction;
    rationale: string;
    targetLedger?: string;
    orderingKey?: string;
    externalAuthorisationId?: string;
  }): Promise<HllCommitment>;
}

export interface CorporationStateStore {
  load(): Promise<CorporationSnapshot | null>;
  save(snapshot: CorporationSnapshot): Promise<void>;
}

export interface CorporateEventStore {
  append(event: CorporateEvent): Promise<void>;
  list(limit?: number): Promise<CorporateEvent[]>;
}

export interface CorporationTransactionStore {
  commit(input: {
    expectedRevision: number;
    snapshot: CorporationSnapshot;
    events: CorporateEvent[];
  }): Promise<void>;
}

export interface ExecutorRegistryPort {
  list(): Promise<ExecutorDescriptor[]>;
}

export interface CandidateGeneratorPort {
  generate(input: {
    taskId: string;
    objective: string;
    acceptanceCriteria: string[];
    requiredCapabilities: string[];
  }): Promise<SolutionCandidate[]>;
}

export interface CandidateVerifierPort {
  verify(candidate: SolutionCandidate): Promise<SolutionCandidate>;
}
