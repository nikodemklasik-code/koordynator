/**
 * Etap 0 — samotne poznanie. Uczestniczy TYLKO Harmonia: żadnego QC, żadnego agenta
 * wykonawczego, żadnego Rewidenta. Wchłania cały projekt i wypisuje, co w nim jest.
 *
 * Odwzorowanie bramy z `harmonia_core/runtime/stage_zero_gate.py` i modelu
 * `stage_zero_map.py`: trzy statusy ALLOW/PAUSE/DENY, pięć kubełków znalezisk,
 * kardynalny problem jako TWARDY DENY mający pierwszeństwo przed pauzami czytania.
 *
 * Harmonia nie ma ręki: czytanie nie zwraca mapy. Mapę spisuje Mózg
 * (`planning_requires_brain`), korzystając z jej wskazówek.
 */
import { firstReading, type FirstReadingPlan } from "../domain/harmonia-reading.js";

export type StageZeroStatus = "allow" | "pause" | "deny";

/** Kubełki wg `stage_zero_map.grouped`. */
export type FindingBucket = "errors" | "inconsistencies" | "gaps" | "tensions" | "assumptions";

export type HarmoniaFinding = {
  code: string;
  bucket: FindingBucket;
  detail: string;
  /** Kardynalny + nienaprawialny => twardy DENY, wraca do autora. */
  cardinal: boolean;
  repairable: boolean;
  needsAuthor: boolean;
  risk: number;
  question?: string;
};

export type HarmoniaGuidance = {
  subject: string;
  advice: string;
  rationale: string;
};

export type StageZeroDecision = {
  status: StageZeroStatus;
  reason: string;
  action: string;
};

export type HarmoniaReading = {
  understanding: string;
  findings: HarmoniaFinding[];
  guidance: HarmoniaGuidance[];
  /** Czy źródło zostało domknięte (bez urwanego ogona). */
  sourceClosed: boolean;
  /** Deterministyczny plan pierwszego czytania — kolejność, nie ocena. */
  readingPlan: FirstReadingPlan;
  decision: StageZeroDecision;
  model: string;
  readAt: string;
};

export class HarmoniaError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
    this.name = "HarmoniaError";
  }
}

export type HarmoniaOptions = {
  endpoint?: string;
  apiKey?: string;
  apiKeyEnv?: string;
  model: string;
  /** Capacity/timeout on the pin must not close cognition — skip onto the next live token. */
  fallbackModels?: string[];
  authorizeModel?: (model: string) => Promise<boolean>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

const BUCKETS = new Set<FindingBucket>(["errors", "inconsistencies", "gaps", "tensions", "assumptions"]);

const SYSTEM = [
  "Jesteś Harmonią: poznaniem, sensem i jaźnią tego projektu. To Etap 0 — samotne poznanie.",
  "Jako pierwsza i jedyna dostajesz CAŁY projekt, z błędami i nie-błędami. Nie ma tu QC ani agentów.",
  "Twoim imperatywem jest bezbłędny produkt: to, co zapisano w projekcie, ma stać się na końcu dokładnie tym samym.",
  "NIE WYKONUJESZ i NIE SPISUJESZ MAPY — planowanie należy do Mózgu. Ty podpowiadasz dla ścisłości.",
  "Znasz błąd, więc wskazujesz, gdzie się rodzi. Każde znalezisko trafia do jednego kubełka:",
  "errors (jawny błąd), inconsistencies (niespójność), gaps (luka), tensions (napięcie), assumptions (założenie).",
  "Oznacz: cardinal (czy uderza w fundament), repairable (czy da się naprawić bez autora),",
  "needsAuthor (czy tylko autor rozstrzygnie), risk 0..1.",
  "Dostajesz PLAN CZYTANIA: czytaj źródło w tej kolejności. Szew (seam) to miejsce sprzeczności między sąsiadami.",
  "Odpowiadasz WYŁĄCZNIE jednym obiektem JSON, bez komentarza i bez bloku kodu:",
  '{"understanding": "<co rozumiesz przez ten projekt>",',
  ' "findings": [{"code": "<krótki kod>", "bucket": "errors|inconsistencies|gaps|tensions|assumptions",',
  '   "detail": "<na czym polega>", "cardinal": false, "repairable": true, "needsAuthor": false, "risk": 0.0,',
  '   "question": "<pytanie do autora, opcjonalne>"}],',
  ' "guidance": [{"subject": "<czego dotyczy>", "advice": "<wskazówka dla Mózgu>", "rationale": "<dlaczego tak>"}]}',
  "Nie zmyślaj treści, których nie ma w projekcie. Czego brakuje, to 'gaps' — nigdy domysł."
].join("\n");

function normalizeEndpoint(value: string): string {
  return value.replace(/\/+$/, "");
}

function text(value: unknown, code: string, max = 4000): string {
  const result = typeof value === "string" ? value.trim() : "";
  if (!result || result.length > max) throw new HarmoniaError(code, 502);
  return result;
}

/** Urwany ogon = czytanie niedomknięte (`stage_zero_gate.has_open_tail`). */
export function hasOpenTail(value: string): boolean {
  const text = String(value ?? "").trim();
  return text.endsWith("...") || text.endsWith("…");
}

/** Models often wrap JSON in prose or a fenced block; recover the object without guessing content. */
export function extractJsonObject(raw: string): Record<string, unknown> {
  const value = String(raw ?? "").trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(value);
  const candidate = fenced?.[1]?.trim() || value;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) throw new HarmoniaError("HARMONIA_RESPONSE_NOT_JSON", 502);
  let parsed: unknown;
  try { parsed = JSON.parse(candidate.slice(start, end + 1)); }
  catch { throw new HarmoniaError("HARMONIA_RESPONSE_NOT_JSON", 502); }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new HarmoniaError("HARMONIA_RESPONSE_NOT_JSON", 502);
  }
  return parsed as Record<string, unknown>;
}

