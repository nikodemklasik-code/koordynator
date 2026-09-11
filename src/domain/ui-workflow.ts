export type UiStage =
  | "UI_REQUIREMENTS"
  | "UI_DESIGN"
  | "UI_BUILD"
  | "CODE_REVIEW"
  | "BROWSER_TEST"
  | "UI_VALIDATION"
  | "UI_REPAIR"
  | "UI_ACCEPTED";

export type UiFinding = {
  findingId: string;
  severity: "BLOCKER" | "HIGH" | "MEDIUM" | "LOW";
  category: "CODE" | "FUNCTIONAL" | "VISUAL" | "RESPONSIVE" | "ACCESSIBILITY" | "SECURITY";
  route?: string;
  viewport?: string;
  evidence: string[];
  expected: string;
  actual: string;
  proposedCorrection: string;
};

export type UiDesignSpec = {
  taskId: string;
  revision: number;
  contractFp: string;
  routes: string[];
  components: string[];
  userFlows: string[];
  interactionStates: string[];
  breakpoints: string[];
  accessibilityRequirements: string[];
  visualReferences: string[];
  acceptanceCriteria: string[];
};

export type UiBuildReceipt = {
  taskId: string;
  revision: number;
  contractFp: string;
  baseSha: string;
  subjectSha: string;
  treeSha: string;
  changedFiles: string[];
  commands: string[];
  tests: Array<{ command: string; exitCode: number; status: "PASS" | "FAIL" | "NOT_RUN" }>;
  writeLeaseId: string;
};

export type UiCodeReviewReport = {
  taskId: string;
  revision: number;
  contractFp: string;
  subjectSha: string;
  reviewer: "CODEX";
  verdict: "PASS" | "FAIL";
  findings: UiFinding[];
};

export type UiBrowserReport = {
  taskId: string;
  revision: number;
  contractFp: string;
  subjectSha: string;
  previewBuildFp: string;
  verdict: "PASS" | "FAIL";
  testedRoutes: string[];
  testedViewports: string[];
  interactions: string[];
  screenshots: string[];
  consoleErrors: string[];
  networkErrors: string[];
  accessibilityResults: unknown[];
};

export type UiValidationReport = {
  taskId: string;
  revision: number;
  contractFp: string;
  subjectSha: string;
  verdict: "PASS" | "FAIL";
  responsive: boolean;
  accessible: boolean;
  visualConsistency: boolean;
  interactionConsistency: boolean;
  findings: UiFinding[];
};

export type UiGateToken = "PASS" | "FAIL" | "SEE_AGENT_REPORT" | "NOT_TESTED" | "PROCESS_COMPLETED";

export type UiAcceptanceInput = {
  design: UiDesignSpec | null;
  build: UiBuildReceipt | null;
  review: UiCodeReviewReport | null;
  browser: UiBrowserReport | null;
  validation: UiValidationReport | null;
  securityScan: UiGateToken;
  accessibilityGate: UiGateToken;
  activeWriteLease: boolean;
  repairAttempts: number;
};

export type UiAcceptanceResult =
  | { status: "UI_ACCEPTED" }
  | { status: "BLOCKED"; reason?: string }
  | { status: "STALE" }
  | { status: "FAIL"; findings: UiFinding[] };

const TRANSITIONS: Record<UiStage, ReadonlySet<UiStage>> = {
  UI_REQUIREMENTS: new Set(["UI_DESIGN"]),
  UI_DESIGN: new Set(["UI_BUILD"]),
  UI_BUILD: new Set(["CODE_REVIEW", "BROWSER_TEST"]),
  CODE_REVIEW: new Set(["UI_VALIDATION"]),
  BROWSER_TEST: new Set(["UI_VALIDATION"]),
  UI_VALIDATION: new Set(["UI_ACCEPTED", "UI_REPAIR"]),
  UI_REPAIR: new Set(["CODE_REVIEW", "BROWSER_TEST"]),
  UI_ACCEPTED: new Set([])
};

export function assertUiTransition(
  from: UiStage,
  to: UiStage,
  flags: { designAccepted?: boolean; buildCompleted?: boolean } = {}
): void {
  if (to === "UI_ACCEPTED") throw new Error("UI_ACCEPT_COORDINATOR_ONLY");
  if (!TRANSITIONS[from].has(to)) throw new Error(`UI_TRANSITION_INVALID:${from}->${to}`);
  if (from === "UI_DESIGN" && to === "UI_BUILD" && flags.designAccepted !== true) {
    throw new Error("UI_DESIGN_REQUIRED");
  }
  if (from === "UI_BUILD" && (to === "CODE_REVIEW" || to === "BROWSER_TEST") && flags.buildCompleted !== true) {
    throw new Error("UI_BUILD_REQUIRED");
  }
}

function isPass(token: UiGateToken): boolean {
  return token === "PASS";
}

function collectFindings(input: UiAcceptanceInput): UiFinding[] {
  return [
    ...(input.review?.findings ?? []),
    ...(input.validation?.findings ?? [])
  ];
}

export function evaluateUiAcceptance(input: UiAcceptanceInput): UiAcceptanceResult {
  if (!input.design || !input.build || !input.review || !input.browser || !input.validation) {
    return { status: "BLOCKED", reason: "UI_REPORT_MISSING" };
  }
  if (input.activeWriteLease) return { status: "BLOCKED", reason: "WRITE_LEASE_ACTIVE" };
  if (!isPass(input.securityScan) || !isPass(input.accessibilityGate)) {
    return { status: "BLOCKED", reason: "UI_GATE_INCOMPLETE" };
  }

  const subjectSha = input.build.subjectSha;
  const contractFp = input.design.contractFp;
  const reports = [input.build, input.review, input.browser, input.validation, input.design];
  if (reports.some((report) => report.contractFp !== contractFp)) return { status: "STALE" };
  if ([input.review, input.browser, input.validation].some((report) => report.subjectSha !== subjectSha)) {
    return { status: "STALE" };
  }

  const findings = collectFindings(input);
  const failed =
    input.review.verdict !== "PASS"
    || input.browser.verdict !== "PASS"
    || input.validation.verdict !== "PASS"
    || !input.validation.responsive
    || !input.validation.accessible
    || !input.validation.visualConsistency
    || !input.validation.interactionConsistency
    || findings.some((finding) => finding.severity === "BLOCKER" || finding.severity === "HIGH");
  if (failed) return { status: "FAIL", findings };

  return { status: "UI_ACCEPTED" };
}

export function nextUiRepair(input: UiAcceptanceInput, result: UiAcceptanceResult): {
  revision: number;
  stage: "UI_REPAIR";
  correctionPack: { frozen: true; findings: UiFinding[] };
  objective: string | undefined;
} {
  if (result.status !== "FAIL") throw new Error("UI_REPAIR_REQUIRES_FAIL");
  if (input.repairAttempts >= 2) throw new Error("BLOCKED_OWNER_DECISION");
  return {
    revision: (input.design?.revision ?? 0) + 1,
    stage: "UI_REPAIR",
    correctionPack: { frozen: true, findings: result.findings },
    objective: input.design?.acceptanceCriteria[0]
  };
}
