import { canonicalDigest } from "../crypto/canonical-digest.js";
import type { Digest } from "../domain/ids.js";

export type StageElementTemplate = {
  elementId: string;
  expectedArtifactFp: Digest;
  expectedContractFp: Digest;
  requiredCoverage: string[];
};

export type StageTemplate = {
  stageId: string;
  elements: StageElementTemplate[];
};

export type AcceptedStageElement = {
  elementId: string;
  artifactFp: Digest;
  contractFp: Digest;
  coverage: string[];
  validUntil: string;
  qc1: 1;
  opposing: 1;
};

export type AssembledStage = {
  stageId: string;
  elementOrder: string[];
  elements: AcceptedStageElement[];
  assemblyFp: Digest;
};

export type B1AssemblyResult =
  | { status: "GOTOWE"; stage: AssembledStage }
  | { status: "BLOKADA"; reason: string; proposedSolution: string };

export type Qc2Result =
  | { value: 1; stageFp: Digest }
  | { value: 0; reason: string; proposedSolution: string; stageFp: Digest };

function stageFingerprint(input: Omit<AssembledStage, "assemblyFp">): Digest {
  return canonicalDigest({ kind: "assembled-stage-v1", ...input });
}

function validateTemplate(template: Readonly<StageTemplate>): void {
  if (!template.stageId.trim()) throw new Error("STAGE_ID_REQUIRED");
  if (template.elements.length < 2) throw new Error("STAGE_REQUIRES_AT_LEAST_TWO_ELEMENTS");
  const ids = new Set<string>();
  for (const element of template.elements) {
    if (!element.elementId.trim()) throw new Error("STAGE_ELEMENT_ID_REQUIRED");
    if (ids.has(element.elementId)) throw new Error(`STAGE_TEMPLATE_DUPLICATE_ELEMENT:${element.elementId}`);
    ids.add(element.elementId);
    if (element.requiredCoverage.length === 0) throw new Error(`STAGE_TEMPLATE_COVERAGE_REQUIRED:${element.elementId}`);
  }
}

function coverageIncludes(actual: readonly string[], required: readonly string[]): boolean {
  const set = new Set(actual);
  return required.every((item) => set.has(item));
}

function validAt(validUntil: string, now: string): boolean {
  const validMs = Date.parse(validUntil);
  const nowMs = Date.parse(now);
  if (!Number.isFinite(validMs) || !Number.isFinite(nowMs)) return false;
  return validMs >= nowMs;
}

export class B1StageAssembler {
  assemble(template: Readonly<StageTemplate>, elements: readonly AcceptedStageElement[], now: string): B1AssemblyResult {
    validateTemplate(template);
    if (elements.length < 2) {
      return {
        status: "BLOKADA",
        reason: "B1 nie może złożyć etapu z mniej niż dwóch zaakceptowanych elementów.",
        proposedSolution: "Dostarcz wszystkie elementy przewidziane szablonem etapu po 1/1 strażników."
      };
    }

    const supplied = new Map<string, AcceptedStageElement>();
    for (const element of elements) {
      if (supplied.has(element.elementId)) {
        return {
          status: "BLOKADA",
          reason: `Element ${element.elementId} został dostarczony więcej niż raz.`,
          proposedSolution: "Dostarcz dokładnie po jednym skończonym elemencie dla każdej pozycji szablonu."
        };
      }
      supplied.set(element.elementId, element);
    }

    if (supplied.size !== template.elements.length) {
      return {
        status: "BLOKADA",
        reason: "Zestaw elementów nie pokrywa dokładnie szablonu etapu.",
        proposedSolution: "Uzupełnij brakujące elementy albo usuń elementy spoza szablonu przed składaniem."
      };
    }

    const ordered: AcceptedStageElement[] = [];
    for (const expected of template.elements) {
      const actual = supplied.get(expected.elementId);
      if (!actual) {
        return {
          status: "BLOKADA",
          reason: `Brakuje elementu ${expected.elementId}.`,
          proposedSolution: "Dostarcz brakujący skończony element zgodny z szablonem etapu."
        };
      }
      if (actual.qc1 !== 1 || actual.opposing !== 1) {
        return {
          status: "BLOKADA",
          reason: `Element ${expected.elementId} nie ma wymaganej zgody 1/1 strażników stopnia A.`,
          proposedSolution: "Zakończ pętlę elementu i dostarcz go ponownie dopiero po 1/1."
        };
      }
      if (actual.artifactFp !== expected.expectedArtifactFp) {
        return {
          status: "BLOKADA",
          reason: `Artefakt elementu ${expected.elementId} nie odpowiada szablonowi.`,
          proposedSolution: "Dostarcz dokładnie artefakt wskazany przez szablon etapu."
        };
      }
      if (actual.contractFp !== expected.expectedContractFp) {
        return {
          status: "BLOKADA",
          reason: `Kontrakt elementu ${expected.elementId} nie odpowiada szablonowi.`,
          proposedSolution: "Dostarcz element związany z dokładnym kontraktem wymaganym przez szablon."
        };
      }
      if (!coverageIncludes(actual.coverage, expected.requiredCoverage)) {
        return {
          status: "BLOKADA",
          reason: `Element ${expected.elementId} nie pokrywa wymaganej treści etapu.`,
          proposedSolution: "Uzupełnij element zgodnie z wymaganym pokryciem szablonu i przeprowadź jego pętlę ponownie."
        };
      }
      if (!validAt(actual.validUntil, now)) {
        return {
          status: "BLOKADA",
          reason: `Ważność elementu ${expected.elementId} wygasła przed składaniem.`,
          proposedSolution: "Odśwież kontrolę elementu i dostarcz aktualny skończony wynik."
        };
      }
      ordered.push({ ...actual, coverage: [...actual.coverage] });
    }

    const base = {
      stageId: template.stageId,
      elementOrder: template.elements.map((element) => element.elementId),
      elements: ordered
    };
    return {
      status: "GOTOWE",
      stage: { ...base, assemblyFp: stageFingerprint(base) }
    };
  }
}