/**
 * Brama Etapu 0. Kolejność jest istotna: kardynalny nienaprawialny problem ma
 * pierwszeństwo PRZED pauzą „jeszcze czytamy" — inaczej brama przepuszcza dalej coś,
 * co i tak musi wrócić do autora.
 */
export function decideStageZero(input: { sourceClosed: boolean; findings: HarmoniaFinding[] }): StageZeroDecision {
  if (input.findings.some((finding) => finding.cardinal && !finding.repairable)) {
    return { status: "deny", reason: "cardinal_issue", action: "need_author" };
  }
  if (!input.sourceClosed) {
    return { status: "pause", reason: "read_not_closed", action: "continue_reading" };
  }
  if (input.findings.some((finding) => finding.needsAuthor || (!finding.repairable && finding.risk >= 0.5))) {
    return { status: "pause", reason: "critical_tension", action: "author_or_repair" };
  }
  return { status: "allow", reason: "stage_zero_closed", action: "handoff_to_brain" };
}

function uniqueModels(primary: string, fallbacks: string[] | undefined): string[] {
  return [primary, ...(fallbacks ?? [])]
    .map((model) => model.trim())
    .filter(Boolean)
    .filter((model, index, all) => all.indexOf(model) === index);
}

/** 504/503/429/timeout/prose on one token must not close cognition — we have a chain. */
function isCapacityOrReadFailure(error: unknown): boolean {
  if (error instanceof HarmoniaError) {
    return /^(HARMONIA_HTTP_(429|502|503|504)|HARMONIA_RESPONSE_NOT_JSON|HARMONIA_RESPONSE_EMPTY|HARMONIA_UNDERSTANDING_REQUIRED|HARMONIA_FINDINGS_INVALID|HARMONIA_FINDING_BUCKET_INVALID|HARMONIA_FINDING_RISK_INVALID|HARMONIA_FINDING_CODE_REQUIRED|HARMONIA_FINDING_DETAIL_REQUIRED|HARMONIA_GUIDANCE_INVALID|HARMONIA_GUIDANCE_SUBJECT_REQUIRED|HARMONIA_GUIDANCE_ADVICE_REQUIRED|HARMONIA_GUIDANCE_RATIONALE_REQUIRED)$/.test(error.code);
  }
  if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) return true;
  if (error instanceof Error && /timeout|aborted/i.test(error.message)) return true;
  return false;
}

export class HarmoniaCognition {
  private readonly endpoint: string;
  private readonly apiKey: string | undefined;
  private readonly apiKeyEnv: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly fallbackModels: string[];

  constructor(private readonly options: HarmoniaOptions) {
    this.endpoint = normalizeEndpoint(options.endpoint ?? "http://127.0.0.1:20128/v1");
    this.apiKey = options.apiKey;
    this.apiKeyEnv = options.apiKeyEnv ?? "OMNIROUTE_API_KEY";
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 180_000;
    this.fallbackModels = uniqueModels("", options.fallbackModels);
  }

  private credential(): string {
    const key = this.apiKey ?? process.env[this.apiKeyEnv] ?? "";
    if (!key.trim()) throw new HarmoniaError("HARMONIA_AUTH_REQUIRED", 503);
    return key.trim();
  }

