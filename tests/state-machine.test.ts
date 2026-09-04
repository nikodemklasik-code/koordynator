import { describe, expect, it } from "vitest";
import { transitionState } from "../src/engine/state-machine.js";
import type { OrchestratorState } from "../src/domain/state.js";

const base: OrchestratorState = {
  taskId: "TASK-1",
  workspaceId: "WS-1",
  buildId: "BUILD-1",
  revision: 0,
  state: "CREATED",
  changedAt: "2026-09-04T00:00:00.000Z"
};

describe("state machine", () => {
  it("allows the canonical happy path start", () => {
    const ready = transitionState(base, "READY", "2026-09-04T00:00:01.000Z");
    const building = transitionState(ready, "BUILDING", "2026-09-04T00:00:02.000Z");
    expect(building.state).toBe("BUILDING");
  });

  it("rejects skipping directly to RELEASED", () => {
    expect(() => transitionState(base, "RELEASED", "2026-09-04T00:00:01.000Z"))
      .toThrow(/INVALID_STATE_TRANSITION/);
  });
});