export class Qc2StageComparator {
  compare(template: Readonly<StageTemplate>, stage: Readonly<AssembledStage>, now: string): Qc2Result {
    validateTemplate(template);
    const stageFp = canonicalDigest(stage);
    if (stage.stageId !== template.stageId) {
      return { value: 0, stageFp, reason: "Złożony klocek należy do innego etapu.", proposedSolution: "Przekaż do QC2 klocek złożony dla dokładnego szablonu tego etapu." };
    }

    const expectedOrder = template.elements.map((element) => element.elementId);
    if (canonicalDigest(stage.elementOrder) !== canonicalDigest(expectedOrder)) {
      return { value: 0, stageFp, reason: "Kolejność elementów nie odpowiada szablonowi etapu.", proposedSolution: "B1 ma złożyć elementy dokładnie w kolejności wskazanej przez szablon." };
    }
    if (stage.elements.length !== template.elements.length) {
      return { value: 0, stageFp, reason: "Liczba elementów złożonego klocka nie odpowiada szablonowi.", proposedSolution: "Złóż dokładnie wszystkie i tylko elementy wskazane w szablonie etapu." };
    }

    for (let index = 0; index < template.elements.length; index += 1) {
      const expected = template.elements[index]!;
      const actual = stage.elements[index]!;
      if (actual.elementId !== expected.elementId) {
        return { value: 0, stageFp, reason: `Pozycja ${index + 1} zawiera niewłaściwy element.`, proposedSolution: "B1 ma zachować dokładny kontrakt kolejności szablonu." };
      }
      if (actual.artifactFp !== expected.expectedArtifactFp || actual.contractFp !== expected.expectedContractFp) {
        return { value: 0, stageFp, reason: `Element ${actual.elementId} nie odpowiada kontraktowi szablonu.`, proposedSolution: "Zastąp element dokładnie zaakceptowanym artefaktem i kontraktem z szablonu." };
      }
      if (!coverageIncludes(actual.coverage, expected.requiredCoverage)) {
        return { value: 0, stageFp, reason: `Element ${actual.elementId} nie pokrywa wymaganej treści.`, proposedSolution: "Przekaż element z pełnym pokryciem wymaganym przez szablon etapu." };
      }
      if (!validAt(actual.validUntil, now)) {
        return { value: 0, stageFp, reason: `Element ${actual.elementId} utracił ważność.`, proposedSolution: "Odśwież kontrolę elementu przed ponownym składaniem." };
      }
    }

    const base = { stageId: stage.stageId, elementOrder: [...stage.elementOrder], elements: stage.elements.map((element) => ({ ...element, coverage: [...element.coverage] })) };
    if (stage.assemblyFp !== stageFingerprint(base)) {
      return { value: 0, stageFp, reason: "Fingerprint złożonego klocka nie odpowiada jego zawartości.", proposedSolution: "B1 ma ponownie złożyć klocek z niezmienionych zaakceptowanych elementów." };
    }

    return { value: 1, stageFp };
  }
}
