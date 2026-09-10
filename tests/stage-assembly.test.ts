import { describe, expect, it } from "vitest";
import { canonicalDigest } from "../src/crypto/canonical-digest.js";
import type { Digest } from "../src/domain/ids.js";
import {
  B1StageAssembler,
  Qc2StageComparator,
  type AcceptedStageElement,
  type StageTemplate
} from "../src/engine/stage-assembly.js";

const d = (value: unknown): Digest => canonicalDigest(value);
const NOW = "2026-09-10T10:00:00.000Z";

function template(): StageTemplate {
  return {
    stageId: "STAGE-A",
    elements: [
      {
        elementId: "A1",
        expectedArtifactFp: d("artifact-a1"),
        expectedContractFp: d("contract-a1"),
        requiredCoverage: ["kod", "test"]
      },
      {
        elementId: "A2",
        expectedArtifactFp: d("artifact-a2"),
        expectedContractFp: d("contract-a2"),
        requiredCoverage: ["integracja"]
      }
    ]
  };
}

function elements(): AcceptedStageElement[] {
  return [
    {
      elementId: "A1",
      artifactFp: d("artifact-a1"),
      contractFp: d("contract-a1"),
      coverage: ["kod", "test"],
      validUntil: "2026-09-11T10:00:00.000Z",
      qc1: 1,
      opposing: 1
    },
    {
      elementId: "A2",
      artifactFp: d("artifact-a2"),
      contractFp: d("contract-a2"),
      coverage: ["integracja"],
      validUntil: "2026-09-11T10:00:00.000Z",
      qc1: 1,
      opposing: 1
    }
  ];
}

describe("B1 stage assembly and QC2", () => {
  it("B1 assembles only complete valid 1/1 elements and QC2 returns one", () => {
    const assembler = new B1StageAssembler();
    const result = assembler.assemble(template(), elements(), NOW);
    expect(result.status).toBe("GOTOWE");
    if (result.status !== "GOTOWE") return;

    expect(result.stage.elementOrder).toEqual(["A1", "A2"]);
    const qc2 = new Qc2StageComparator().compare(template(), result.stage, NOW);
    expect(qc2.value).toBe(1);
  });

  it("B1 refuses a stage with fewer than two elements", () => {
    const result = new B1StageAssembler().assemble(template(), [elements()[0]!], NOW);
    expect(result.status).toBe("BLOKADA");
    if (result.status === "BLOKADA") expect(result.reason).toContain("mniej niż dwóch");
  });

  it("B1 refuses expired or incomplete elements instead of passing a partial block upward", () => {
    const supplied = elements();
    supplied[1] = { ...supplied[1]!, validUntil: "2026-09-09T10:00:00.000Z" };
    const result = new B1StageAssembler().assemble(template(), supplied, NOW);
    expect(result.status).toBe("BLOKADA");
    if (result.status === "BLOKADA") expect(result.reason).toContain("wygasła");
  });

  it("B1 orders accepted elements by the stage template rather than caller order", () => {
    const supplied = [...elements()].reverse();
    const result = new B1StageAssembler().assemble(template(), supplied, NOW);
    expect(result.status).toBe("GOTOWE");
    if (result.status === "GOTOWE") expect(result.stage.elementOrder).toEqual(["A1", "A2"]);
  });

  it("QC2 returns zero with a concrete correction if a completed block is tampered after B1", () => {
    const assembled = new B1StageAssembler().assemble(template(), elements(), NOW);
    expect(assembled.status).toBe("GOTOWE");
    if (assembled.status !== "GOTOWE") return;

    const tampered = {
      ...assembled.stage,
      elements: [
        { ...assembled.stage.elements[0]!, coverage: ["kod"] },
        assembled.stage.elements[1]!
      ]
    };
    const qc2 = new Qc2StageComparator().compare(template(), tampered, NOW);
    expect(qc2.value).toBe(0);
    if (qc2.value === 0) {
      expect(qc2.reason).toContain("nie pokrywa wymaganej treści");
      expect(qc2.proposedSolution.length).toBeGreaterThan(0);
    }
  });

  it("QC2 returns zero when the assembly fingerprint no longer matches the assembled block", () => {
    const assembled = new B1StageAssembler().assemble(template(), elements(), NOW);
    expect(assembled.status).toBe("GOTOWE");
    if (assembled.status !== "GOTOWE") return;

    const tampered = { ...assembled.stage, assemblyFp: d("tampered") };
    const qc2 = new Qc2StageComparator().compare(template(), tampered, NOW);
    expect(qc2.value).toBe(0);
    if (qc2.value === 0) expect(qc2.reason).toContain("Fingerprint");
  });
});