  async read(project: string): Promise<HarmoniaReading> {
    const source = String(project ?? "").trim();
    if (!source) throw new HarmoniaError("HARMONIA_PROJECT_REQUIRED", 400);

    // Chat-originated Etap 0 is a brief: edges-first when long, linear when it fits one segment.
    const readingPlan = firstReading(source, { kind: "brief" });
    const order = readingPlan.order.map((step) => `#${step.index}/${step.team}`).join(" ");
    const userContent = [
      `PLAN CZYTANIA: strategy=${readingPlan.strategy} sourceClosed=${readingPlan.sourceClosed} order=${order || "empty"} seams=${readingPlan.seams.length}`,
      "Czytaj źródło w tej kolejności. Szew (seam) to miejsce, w którym szukasz sprzeczności między sąsiadującymi segmentami.",
      `PROJEKT (całość, tak jak podał człowiek):\n\n${source}`
    ].join("\n\n");

    const chain = uniqueModels(this.options.model, this.fallbackModels);
    let lastError: unknown;
    for (const [index, model] of chain.entries()) {
      if (this.options.authorizeModel && !await this.options.authorizeModel(model)) {
        lastError = new HarmoniaError("FREE_ROUTE_DENIED", 403);
        continue;
      }
      try {
        return await this.readWithModel(source, readingPlan, userContent, model);
      } catch (error) {
        lastError = error;
        const last = index === chain.length - 1;
        if (last || !isCapacityOrReadFailure(error)) throw error;
      }
    }
    throw lastError instanceof Error ? lastError : new HarmoniaError("HARMONIA_HTTP_504", 502);
  }

  private async readWithModel(
    source: string,
    readingPlan: FirstReadingPlan,
    userContent: string,
    model: string
  ): Promise<HarmoniaReading> {
    const response = await this.fetchImpl(`${this.endpoint}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.credential()}` },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: userContent }
        ]
      }),
      signal: AbortSignal.timeout(this.timeoutMs)
    });
    if (response.status === 401 || response.status === 403) throw new HarmoniaError("HARMONIA_AUTH_REQUIRED", 503);
    if (!response.ok) throw new HarmoniaError(`HARMONIA_HTTP_${response.status}`, 502);

    const payload = await response.json().catch(() => {
      throw new HarmoniaError("HARMONIA_RESPONSE_NOT_JSON", 502);
    }) as { choices?: Array<{ message?: { content?: unknown } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new HarmoniaError("HARMONIA_RESPONSE_EMPTY", 502);

    const parsed = extractJsonObject(content);
    const findings = this.findings(parsed.findings);
    const sourceClosed = !hasOpenTail(source);
    return {
      understanding: text(parsed.understanding, "HARMONIA_UNDERSTANDING_REQUIRED"),
      findings,
      guidance: this.guidance(parsed.guidance),
      sourceClosed,
      readingPlan,
      decision: decideStageZero({ sourceClosed, findings }),
      model,
      readAt: new Date().toISOString()
    };
  }

  private findings(value: unknown): HarmoniaFinding[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw new HarmoniaError("HARMONIA_FINDINGS_INVALID", 502);
    return value.slice(0, 200).map((item) => {
      if (typeof item !== "object" || item === null) throw new HarmoniaError("HARMONIA_FINDINGS_INVALID", 502);
      const record = item as Record<string, unknown>;
      const bucket = String(record.bucket ?? "").trim() as FindingBucket;
      if (!BUCKETS.has(bucket)) throw new HarmoniaError("HARMONIA_FINDING_BUCKET_INVALID", 502);
      const risk = Number(record.risk ?? 0);
      if (!Number.isFinite(risk) || risk < 0 || risk > 1) throw new HarmoniaError("HARMONIA_FINDING_RISK_INVALID", 502);
      const question = typeof record.question === "string" ? record.question.trim() : "";
      const cardinal = record.cardinal === true;
      // Fail-closed: a cardinal finding with omitted repairable is unrepairable (DENY), not ALLOW.
      const repairable = cardinal ? record.repairable === true : record.repairable !== false;
      return {
        code: text(record.code, "HARMONIA_FINDING_CODE_REQUIRED", 120),
        bucket,
        detail: text(record.detail, "HARMONIA_FINDING_DETAIL_REQUIRED"),
        cardinal,
        repairable,
        needsAuthor: record.needsAuthor === true,
        risk,
        ...(question ? { question } : {})
      };
    });
  }

  private guidance(value: unknown): HarmoniaGuidance[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw new HarmoniaError("HARMONIA_GUIDANCE_INVALID", 502);
    return value.slice(0, 100).map((item) => {
      if (typeof item !== "object" || item === null) throw new HarmoniaError("HARMONIA_GUIDANCE_INVALID", 502);
      const record = item as Record<string, unknown>;
      return {
        subject: text(record.subject, "HARMONIA_GUIDANCE_SUBJECT_REQUIRED", 300),
        advice: text(record.advice, "HARMONIA_GUIDANCE_ADVICE_REQUIRED"),
        rationale: text(record.rationale, "HARMONIA_GUIDANCE_RATIONALE_REQUIRED")
      };
    });
  }
}
