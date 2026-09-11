/**
 * /poznanie v13.1.0 — brama wejściowa przed fazą twórczą.
 *
 * Odwzorowanie kontraktu z biblioteki komend Harmonii (Harmonia Command Library 13/10)
 * oraz `policies/COMMON_CONTRACT.md`. Harmonia mierzy, opiniuje, bramkuje i weryfikuje —
 * NIE decyduje i NIE wykonuje. Żaden podmiot nie pomyśli, wykona i zatwierdzi tej samej
 * materialnej zmiany sam.
 *
 * Reguła kardynalna (INV-POZNANIE-01): choć jeden finding CARDINAL daje natychmiastowy BLOCK.
 * Nie wolno uśredniać blockera z wynikami pozytywnymi ani odkładać go do recydywy.
 */

/** `policies/VERDICT_POLICY.md` */
export type Verdict = "PASS" | "PASS_WARUNKOWY" | "REVISE" | "BLOCK" | "INCOMPLETE" | "NOT_APPLICABLE";

/** `COMMON_CONTRACT.md` §3 — status epistemiczny. */
export type EpistemicStatus =
  | "POTWIERDZONE" | "PRAWDOPODOBNE" | "HIPOTEZA"
  | "WYMAGA_ŹRÓDŁA" | "WYMAGA_URUCHOMIENIA" | "NIEOBJĘTE" | "SPRZECZNE";

export type Severity = "CARDINAL" | "MAJOR" | "MINOR" | "INFO";

/** Typy tez wg algorytmu §5.1. */
export type ThesisKind =
  | "FAKT" | "OPINIA" | "ŻYCZENIE" | "DEFINICJA"
  | "HIPOTEZA" | "CONSTRAINT" | "OWNER_DECISION" | "UNKNOWN";

export type Thesis = {
  id: string;
  kind: ThesisKind;
  claim: string;
  /** Adres dowodowy — bez kotwicy teza nie jest faktem (COMMON_CONTRACT §2). */
  address?: string;
};

export type Evidence = { address: string; quote?: string };

export type Finding = {
  id: string;
  severity: Severity;
  claim: string;
  evidence: Evidence[];
  expected: string;
  actual: string;
  impact: string;
  confidence: EpistemicStatus;
};

export type PoznanieReport = {
  command: "/poznanie";
  version: string;
  runId: string;
  scopeHash: string;
  status: EpistemicStatus;
  verdict: Verdict;
  theses: Thesis[];
  /** Słownik terminów nośnych; ekwiwokacja jest blockerem. */
  terms: Array<{ term: string; definition: string }>;
  findings: Finding[];
  coverage: { included: string[]; excluded: string[] };
  limitations: string[];
  counterexampleAttempt: { performed: boolean; result: string };
  /** /lustro wykonane przez tego samego wykonawcę to SELF_REVIEW, nie INDEPENDENT_REVIEW. */
  mirror: { required: true; status: "PENDING" | "SELF_REVIEW" | "INDEPENDENT_REVIEW" };
  nextAllowedCommands: string[];
  model: string;
  completedAt: string;
};

export class PoznanieError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
    this.name = "PoznanieError";
  }
}

