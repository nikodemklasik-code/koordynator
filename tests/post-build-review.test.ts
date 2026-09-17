import { describe, expect, it } from "vitest";
import { reviewPostBuild, type PostBuildInput, type ReviewFinding } from "../src/domain/post-build-review.js";

const base: PostBuildInput = {
  subjectSha: "a".repeat(40),
  treeSha: "b".repeat(40),
  objective: "Dodać eksport CSV raportów",
  acceptanceChecks: ["eksport zwraca CSV", "test pokrywa pusty raport"],
  changedFiles: ["src/reports/export.ts", "tests/reports-export.test.ts"],
  allowedPaths: ["src/reports"],
  testVerdict: "PASS"
};

describe("Post-build reviewer (recenzent, not a gate)", () => {
  it("returns MATCH with evidence when the product realises the objective and tests pass", () => {
    const review = reviewPostBuild(base);
    expect(review.verdict).toBe("MATCH");
    expect(review.blocks).toBe(false); // reviewer NEVER blocks release
    expect(review.evidence.length).toBeGreaterThan(0);
    expect(review.subjectSha).toBe(base.subjectSha);
  });

  it("flags DRIFT — with evidence — when a changed file falls outside the allowed scope, but still does not block", () => {
    const review = reviewPostBuild({
      ...base,
      changedFiles: ["src/reports/export.ts", "src/billing/charge.ts"]
    });
    expect(review.verdict).toBe("DRIFT");
    expect(review.blocks).toBe(false);
    expect(review.findings.some((f: ReviewFinding) => f.category === "SCOPE")).toBe(true);
    expect(review.findings.some((f: ReviewFinding) => f.evidence.includes("src/billing/charge.ts"))).toBe(true);
  });

  it("flags DRIFT when tests did not pass, but reports rather than blocks", () => {
    const review = reviewPostBuild({ ...base, testVerdict: "FAIL" });
    expect(review.verdict).toBe("DRIFT");
    expect(review.blocks).toBe(false);
    expect(review.findings.some((f: ReviewFinding) => f.category === "TESTS")).toBe(true);
  });

  it("does not fake MATCH when tests were never run (UNEXECUTED ≠ PASS)", () => {
    const review = reviewPostBuild({ ...base, testVerdict: "NOT_RUN" });
    expect(review.verdict).toBe("DRIFT");
    expect(review.findings.some((f: ReviewFinding) => f.category === "TESTS")).toBe(true);
  });

  it("reconstructs intent from the product (files touched) as advisory evidence", () => {
    const review = reviewPostBuild(base);
    // The reviewer summarises what the product appears to do, for the human to weigh.
    expect(review.reconstructedIntent).toMatch(/reports/i);
  });
});
