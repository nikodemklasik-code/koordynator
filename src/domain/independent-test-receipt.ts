export type TestClaim =
  | { source: "SEE_AGENT_REPORT" | "PROCESS_COMPLETED" | "NOT_TESTED" }
  | { verifier: "agent" | "independent"; command: string; exitCode: number; status: "PASS" | "FAIL" | "NOT_RUN" };

export type TestReceiptVerdict = {
  verdict: "PASS" | "FAIL" | "BLOCKED";
  independent?: true;
};

export function evaluateTestReceipt(claim: TestClaim | null): TestReceiptVerdict {
  if (!claim) return { verdict: "BLOCKED" };
  if ("source" in claim) return { verdict: "BLOCKED" };
  if (claim.verifier !== "independent") return { verdict: "BLOCKED" };
  if (claim.exitCode !== 0) return { verdict: "FAIL", independent: true };
  if (claim.status !== "PASS") return { verdict: "BLOCKED", independent: true };
  return { verdict: "PASS", independent: true };
}
