/**
 * Mózg nadrzędny — RĘKA ustroju.
 *
 * Nie myśli mapy i nie ocenia projektu: spisuje mapę drogową, którą ustanowiła wola Harmonii,
 * korzystając z jej wskazówek dla ścisłości. Sam nie wchłania filozofii projektu — dostaje
 * zadanie zapisu i granice, w których ma się zmieścić.
 *
 * Gdy czytanie Harmonii jest blokujące (sprzeczność albo luka), ręka nie rusza: nie ma czego
 * wiernie zapisać, dopóki autor nie rozstrzygnie.
 */

import { extractJsonObject, type HarmoniaReading } from "./harmonia-cognition.js";

export type Milestone = {
  id: string;
  title: string;
  intent: string;
  modules: string[];
  allowedPaths: string[];
  acceptanceCriteria: string[];
  dependsOn: string[];
};

export type Roadmap = {
  milestones: Milestone[];
  writtenBy: "brain";
  basedOn: { understanding: string; model: string; readAt: string };
  writtenAt: string;
};

export class BrainError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
    this.name = "BrainError";
  }
}

export type BrainOptions = {
  endpoint?: string;
  apiKey?: string;
  apiKeyEnv?: string;
  model: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

const SYSTEM = [
  "Jesteś Mózgiem nadrzędnym: ręką ustroju. Spisujesz mapę drogową, której wolę ustanowiła Harmonia.",
  "Nie oceniasz projektu i nie dodajesz własnej filozofii. Zapisujesz wiernie to, co wynika ze wskazówek.",
  "Kamień milowy ma być tak szczegółowy, by wykonawca odtwarzał, a nie wymyślał.",
  "Każdy kamień musi mieć: moduły, dozwolone ścieżki i kryteria akceptacji sprawdzalne po wykonaniu.",
  "Zależności wskazuj wyłącznie na kamienie z tej samej mapy.",
  "Odpowiadasz WYŁĄCZNIE jednym obiektem JSON, bez komentarza i bez bloku kodu:",
  '{"milestones": [{"id": "M1", "title": "<krótko>", "intent": "<co ma powstać>",',
  ' "modules": ["<moduł>"], "allowedPaths": ["<ścieżka/**>"],',
  ' "acceptanceCriteria": ["<sprawdzalne kryterium>"], "dependsOn": []}]}'
].join("\n");

function normalizeEndpoint(value: string): string {
  return value.replace(/\/+$/, "");
}

function text(value: unknown, code: string, max = 2000): string {
  const result = typeof value === "string" ? value.trim() : "";
  if (!result || result.length > max) throw new BrainError(code, 502);
  return result;
}

function list(value: unknown, code: string): string[] {
  if (!Array.isArray(value)) throw new BrainError(code, 502);
  const items = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .slice(0, 40);
  if (items.length === 0) throw new BrainError(code, 502);
  return [...new Set(items)];
}

export class BrainRoadmapWriter {
  private readonly endpoint: string;
  private readonly apiKey: string | undefined;
  private readonly apiKeyEnv: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: BrainOptions) {
    this.endpoint = normalizeEndpoint(options.endpoint ?? "http://127.0.0.1:20128/v1");
    this.apiKey = options.apiKey;
    this.apiKeyEnv = options.apiKeyEnv ?? "OMNIROUTE_API_KEY";
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 180_000;
  }

  private credential(): string {
    const key = this.apiKey ?? process.env[this.apiKeyEnv] ?? "";
    if (!key.trim()) throw new BrainError("BRAIN_AUTH_REQUIRED", 503);
    return key.trim();
  }

  async write(project: string, reading: HarmoniaReading): Promise<Roadmap> {
    const source = String(project ?? "").trim();
    if (!source) throw new BrainError("BRAIN_PROJECT_REQUIRED", 400);
    // Brama Etapu 0: ręka nie rusza, dopóki poznanie nie jest domknięte.
    // DENY wraca do autora, PAUSE czeka na domknięcie źródła albo rozstrzygnięcie napięcia.
    if (reading.decision.status !== "allow") {
      throw new BrainError(`BRAIN_STAGE_ZERO_${reading.decision.reason.toUpperCase()}`, 409);
    }

    const guidance = reading.guidance
      .map((item) => `- [${item.subject}] ${item.advice} (bo: ${item.rationale})`)
      .join("\n") || "- (brak dodatkowych wskazówek)";
    const openQuestions = reading.findings
      .filter((finding) => finding.question)
      .map((finding) => `- ${finding.code} (${finding.bucket}): ${finding.question}`)
      .join("\n");

    const response = await this.fetchImpl(`${this.endpoint}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.credential()}` },
      body: JSON.stringify({
        model: this.options.model,
        temperature: 0,
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: [
              `PROJEKT:\n${source}`,
              `\nCO USTALIŁA HARMONIA:\n${reading.understanding}`,
              `\nWSKAZÓWKI HARMONII (wiążące dla kolejności i zakresu):\n${guidance}`,
              openQuestions ? `\nNIEROZSTRZYGNIĘTE (nie zgaduj, zostaw poza zakresem):\n${openQuestions}` : "",
              "\nSpisz mapę drogową."
            ].join("\n")
          }
        ]
      }),
      signal: AbortSignal.timeout(this.timeoutMs)
    });
    if (!response.ok) throw new BrainError(`BRAIN_HTTP_${response.status}`, 502);

    const payload = await response.json().catch(() => {
      throw new BrainError("BRAIN_RESPONSE_NOT_JSON", 502);
    }) as { choices?: Array<{ message?: { content?: unknown } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new BrainError("BRAIN_RESPONSE_EMPTY", 502);

    let parsed: Record<string, unknown>;
    try { parsed = extractJsonObject(content); }
    catch { throw new BrainError("BRAIN_RESPONSE_NOT_JSON", 502); }

    return {
      milestones: this.milestones(parsed.milestones),
      writtenBy: "brain",
      basedOn: { understanding: reading.understanding, model: reading.model, readAt: reading.readAt },
      writtenAt: new Date().toISOString()
    };
  }

  private milestones(value: unknown): Milestone[] {
    if (!Array.isArray(value) || value.length === 0) throw new BrainError("BRAIN_MILESTONES_REQUIRED", 502);
    const milestones = value.slice(0, 60).map((item) => {
      if (typeof item !== "object" || item === null) throw new BrainError("BRAIN_MILESTONE_INVALID", 502);
      const record = item as Record<string, unknown>;
      const dependsOn = Array.isArray(record.dependsOn)
        ? record.dependsOn.map((entry) => (typeof entry === "string" ? entry.trim() : "")).filter(Boolean)
        : [];
      return {
        id: text(record.id, "BRAIN_MILESTONE_ID_REQUIRED", 40),
        title: text(record.title, "BRAIN_MILESTONE_TITLE_REQUIRED", 200),
        intent: text(record.intent, "BRAIN_MILESTONE_INTENT_REQUIRED"),
        modules: list(record.modules, "BRAIN_MILESTONE_MODULES_REQUIRED"),
        allowedPaths: this.paths(record.allowedPaths),
        acceptanceCriteria: list(record.acceptanceCriteria, "BRAIN_MILESTONE_CRITERIA_REQUIRED"),
        dependsOn: [...new Set(dependsOn)]
      };
    });

    const ids = new Set(milestones.map((milestone) => milestone.id));
    if (ids.size !== milestones.length) throw new BrainError("BRAIN_MILESTONE_ID_DUPLICATE", 502);
    for (const milestone of milestones) {
      for (const dependency of milestone.dependsOn) {
        // The map may never be the source of error: a dangling dependency is caught here.
        if (!ids.has(dependency)) throw new BrainError("BRAIN_MILESTONE_DEPENDENCY_UNKNOWN", 502);
        if (dependency === milestone.id) throw new BrainError("BRAIN_MILESTONE_DEPENDENCY_SELF", 502);
      }
    }
    return milestones;
  }

  private paths(value: unknown): string[] {
    const paths = list(value, "BRAIN_MILESTONE_PATHS_REQUIRED");
    for (const path of paths) {
      if (path.startsWith("/") || path.includes("..") || /[\u0000-\u001f]/.test(path)) {
        throw new BrainError("BRAIN_MILESTONE_PATH_INVALID", 502);
      }
    }
    return paths;
  }
}
