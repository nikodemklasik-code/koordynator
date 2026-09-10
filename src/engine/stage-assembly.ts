import { canonicalDigest } from "../crypto/canonical-digest.js";
import type { Digest } from "../domain/ids.js";
import type { IssueIdentity } from "./autonomous-recovery.js";

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

export type B1AssemblyReceipt = {
  kind: "b1-assembly-receipt-v1";
  stageId: string;
  templateFp: Digest;
  inputElements: Array<{ elementId: string; artifactFp: Digest; contractFp: Digest }>;
  outputAssemblyFp: Digest;
  process: "template-order-exact";
  receiptFp: Digest;
};

export type B1AssemblyResult =
  | { status: "GOTOWE"; stage: AssembledStage; receipt: B1AssemblyReceipt }
  | { status: "BLOKADA"; reason: string; proposedSolution: string };

export type Qc2Result =
  | { value: 1; stageFp: Digest }
  | { value: 0; reason: string; proposedSolution: string; stageFp: Digest; issue?: IssueIdentity };

export type StageOpposingResult =
  | { value: 1; stageFp: Digest }
  | { value: 0; reason: string; proposedSolution: string; stageFp: Digest; issue: IssueIdentity };

function stageFingerprint(input: Omit<AssembledStage, "assemblyFp">): Digest {
  return canonicalDigest({ kind: "assembled-stage-v1", ...input });
}

function receiptFingerprint(input: Omit<B1AssemblyReceipt, "receiptFp">): Digest {
  return canonicalDigest(input);
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

function opposingIssue(stageId: string, location: string, kind: string, expected: string, actual: string): IssueIdentity {
  return { element: stageId, location, kind, expected, actual, detectedBy: "Zespół przeciwny" };
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
    const stage: AssembledStage = { ...base, assemblyFp: stageFingerprint(base) };
    const receiptBase: Omit<B1AssemblyReceipt, "receiptFp"> = {
      kind: "b1-assembly-receipt-v1",
      stageId: template.stageId,
      templateFp: canonicalDigest(template),
      inputElements: ordered.map((element) => ({
        elementId: element.elementId,
        artifactFp: element.artifactFp,
        contractFp: element.contractFp
      })),
      outputAssemblyFp: stage.assemblyFp,
      process: "template-order-exact"
    };
    return {
      status: "GOTOWE",
      stage,
      receipt: { ...receiptBase, receiptFp: receiptFingerprint(receiptBase) }
    };
  }
}

export class StageOpposingComparator {
  compare(
    template: Readonly<StageTemplate>,
    stage: Readonly<AssembledStage>,
    receipt: Readonly<B1AssemblyReceipt>
  ): StageOpposingResult {
    validateTemplate(template);
    const stageFp = canonicalDigest(stage);
    const fail = (location: string, kind: string, expected: string, actual: string, reason: string, proposedSolution: string): StageOpposingResult => ({
      value: 0,
      stageFp,
      reason,
      proposedSolution,
      issue: opposingIssue(template.stageId, location, kind, expected, actual)
    });

    if (receipt.kind !== "b1-assembly-receipt-v1") {
      return fail("B1 receipt", "receipt-kind", "b1-assembly-receipt-v1", receipt.kind, "Zespół przeciwny nie potwierdził rodzaju dowodu procesu B1.", "Powtórz składanie B1 i przekaż kanoniczny receipt procesu.");
    }
    if (receipt.stageId !== template.stageId) {
      return fail("B1 receipt.stageId", "stage-id", template.stageId, receipt.stageId, "Receipt B1 dotyczy innego etapu.", "Powtórz składanie dokładnie dla kontrolowanego szablonu etapu.");
    }
    const expectedTemplateFp = canonicalDigest(template);
    if (receipt.templateFp !== expectedTemplateFp) {
      return fail("B1 receipt.templateFp", "template-fingerprint", expectedTemplateFp, receipt.templateFp, "B1 nie wykazał składania względem dokładnego szablonu etapu.", "Powtórz B1 na niezmienionym kanonicznym szablonie.");
    }
    if (receipt.process !== "template-order-exact") {
      return fail("B1 receipt.process", "assembly-process", "template-order-exact", receipt.process, "Droga składania B1 nie odpowiada wymaganej drodze z instrukcji.", "Powtórz B1 bez alternatywnej kolejności ani sposobu składania.");
    }
    if (receipt.outputAssemblyFp !== stage.assemblyFp) {
      return fail("B1 receipt.outputAssemblyFp", "assembly-output", stage.assemblyFp, receipt.outputAssemblyFp, "Receipt procesu B1 nie jest związany z przekazanym klockiem.", "Powtórz składanie i przekaż receipt związany z dokładnym wynikiem B1.");
    }
    const expectedInputs = stage.elements.map((element) => ({
      elementId: element.elementId,
      artifactFp: element.artifactFp,
      contractFp: element.contractFp
    }));
    const expectedInputsFp = canonicalDigest(expectedInputs);
    const actualInputsFp = canonicalDigest(receipt.inputElements);
    if (actualInputsFp !== expectedInputsFp) {
      return fail("B1 receipt.inputElements", "assembly-inputs", expectedInputsFp, actualInputsFp, "B1 nie wykazał użycia dokładnie tych elementów, które znalazły się w klocku.", "Powtórz składanie z niezmienionych zaakceptowanych elementów i odtwórz receipt.");
    }
    const receiptBase: Omit<B1AssemblyReceipt, "receiptFp"> = {
      kind: receipt.kind,
      stageId: receipt.stageId,
      templateFp: receipt.templateFp,
      inputElements: receipt.inputElements.map((item) => ({ ...item })),
      outputAssemblyFp: receipt.outputAssemblyFp,
      process: receipt.process
    };
    const expectedReceiptFp = receiptFingerprint(receiptBase);
    if (receipt.receiptFp !== expectedReceiptFp) {
      return fail("B1 receipt.receiptFp", "receipt-integrity", expectedReceiptFp, receipt.receiptFp, "Integralność receiptu B1 nie została potwierdzona.", "Powtórz B1 i wygeneruj receipt z bieżącego procesu składania.");
    }

    return { value: 1, stageFp };
  }
}

