import { describe, expect, it } from "vitest";
import { evaluateTestReceipt, type TestClaim } from "../src/domain/independent-test-receipt.js";

describe("Independent test receipt", () => {
  it("does not treat PROCESS_COMPLETED, SEE_AGENT_REPORT or NOT_TESTED as PASS", () => {
    for (const claim of [
      { source: "SEE_AGENT_REPORT" },
      { source: "PROCESS_COMPLETED" },
      { source: "NOT_TESTED" },
      { verifier: "agent", command: "vitest", exitCode: 0, status: "PASS" }
    ] as TestClaim[]) {
      expect(evaluateTestReceipt(claim).verdict).not.toBe("PASS");
    }
  });

  it("accepts PASS only from an independent verifier with a real exit code", () => {
    expect(evaluateTestReceipt({
      verifier: "independent",
      command: "npx vitest run tests/task-envelope.test.ts",
      exitCode: 0,
      status: "PASS"
    })).toEqual({ verdict: "PASS", independent: true });
  });

  it("records FAIL when the independent verifier exits non-zero", () => {
    expect(evaluateTestReceipt({
      verifier: "independent",
      command: "npx vitest run",
      exitCode: 1,
      status: "PASS"
    })).toEqual({ verdict: "FAIL", independent: true });
  });

  it("blocks UI acceptance language: missing independent receipt is BLOCKED, not PASS", () => {
    expect(evaluateTestReceipt(null).verdict).toBe("BLOCKED");
  });
});
