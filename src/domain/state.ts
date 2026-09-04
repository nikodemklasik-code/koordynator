import type { TaskRef } from "./ids.js";

export type TaskState =
  | "CREATED"
  | "READY"
  | "BUILDING"
  | "BUILD_READY"
  | "CANDIDATE_FROZEN"
  | "VALIDATING"
  | "APPROVED"
  | "RELEASING"
  | "RELEASED"
  | "BLOCKED"
  | "FAILED"
  | "RETURNED"
  | "QUARANTINED";

export type OrchestratorState = TaskRef & {
  state: TaskState;
  changedAt: string;
  reasonCode?: string;
};