export class Qc2StageComparator {
  compare(template: Readonly<StageTemplate>, stage: Readonly<AssembledStage>, now: string): Qc2Result {
    validateTemplate(template);
    const stageFp = canonicalDigest(stage);
    const issue = (location: string, kind: string, expected: string, actual: string): IssueIdentity => ({
      element: template.stageId,
      location,
      kind,
      expected,
      actual,
      detectedBy: "QC2"
    });
    if (stage.stageId !== template.stageId) {
      return { value: 0, stageFp, reason: "Złożony klocek należy do innego etapu.", proposedSolution: "Przekaż do QC2 klocek złożony dla dokładnego szablonu tego etapu.", issue: issue("stage.stageId", "stage-id", template.stageId, stage.stageId) };
    }

    const expectedOrder = template.elements.map((element) => element.elementId);
    if (canonicalDigest(stage.elementOrder) !== canonicalDigest(expectedOrder)) {
      return { value: 0, stageFp, reason: "Kolejność elementów nie odpowiada szablonowi etapu.", proposedSolution: "B1 ma złożyć elementy dokładnie w kolejności wskazanej przez szablon.", issue: issue("stage.elementOrder", "element-order", JSON.stringify(expectedOrder), JSON.stringify(stage.elementOrder)) };
    }
    if (stage.elements.length !== template.elements.length) {
      return { value: 0, stageFp, reason: "Liczba elementów złożonego klocka nie odpowiada szablonowi.", proposedSolution: "Złóż dokładnie wszystkie i tylko elementy wskazane w szablonie etapu.", issue: issue("stage.elements", "element-count", String(template.elements.length), String(stage.elements.length)) };
    }

    for (let index = 0; index < template.elements.length; index += 1) {
      const expected = template.elements[index]!;
      const actual = stage.elements[index]!;
      if (actual.elementId !== expected.elementId) {
        return { value: 0, stageFp, reason: `Pozycja ${index + 1} zawiera niewłaściwy element.`, proposedSolution: "B1 ma zachować dokładny kontrakt kolejności szablonu.", issue: issue(`stage.elements[${index}].elementId`, "element-id", expected.elementId, actual.elementId) };
      }
      if (actual.artifactFp !== expected.expectedArtifactFp || actual.contractFp !== expected.expectedContractFp) {
        return { value: 0, stageFp, reason: `Element ${actual.elementId} nie odpowiada kontraktowi szablonu.`, proposedSolution: "Zastąp element dokładnie zaakceptowanym artefaktem i kontraktem z szablonu.", issue: issue(`stage.elements[${index}]`, "element-contract", `${expected.expectedArtifactFp}:${expected.expectedContractFp}`, `${actual.artifactFp}:${actual.contractFp}`) };
      }
      if (!coverageIncludes(actual.coverage, expected.requiredCoverage)) {
        return { value: 0, stageFp, reason: `Element ${actual.elementId} nie pokrywa wymaganej treści.`, proposedSolution: "Przekaż element z pełnym pokryciem wymaganym przez szablon etapu.", issue: issue(`stage.elements[${index}].coverage`, "coverage", JSON.stringify(expected.requiredCoverage), JSON.stringify(actual.coverage)) };
      }
      if (!validAt(actual.validUntil, now)) {
        return { value: 0, stageFp, reason: `Element ${actual.elementId} utracił ważność.`, proposedSolution: "Odśwież kontrolę elementu przed ponownym składaniem.", issue: issue(`stage.elements[${index}].validUntil`, "validity", `>=${now}`, actual.validUntil) };
      }
    }

    const base = { stageId: stage.stageId, elementOrder: [...stage.elementOrder], elements: stage.elements.map((element) => ({ ...element, coverage: [...element.coverage] })) };
    if (stage.assemblyFp !== stageFingerprint(base)) {
      const expectedAssemblyFp = stageFingerprint(base);
      return { value: 0, stageFp, reason: "Fingerprint złożonego klocka nie odpowiada jego zawartości.", proposedSolution: "B1 ma ponownie złożyć klocek z niezmienionych zaakceptowanych elementów.", issue: issue("stage.assemblyFp", "assembly-integrity", expectedAssemblyFp, stage.assemblyFp) };
    }

    return { value: 1, stageFp };
  }
}
