import type {
  CorporateEvent,
  CorporationSnapshot,
  ExecutorDescriptor,
  HllDecision,
  HllStatement,
  SolutionCandidate
} from "./domain.js";

export interface HllPort {
  assess(statement: HllStatement): Promise<HllDecision>;
}

export interface CorporationStateStore {
  load(): Promise<CorporationSnapshot | null>;
  save(snapshot: CorporationSnapshot): Promise<void>;
}

export interface CorporateEventStore {
  append(event: CorporateEvent): Promise<void>;
  list(limit?: number): Promise<CorporateEvent[]>;
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