export type PoznanieOptions = {
  endpoint?: string;
  apiKey?: string;
  apiKeyEnv?: string;
  model: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

const VERSION = "13.1.0";
const NEXT_ALLOWED = ["/brzytwa", "/rozwiazanie"];

const THESIS_KINDS = new Set<ThesisKind>([
  "FAKT", "OPINIA", "ŻYCZENIE", "DEFINICJA", "HIPOTEZA", "CONSTRAINT", "OWNER_DECISION", "UNKNOWN"
]);
const SEVERITIES = new Set<Severity>(["CARDINAL", "MAJOR", "MINOR", "INFO"]);
const STATUSES = new Set<EpistemicStatus>([
  "POTWIERDZONE", "PRAWDOPODOBNE", "HIPOTEZA", "WYMAGA_ŹRÓDŁA", "WYMAGA_URUCHOMIENIA", "NIEOBJĘTE", "SPRZECZNE"
]);

const SYSTEM = [
  "Wykonujesz komendę /poznanie v13.1.0 z biblioteki Harmonii. Jesteś Harmonią: mierzysz,",
  "opiniujesz i bramkujesz. NIE decydujesz, NIE wykonujesz i NIE ratyfikujesz fundamentu.",
  "Analizujesz TEKST/SPECYFIKACJĘ, nie kod. Nie rozszerzasz zakresu przez domysł.",
  "",
  "Algorytm, w tej kolejności:",
  "1. Wydobądź tezy i oznacz każdą: FAKT, OPINIA, ŻYCZENIE, DEFINICJA, HIPOTEZA, CONSTRAINT, OWNER_DECISION albo UNKNOWN.",
  "2. Zbuduj słownik terminów nośnych i wykryj ekwiwokacje.",
  "3. Dla każdej tezy zapisz adres; brak podstawy NIE staje się faktem.",
  "4. Przeprowadź test dedukcyjny/indukcyjny/abdukcyjny.",
  "5. Zidentyfikuj sprzeczności, napięcia, luki, redundancje i cele niespełnialne.",
  "6. Finding jest KARDYNALNY tylko wtedy, gdy naprawa wymaga zmiany tezy rdzenia albo cel jest logicznie niemożliwy.",
  "7. Wykonaj próbę obalenia głównej tezy.",
  "",
  "Każde materialne twierdzenie musi mieć kotwicę (adres/cytat). Bez kotwicy obniż je do",
  "HIPOTEZA, WYMAGA_ŹRÓDŁA, WYMAGA_URUCHOMIENIA albo NIEOBJĘTE. Nie zmyślaj treści spoza materiału.",
  "",
  "Odpowiadasz WYŁĄCZNIE jednym obiektem JSON, bez komentarza i bez bloku kodu:",
  '{"status": "<status epistemiczny całości>",',
  ' "theses": [{"id": "T1", "kind": "FAKT", "claim": "<teza>", "address": "<adres w materiale>"}],',
  ' "terms": [{"term": "<termin nośny>", "definition": "<jak użyty>"}],',
  ' "findings": [{"id": "POZNANIE-001", "severity": "CARDINAL|MAJOR|MINOR|INFO", "claim": "<twierdzenie>",',
  '   "evidence": [{"address": "<adres>", "quote": "<cytat lub pomiń>"}],',
  '   "expected": "<kryterium>", "actual": "<stan>", "impact": "<skutek>", "confidence": "<status epistemiczny>"}],',
  ' "coverage": {"included": ["<co objęto>"], "excluded": ["<czego nie>"]},',
  ' "limitations": ["<ograniczenie>"],',
  ' "counterexampleAttempt": {"performed": true, "result": "<wynik próby obalenia>"}}'
].join("\n");

function normalizeEndpoint(value: string): string {
  return value.replace(/\/+$/, "");
}

function text(value: unknown, code: string, max = 4000): string {
  const result = typeof value === "string" ? value.trim() : "";
  if (!result || result.length > max) throw new PoznanieError(code, 502);
  return result;
}

function stringList(value: unknown, max = 100): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new PoznanieError("POZNANIE_LIST_INVALID", 502);
  return value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean).slice(0, max);
}

export function extractJsonObject(raw: string): Record<string, unknown> {
  const value = String(raw ?? "").trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(value);
  const candidate = fenced?.[1]?.trim() || value;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) throw new PoznanieError("POZNANIE_RESPONSE_NOT_JSON", 502);
  let parsed: unknown;
  try { parsed = JSON.parse(candidate.slice(start, end + 1)); }
  catch { throw new PoznanieError("POZNANIE_RESPONSE_NOT_JSON", 502); }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new PoznanieError("POZNANIE_RESPONSE_NOT_JSON", 502);
  }
  return parsed as Record<string, unknown>;
}

/**
 * Werdykt wg VERDICT_POLICY + INV-POZNANIE-01/02.
 * CARDINAL => BLOCK bezwarunkowo. PASS nie może zawierać findingu do naprawy przed startem.
 */
