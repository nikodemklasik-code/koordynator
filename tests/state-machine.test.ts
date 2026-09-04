import { describe, expect, it } from "vitest";
import { transitionState } from "../src/engine/state-machine.js";
import type { OrchestratorState, TaskState } from "../src/domain/state.js";

const base: OrchestratorState = {
  taskId: "TASK-1",
  workspaceId: "WS-1",
  buildId: "BUILD-1",
  revision: 0,
  state: "CREATED",
  changedAt: "2026-09-04T00:00:00.000Z"
};

const canonicalHappyPath: TaskState[] = [
  "READY",
  "BUILDING",
  "BUILD_READY",
  "CANDIDATE_FROZEN",
  "VALIDATING",
  "APPROVED",
  "RELEASING",
  "RELEASED"
];

describe("state machine", () => {
  it("executes the complete canonical happy path without skipping a state", () => {
    let current = base;
    canonicalHappyPath.forEach((next, index) => {
      current = transitionState(current, next, `2026-09-04T00:00:${String(index + 1).padStart(2, "0")}.000Z`);
    });
    expect(current.state).toBe("RELEASED");
  });

  it("allows post-freeze targeted return but not a direct jump back to READY", () => {
    let current = base;
    for (const next of ["READY", "BUILDING", "BUILD_READY", "CANDIDATE_FROZEN", "VALIDATING"] as TaskState[]) {
      current = transitionState(current, next, "2026-09-04T00:00:01.000Z");
    }
    const returned = transitionState(current, "RETURNED", "2026-09-04T00:00:02.000Z", "VALIDATION_FAILED");
    expect(returned.state).toBe("RETURNED");
    expect(() => transitionState(returned, "READY", "2026-09-04T00:00:03.000Z"))
      .toThrow(/INVALID_STATE_TRANSITION/);
    expect(transitionState(returned, "BUILDING", "2026-09-04T00:00:03.000Z").state).toBe("BUILDING");
  });

  it("rejects skipping directly to RELEASED", () => {
    expect(() => transitionState(base, "RELEASED", "2026-09-04T00:00:01.000Z"))
      .toThrow(/INVALID_STATE_TRANSITION/);
  });
});
