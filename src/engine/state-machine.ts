import type { OrchestratorState, TaskState } from "../domain/state.js";

const transitions: Record<TaskState, ReadonlySet<TaskState>> = {
  CREATED: new Set(["READY", "BLOCKED"]),
  READY: new Set(["BUILDING", "BLOCKED"]),
  BUILDING: new Set(["BUILD_READY", "FAILED", "BLOCKED", "QUARANTINED"]),
  BUILD_READY: new Set(["CANDIDATE_FROZEN", "BUILDING", "FAILED"]),
  CANDIDATE_FROZEN: new Set(["VALIDATING", "RETURNED"]),
  VALIDATING: new Set(["APPROVED", "RETURNED", "FAILED"]),
  APPROVED: new Set(["RELEASING", "RETURNED"]),
  RELEASING: new Set(["RELEASED", "RETURNED", "FAILED"]),
  RELEASED: new Set([]),
  BLOCKED: new Set(["READY", "BUILDING", "FAILED"]),
  FAILED: new Set(["RETURNED"]),
  RETURNED: new Set(["BUILDING"]),
  QUARANTINED: new Set(["RETURNED", "FAILED"])
};

export function canTransition(from: TaskState, to: TaskState): boolean {
  return transitions[from].has(to);
}

export function transitionState(
  current: OrchestratorState,
  next: TaskState,
  changedAt: string,
  reasonCode?: string
): OrchestratorState {
  if (!canTransition(current.state, next)) {
    throw new Error(`INVALID_STATE_TRANSITION:${current.state}->${next}`);
  }
  return {
    ...current,
    state: next,
    changedAt,
    ...(reasonCode === undefined ? {} : { reasonCode })
  };
}
