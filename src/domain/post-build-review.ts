/**
 * Post-build reviewer (auditor-post-build w ustroju Przeznaczenia).
 *
 * Recenzent, NIE bramka: patrzy na gotowy produkt, odtwarza z niego zamysł,
 * porównuje z objective/scope/testami i przedstawia werdykt + evidence.
 * Jego werdykt jest DORADCZY — `blocks` jest zawsze false; produkt idzie dalej.
 * Bramki fail-closed (mandat Harmonii, capability, lease) to osobna warstwa.
 *
 * Zasady: UNEXECUTED ≠ PASS; każdy finding ma evidence. Deterministyczny.
 */

export type PostBuildInput = {
  subjectSha: string;
  treeSha: string;
  objective: string;
  acceptanceChecks: string[];
  changedFiles: string[];
  allowedPaths: string[];
  testVerdict: "PASS" | "FAIL" | "NOT_RUN";
};

export type ReviewCategory = "SCOPE" | "TESTS" | "OBJECTIVE";

export type ReviewFinding = {
  category: ReviewCategory;
  severity: "HIGH" | "MEDIUM" | "LOW";
  detail: string;
  evidence: string[];
};

export type PostBuildReview = {
  subjectSha: string;
  treeSha: string;
  verdict: "MATCH" | "DRIFT";
  /** A reviewer never blocks release — always false. Kept explicit as a contract. */
  blocks: false;
  reconstructedIntent: string;
  findings: ReviewFinding[];
  evidence: string[];
};

/** True when `file` sits under one of the allowed path prefixes. */
function withinScope(file: string, allowedPaths: string[]): boolean {
  if (allowedPaths.length === 0) return true;
  return allowedPaths.some((prefix) => {
    const clean = prefix.replace(/\/+$/, "").replace(/\/\*+$/, "");
    return file === clean || file.startsWith(`${clean}/`);
  });
}

/** Reconstructs, from the touched files, what the product appears to address. */
function reconstructIntent(changedFiles: string[]): string {
  const areas = [...new Set(changedFiles
    .filter((f) => !f.startsWith("tests/") && !f.includes("/tests/"))
    .map((f) => f.split("/").slice(0, 2).join("/")))];
  if (areas.length === 0) return "Produkt nie zmienia plików źródłowych poza testami.";
  return `Produkt dotyka: ${areas.join(", ")}.`;
}

export function reviewPostBuild(input: PostBuildInput): PostBuildReview {
  const findings: ReviewFinding[] = [];
  const evidence: string[] = [
    `subjectSha=${input.subjectSha}`,
    `treeSha=${input.treeSha}`,
    `changedFiles=${input.changedFiles.length}`
  ];

  // Scope drift: any changed SOURCE file outside the allowed paths is a finding.
  // Test files are validation artifacts, not product scope, so they don't count.
  const outOfScope = input.changedFiles
    .filter((f) => !f.startsWith("tests/") && !f.includes("/tests/"))
    .filter((f) => !withinScope(f, input.allowedPaths));
  if (outOfScope.length > 0) {
    findings.push({
      category: "SCOPE",
      severity: "HIGH",
      detail: "Produkt zmienia pliki poza zadeklarowanym zakresem.",
      evidence: outOfScope
    });
  }

  // Tests: UNEXECUTED ≠ PASS. Only a real PASS clears this dimension.
  if (input.testVerdict !== "PASS") {
    findings.push({
      category: "TESTS",
      severity: input.testVerdict === "FAIL" ? "HIGH" : "MEDIUM",
      detail: input.testVerdict === "FAIL"
        ? "Niezależne testy nie przeszły."
        : "Testy nie zostały wykonane — UNEXECUTED nie znaczy PASS.",
      evidence: [`testVerdict=${input.testVerdict}`]
    });
  }

  // Objective coverage: at least one source file should exist for a stated objective.
  const sourceTouched = input.changedFiles.some((f) => !f.startsWith("tests/") && !f.includes("/tests/"));
  if (input.objective.trim() && !sourceTouched) {
    findings.push({
      category: "OBJECTIVE",
      severity: "MEDIUM",
      detail: "Cel zadania nie ma odpowiadającej zmiany w kodzie źródłowym.",
      evidence: [`objective=${input.objective}`]
    });
  }

  const verdict = findings.length === 0 ? "MATCH" : "DRIFT";
  return {
    subjectSha: input.subjectSha,
    treeSha: input.treeSha,
    verdict,
    blocks: false,
    reconstructedIntent: reconstructIntent(input.changedFiles),
    findings,
    evidence
  };
}
