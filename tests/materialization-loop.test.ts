import { describe, expect, it } from "vitest";
import { canonicalDigest } from "../src/crypto/canonical-digest.js";
import type { Digest } from "../src/domain/ids.js";
import type { MaterializationOrder, IssueIdentity } from "../src/engine/autonomous-recovery.js";
import {
  AutonomousMaterializationLoop,
  type AgentMaterializer,
  type BrainExecutionConditions,
  type ExecutionConditions,
  type GuardianComparison,
  type GuardianComparator,
  type HarmoniaConflictWeigher,
  type MaterializationResult,
  type Rewident
} from "../src/engine/materialization-loop.js";

const baseIssue: IssueIdentity = {
  element: "moduł",
  location: "src/modul.ts",
  kind: "niezgodność",
  expected: "A",
  actual: "B",
  detectedBy: "QC1"
};

function order(): MaterializationOrder {
  return {
    taskId: "TASK-MATERIALIZE",
    instructions: "Zainstaluj dostarczony element dokładnie w wyznaczonym miejscu.",
    allowedPaths: ["src/**"],
    suppliedMaterialFp: canonicalDigest("supplied-material"),
    expectedResult: "Gotowy element A.",
    initiative: "brak"
  };
}

function fail(issue: IssueIdentity = baseIssue, proposedSolution = "Zastosuj dostarczoną korektę."): GuardianComparison {
  return {
    opposing: { value: 0, issue: { ...issue, detectedBy: "Zespół przeciwny" }, reason: "Niezgodność.", proposedSolution },
    qc1: { value: 0, issue: { ...issue, detectedBy: "QC1" }, reason: "Niezgodny kształt.", proposedSolution }
  };
}

const pass: GuardianComparison = { opposing: { value: 1 }, qc1: { value: 1 } };

function harness(comparisons: GuardianComparison[], harmoniaDecision: "dalej" | "do agenta" | "zmień warunki wykonania" = "dalej") {
  const corrections: Array<string | undefined> = [];
  const conditionsSeen: ExecutionConditions[] = [];
  let comparisonIndex = 0;
  let rewidentCalls = 0;
  let conditionChanges = 0;

  const materializer: AgentMaterializer<string> = {
    async materialize(_order, conditions, correction): Promise<MaterializationResult<string>> {
      corrections.push(correction);
      conditionsSeen.push({ ...conditions });
      const artifact = `artifact-${corrections.length}`;
      return { artifact, artifactFp: canonicalDigest(artifact) as Digest };
    }
  };

  const guardians: GuardianComparator<string> = {
    async compare() {
      return comparisons[Math.min(comparisonIndex++, comparisons.length - 1)]!;
    }
  };

  const brain: BrainExecutionConditions = {
    async change(current) {
      conditionChanges += 1;
      return { ...current, agent: `agent-${conditionChanges + 1}`, aiRoute: "OmniRoute", generation: current.generation + 1 };
    }
  };

  const rewident: Rewident<{ collected: true }, string> = {
    async gather() {
      rewidentCalls += 1;
      return { collected: true };
    }
  };

  const harmonia: HarmoniaConflictWeigher<{ collected: true }> = {
    async weigh() {
      if (harmoniaDecision === "do agenta") return { action: "do agenta", correction: "Korekta Harmonii." };
      return { action: harmoniaDecision };
    }
  };

  const loop = new AutonomousMaterializationLoop(materializer, guardians, brain, rewident, harmonia, {
    maxAgentCorrections: 2,
    maxConditionChanges: 2
  });

  return {
    loop,
    corrections,
    conditionsSeen,
    rewidentCalls: () => rewidentCalls,
    conditionChanges: () => conditionChanges
  };
}

describe("autonomous materialization loop", () => {
  const conditions: ExecutionConditions = { agent: "agent-1", aiRoute: "OmniRoute", generation: 0 };

  it("finishes immediately on one and one", async () => {
    const h = harness([pass]);
    const result = await h.loop.run(order(), conditions);
    expect(result.status).toBe("gotowe");
    expect(h.rewidentCalls()).toBe(0);
    expect(h.conditionChanges()).toBe(0);
  });

  it("returns the first failure to the agent with a concrete correction", async () => {
    const h = harness([fail(), pass]);
    const result = await h.loop.run(order(), conditions);
    expect(result.status).toBe("gotowe");
    expect(h.corrections).toEqual([undefined, "Zastosuj dostarczoną korektę.\nZastosuj dostarczoną korektę."]);
    expect(h.rewidentCalls()).toBe(0);
  });

  it("uses Rewident only when the second approach conflicts on the same error", async () => {
    const conflict: GuardianComparison = {
      opposing: { value: 0, issue: { ...baseIssue, detectedBy: "Zespół przeciwny" }, reason: "Ta sama niezgodność.", proposedSolution: "Korekta." },
      qc1: { value: 1 }
    };
    const h = harness([fail(), conflict], "dalej");
    const result = await h.loop.run(order(), conditions);
    expect(result.status).toBe("gotowe");
    expect(h.rewidentCalls()).toBe(1);
    expect(result.trace.at(-1)?.action).toBe("Rewident");
  });

  it("does not use Rewident when the second run exposes a different error", async () => {
    const otherIssue = { ...baseIssue, actual: "C", detectedBy: "Zespół przeciwny" as const };
    const newConflict: GuardianComparison = {
      opposing: { value: 0, issue: otherIssue, reason: "Nowy problem.", proposedSolution: "Napraw C." },
      qc1: { value: 1 }
    };
    const h = harness([fail(), newConflict, pass]);
    const result = await h.loop.run(order(), conditions);
    expect(result.status).toBe("gotowe");
    expect(h.rewidentCalls()).toBe(0);
    expect(result.trace[1]?.approach).toBe(1);
  });

  it("changes execution conditions when the same zero-zero failure repeats", async () => {
    const h = harness([fail(), fail(), pass]);
    const result = await h.loop.run(order(), conditions);
    expect(result.status).toBe("gotowe");
    expect(h.rewidentCalls()).toBe(0);
    expect(h.conditionChanges()).toBe(1);
    expect(h.conditionsSeen.at(-1)?.agent).toBe("agent-2");
  });

  it("rejects a guardian zero that lacks a concrete reason and proposed solution", async () => {
    const invalid: GuardianComparison = {
      opposing: { value: 0, issue: { ...baseIssue, detectedBy: "Zespół przeciwny" } },
      qc1: { value: 1 }
    };
    const h = harness([invalid]);
    await expect(h.loop.run(order(), conditions)).rejects.toThrow("OPPOSING_REASON_REQUIRED");
  });

  it("detects attempts to rewrite the immutable materialization order", async () => {
    const materializer: AgentMaterializer<string> = {
      async materialize(received) {
        (received as MaterializationOrder).instructions = "Agent wymyślił własne rozwiązanie.";
        return { artifact: "x", artifactFp: canonicalDigest("x") };
      }
    };
    const guardians: GuardianComparator<string> = { async compare() { return fail(); } };
    const brain: BrainExecutionConditions = { async change(current) { return { ...current }; } };
    const rewident: Rewident<{}, string> = { async gather() { return {}; } };
    const harmonia: HarmoniaConflictWeigher<{}> = { async weigh() { return { action: "dalej" }; } };
    const loop = new AutonomousMaterializationLoop(materializer, guardians, brain, rewident, harmonia, { maxAgentCorrections: 1, maxConditionChanges: 0 });
    await expect(loop.run(order(), conditions)).rejects.toThrow("MATERIALIZATION_ORDER_MUTATED");
  });
});
