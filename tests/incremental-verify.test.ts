import { describe, expect, it } from "vitest";
import { vitestVerifyArgs } from "../src/control/hermes-repository-runner.js";

describe("Incremental independent verify (validate only what changed)", () => {
  it("runs only tests affected by the commit when a base SHA is known", () => {
    const plan = vitestVerifyArgs("abc1234");
    expect(plan.args).toEqual(["vitest", "run", "--changed", "abc1234"]);
    expect(plan.command).toContain("--changed");
    // Incremental by contract: never a blanket full run when we know the base.
    expect(plan.args).not.toEqual(["vitest", "run"]);
  });

  it("falls back to a full run only when no base SHA is available", () => {
    const plan = vitestVerifyArgs(undefined);
    expect(plan.args).toEqual(["vitest", "run"]);
  });

  it("treats an empty/whitespace base SHA as no base (full run)", () => {
    expect(vitestVerifyArgs("   ").args).toEqual(["vitest", "run"]);
  });
});