export function decideVerdict(findings: Finding[], counterexamplePerformed: boolean): Verdict {
  if (findings.some((finding) => finding.severity === "CARDINAL")) return "BLOCK";
  // Bez próby obalenia brakuje wymaganego etapu — nie wolno tego uznać za PASS.
  if (!counterexamplePerformed) return "INCOMPLETE";
  if (findings.some((finding) => finding.severity === "MAJOR")) return "REVISE";
  if (findings.some((finding) => finding.severity === "MINOR")) return "PASS_WARUNKOWY";
  return "PASS";
}

export class Poznanie {
  private readonly endpoint: string;
  private readonly apiKey: string | undefined;
  private readonly apiKeyEnv: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: PoznanieOptions) {
    this.endpoint = normalizeEndpoint(options.endpoint ?? "http://127.0.0.1:20128/v1");
    this.apiKey = options.apiKey;
    this.apiKeyEnv = options.apiKeyEnv ?? "OMNIROUTE_API_KEY";
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 180_000;
  }

  private credential(): string {
    const key = this.apiKey ?? process.env[this.apiKeyEnv] ?? "";
    if (!key.trim()) throw new PoznanieError("POZNANIE_AUTH_REQUIRED", 503);
    return key.trim();
  }

  /** Scope Lock (COMMON_CONTRACT §1): zakres wiąże wynik, więc jego hash idzie do raportu. */
  private async scopeHash(source: string): Promise<string> {
    const { createHash } = await import("node:crypto");
    return `sha256:${createHash("sha256").update(source, "utf8").digest("hex")}`;
  }

  async run(project: string): Promise<PoznanieReport> {
    const source = String(project ?? "").trim();
    // Precondition: brak materiału => NEEDS_INPUT, nigdy ciche uzupełnienie.
    if (!source) throw new PoznanieError("POZNANIE_NEEDS_INPUT", 400);

    const response = await this.fetchImpl(`${this.endpoint}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.credential()}` },
      body: JSON.stringify({
        model: this.options.model,
        temperature: 0,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: `MATERIAŁ (zakres zamknięty):\n\n${source}` }
        ]
      }),
      signal: AbortSignal.timeout(this.timeoutMs)
    });
    if (!response.ok) throw new PoznanieError(`POZNANIE_HTTP_${response.status}`, 502);

    const payload = await response.json().catch(() => {
      throw new PoznanieError("POZNANIE_RESPONSE_NOT_JSON", 502);
    }) as { choices?: Array<{ message?: { content?: unknown } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new PoznanieError("POZNANIE_RESPONSE_EMPTY", 502);

    const parsed = extractJsonObject(content);
    const findings = this.findings(parsed.findings);
    const counterexample = this.counterexample(parsed.counterexampleAttempt);
    const { randomUUID } = await import("node:crypto");

    return {
      command: "/poznanie",
      version: VERSION,
      runId: randomUUID(),
      scopeHash: await this.scopeHash(source),
      status: this.status(parsed.status),
      verdict: decideVerdict(findings, counterexample.performed),
      theses: this.theses(parsed.theses),
      terms: this.terms(parsed.terms),
      findings,
      coverage: {
        included: stringList((parsed.coverage as Record<string, unknown> | undefined)?.included),
        excluded: stringList((parsed.coverage as Record<string, unknown> | undefined)?.excluded)
      },
      limitations: stringList(parsed.limitations),
      counterexampleAttempt: counterexample,
      // Ten sam wykonawca nie może orzec o sobie INDEPENDENT_REVIEW.
      mirror: { required: true, status: "PENDING" },
      nextAllowedCommands: [...NEXT_ALLOWED],
      model: this.options.model,
      completedAt: new Date().toISOString()
    };
  }

  private status(value: unknown): EpistemicStatus {
    const status = String(value ?? "").trim() as EpistemicStatus;
    if (!STATUSES.has(status)) throw new PoznanieError("POZNANIE_STATUS_INVALID", 502);
    return status;
  }

  private theses(value: unknown): Thesis[] {
    if (!Array.isArray(value) || value.length === 0) throw new PoznanieError("POZNANIE_THESES_REQUIRED", 502);
    return value.slice(0, 200).map((item) => {
      if (typeof item !== "object" || item === null) throw new PoznanieError("POZNANIE_THESIS_INVALID", 502);
      const record = item as Record<string, unknown>;
      const kind = String(record.kind ?? "").trim() as ThesisKind;
      if (!THESIS_KINDS.has(kind)) throw new PoznanieError("POZNANIE_THESIS_KIND_INVALID", 502);
      const address = typeof record.address === "string" ? record.address.trim() : "";
      // INV: teza bez kotwicy nie może być FAKT-em (COMMON_CONTRACT §2).
      if (kind === "FAKT" && !address) throw new PoznanieError("POZNANIE_FACT_WITHOUT_ANCHOR", 502);
      return {
        id: text(record.id, "POZNANIE_THESIS_ID_REQUIRED", 40),
        kind,
        claim: text(record.claim, "POZNANIE_THESIS_CLAIM_REQUIRED"),
        ...(address ? { address } : {})
      };
    });
  }

  private terms(value: unknown): Array<{ term: string; definition: string }> {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw new PoznanieError("POZNANIE_TERMS_INVALID", 502);
    return value.slice(0, 200).map((item) => {
      if (typeof item !== "object" || item === null) throw new PoznanieError("POZNANIE_TERMS_INVALID", 502);
      const record = item as Record<string, unknown>;
      return {
        term: text(record.term, "POZNANIE_TERM_REQUIRED", 200),
        definition: text(record.definition, "POZNANIE_TERM_DEFINITION_REQUIRED")
      };
    });
  }

  private findings(value: unknown): Finding[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw new PoznanieError("POZNANIE_FINDINGS_INVALID", 502);
    return value.slice(0, 200).map((item) => {
      if (typeof item !== "object" || item === null) throw new PoznanieError("POZNANIE_FINDINGS_INVALID", 502);
      const record = item as Record<string, unknown>;
      const severity = String(record.severity ?? "").trim() as Severity;
      if (!SEVERITIES.has(severity)) throw new PoznanieError("POZNANIE_SEVERITY_INVALID", 502);
      const confidence = String(record.confidence ?? "").trim() as EpistemicStatus;
      if (!STATUSES.has(confidence)) throw new PoznanieError("POZNANIE_CONFIDENCE_INVALID", 502);
      const evidence = this.evidence(record.evidence);
      // INV-POZNANIE-03 / COMMON_CONTRACT §2: materialny finding musi mieć adres dowodowy.
      if ((severity === "CARDINAL" || severity === "MAJOR") && evidence.length === 0) {
        throw new PoznanieError("POZNANIE_FINDING_WITHOUT_EVIDENCE", 502);
      }
      return {
        id: text(record.id, "POZNANIE_FINDING_ID_REQUIRED", 60),
        severity,
        claim: text(record.claim, "POZNANIE_FINDING_CLAIM_REQUIRED"),
        evidence,
        expected: text(record.expected, "POZNANIE_FINDING_EXPECTED_REQUIRED"),
        actual: text(record.actual, "POZNANIE_FINDING_ACTUAL_REQUIRED"),
        impact: text(record.impact, "POZNANIE_FINDING_IMPACT_REQUIRED"),
        confidence
      };
    });
  }

  private evidence(value: unknown): Evidence[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw new PoznanieError("POZNANIE_EVIDENCE_INVALID", 502);
    return value.slice(0, 50).map((item) => {
      if (typeof item !== "object" || item === null) throw new PoznanieError("POZNANIE_EVIDENCE_INVALID", 502);
      const record = item as Record<string, unknown>;
      const quote = typeof record.quote === "string" ? record.quote.trim() : "";
      return {
        address: text(record.address, "POZNANIE_EVIDENCE_ADDRESS_REQUIRED", 500),
        ...(quote ? { quote } : {})
      };
    });
  }

  private counterexample(value: unknown): { performed: boolean; result: string } {
    if (typeof value !== "object" || value === null) return { performed: false, result: "nie wykonano" };
    const record = value as Record<string, unknown>;
    const performed = record.performed === true;
    const result = typeof record.result === "string" ? record.result.trim() : "";
    return { performed, result: result || (performed ? "brak kontrprzykładu w objętym zakresie" : "nie wykonano") };
  }
}
