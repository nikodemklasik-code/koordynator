import type {
  CorporateEvent,
  CorporationSnapshot,
  ExecutorDescriptor,
  HllDecision,
  HllStatement,
  SolutionCandidate
} from "./domain.js";
import type { DecisionReceipt } from "./receipts.js";

export type HllAssessment = {
  decision: HllDecision;
  receipt: DecisionReceipt;
};

export interface HllPort {
  assess(statement: HllStatement): Promise<HllAssessment>;
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
