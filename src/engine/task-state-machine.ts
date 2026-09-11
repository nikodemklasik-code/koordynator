export type ExecutionState =
  | "RECEIVED"
  | "PLANNED"
  | "QUEUED"
  | "LEASED"
  | "RUNNING"
  | "VERIFYING"
  | "ACCEPTED"
  | "RELEASE_CANDIDATE"
  | "RELEASED"
  | "REJECTED"
  | "ROLLED_BACK"
  | "BLOCKED";

const TRANSITIONS: Record<ExecutionState, readonly ExecutionState[]> = {
  RECEIVED: ["PLANNED", "BLOCKED"],
  PLANNED: ["QUEUED", "BLOCKED"],
  QUEUED: ["LEASED", "BLOCKED"],
  LEASED: ["RUNNING", "BLOCKED"],
  RUNNING: ["VERIFYING", "BLOCKED", "REJECTED"],
  VERIFYING: ["ACCEPTED", "REJECTED", "BLOCKED"],
  ACCEPTED: ["RELEASE_CANDIDATE", "BLOCKED"],
  RELEASE_CANDIDATE: ["RELEASED", "ROLLED_BACK", "BLOCKED"],
  RELEASED: [],
  REJECTED: ["PLANNED"],
  ROLLED_BACK: ["PLANNED"],
  BLOCKED: ["PLANNED"]
};

export function transition(from: ExecutionState, to: ExecutionState): ExecutionState {
  if (!TRANSITIONS[from].includes(to)) {
    throw new Error(`ILLEGAL_TRANSITION:${from}->${to}`);
  }
  return to;
}
