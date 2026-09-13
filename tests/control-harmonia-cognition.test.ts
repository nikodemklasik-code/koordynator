import { describe, expect, it } from "vitest";
import {
  HarmoniaCognition,
  HarmoniaError,
  decideStageZero,
  hasOpenTail,
  type HarmoniaFinding,
  type HarmoniaReading
} from "../src/control/harmonia-cognition.js";
import { BrainRoadmapWriter, BrainError, type Roadmap } from "../src/control/brain-roadmap.js";

function gateway(content: string, status = 200): { fetchImpl: typeof fetch; bodies: unknown[] } {
  const bodies: unknown[] = [];
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body ?? "{}")));
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
      status, headers: { "content-type": "application/json" }
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, bodies };
}

function finding(over: Partial<HarmoniaFinding> = {}): HarmoniaFinding {
  return {
    code: "F1", bucket: "tensions", detail: "d",
    cardinal: false, repairable: true, needsAuthor: false, risk: 0, ...over
  };
}

/** Harmonia widzi całość i podpowiada; mapy nie pisze. */
const CLEAN = JSON.stringify({
  understanding: "Panel ma dostać tryb ciemny sterowany przełącznikiem.",
  findings: [
    { code: "A1", bucket: "assumptions", detail: "Zakładam brak zmian w API.", cardinal: false, repairable: true, needsAuthor: false, risk: 0.1 }
  ],
  guidance: [
    { subject: "tokeny", advice: "Najpierw wydziel paletę, potem sterowanie.", rationale: "Inaczej podwójna praca." },
    { subject: "zakres", advice: "Nie dotykaj logiki serwera.", rationale: "Tryb ciemny to warstwa prezentacji." }
  ]
});

describe("Etap 0 — brama poznania", () => {
  it("kardynalny nienaprawialny problem to DENY i ma pierwszeństwo przed pauzą czytania", () => {
    // Nawet przy niedomkniętym źródle: to i tak musi wrócić do autora.
    const decision = decideStageZero({
      sourceClosed: false,
      findings: [finding({ bucket: "errors", cardinal: true, repairable: false })]
    });
    expect(decision).toEqual({ status: "deny", reason: "cardinal_issue", action: "need_author" });
  });

  it("niedomknięte źródło pauzuje czytanie", () => {
    expect(decideStageZero({ sourceClosed: false, findings: [] }))
      .toEqual({ status: "pause", reason: "read_not_closed", action: "continue_reading" });
    expect(hasOpenTail("projekt urwany w pół zdania...")).toBe(true);
    expect(hasOpenTail("projekt domknięty.")).toBe(false);
  });

  it("napięcie wymagające autora pauzuje mimo domkniętego źródła", () => {
    expect(decideStageZero({ sourceClosed: true, findings: [finding({ needsAuthor: true })] }))
      .toEqual({ status: "pause", reason: "critical_tension", action: "author_or_repair" });
    // Nienaprawialne o wysokim ryzyku też.
    expect(decideStageZero({ sourceClosed: true, findings: [finding({ repairable: false, risk: 0.5 })] }).status)
      .toBe("pause");
    // Nienaprawialne, ale o niskim ryzyku — przechodzi.
    expect(decideStageZero({ sourceClosed: true, findings: [finding({ repairable: false, risk: 0.4 })] }).status)
      .toBe("allow");
  });

  it("domknięte i bez napięć przekazuje pracę Mózgowi", () => {
    expect(decideStageZero({ sourceClosed: true, findings: [finding({ bucket: "assumptions" })] }))
      .toEqual({ status: "allow", reason: "stage_zero_closed", action: "handoff_to_brain" });
  });
});

describe("Harmonia — samotne poznanie", () => {
  it("czyta cały projekt i zwraca rozumienie, znaleziska i wskazówki", async () => {
    const { fetchImpl, bodies } = gateway(CLEAN);
    const harmonia = new HarmoniaCognition({ apiKey: "k", model: "cc/claude-opus-4-8", fetchImpl });

    const reading: HarmoniaReading = await harmonia.read("Chcę tryb ciemny w panelu.");
    expect(reading.understanding).toContain("tryb ciemny");
    expect(reading.findings.map((item) => item.bucket)).toEqual(["assumptions"]);
    expect(reading.guidance.map((item) => item.subject)).toEqual(["tokeny", "zakres"]);
    expect(reading.decision.status).toBe("allow");
    expect(reading.readingPlan.strategy).toBe("linear");
    expect(reading.readingPlan.sourceClosed).toBe(true);

    // Jako jedyna dostaje całość projektu.
    const sent = bodies[0] as { messages: Array<{ role: string; content: string }> };
    expect(sent.messages.some((message) => message.content.includes("PLAN CZYTANIA"))).toBe(true);
    expect(sent.messages.some((message) => message.content.includes("Chcę tryb ciemny w panelu."))).toBe(true);

    // Nie ma ręki: czytanie nie niesie mapy.
    expect((reading as unknown as { milestones?: unknown }).milestones).toBeUndefined();
  });

  it("kardynalny finding bez repairable jest nienaprawialny — model nie może się sam przepuścić", async () => {
    const omitted = JSON.stringify({
      understanding: "u",
      findings: [{ code: "E1", bucket: "errors", detail: "Fundament pęknięty.", cardinal: true }],
      guidance: []
    });
    const { fetchImpl } = gateway(omitted);
    const reading = await new HarmoniaCognition({ apiKey: "k", model: "m", fetchImpl }).read("projekt");
    expect(reading.findings[0]!.repairable).toBe(false);
    expect(reading.decision).toEqual({ status: "deny", reason: "cardinal_issue", action: "need_author" });
  });

  it("kardynalna sprzeczność w projekcie daje DENY do autora", async () => {
    const cardinal = JSON.stringify({
      understanding: "u",
      findings: [{ code: "E1", bucket: "errors", detail: "Sprzeczny fundament.", cardinal: true, repairable: false, needsAuthor: true, risk: 0.9 }],
      guidance: []
    });
    const { fetchImpl } = gateway(cardinal);
    const reading = await new HarmoniaCognition({ apiKey: "k", model: "m", fetchImpl }).read("projekt");
    expect(reading.decision).toEqual({ status: "deny", reason: "cardinal_issue", action: "need_author" });
  });

  it("urwane źródło wstrzymuje poznanie zamiast udawać, że przeczytała całość", async () => {
    const { fetchImpl } = gateway(CLEAN);
    const reading = await new HarmoniaCognition({ apiKey: "k", model: "m", fetchImpl })
      .read("Projekt zaczyna się i urywa...");
    expect(reading.sourceClosed).toBe(false);
    expect(reading.decision.reason).toBe("read_not_closed");
  });

  it("odrzuca kubełek spoza kanonu i ryzyko spoza zakresu", async () => {
    for (const bad of [
      JSON.stringify({ understanding: "u", findings: [{ code: "c", bucket: "wymyslony", detail: "d" }], guidance: [] }),
      JSON.stringify({ understanding: "u", findings: [{ code: "c", bucket: "errors", detail: "d", risk: 7 }], guidance: [] })
    ]) {
      const { fetchImpl } = gateway(bad);
      await expect(new HarmoniaCognition({ apiKey: "k", model: "m", fetchImpl }).read("p"))
        .rejects.toThrow(HarmoniaError);
    }
  });

  it("nie zmyśla czytania, gdy model odpowiada prozą albo pada", async () => {
    const prose = gateway("Nie mogę tego ocenić bez dodatkowych informacji.");
    await expect(new HarmoniaCognition({ apiKey: "k", model: "m", fetchImpl: prose.fetchImpl }).read("p"))
      .rejects.toThrow(/HARMONIA_RESPONSE_NOT_JSON/);

    const failed = gateway("{}", 503);
    await expect(new HarmoniaCognition({ apiKey: "k", model: "m", fetchImpl: failed.fetchImpl }).read("p"))
      .rejects.toThrow(/HARMONIA_HTTP_503/);
  });

  it("504/503/429 nie zamyka poznania — skacze na kolejny model w łańcuchu tokenów", async () => {
    const models: string[] = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
      models.push(String(body.model ?? ""));
      if (body.model === "cc/claude-opus-5") {
        return new Response(JSON.stringify({ error: { message: "gateway timeout" } }), { status: 504 });
      }
      if (body.model === "cx/gpt-5.5") {
        return new Response(JSON.stringify({ error: { message: "overloaded" } }), { status: 503 });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: CLEAN } }] }), {
        status: 200, headers: { "content-type": "application/json" }
      });
    }) as unknown as typeof fetch;

    const reading = await new HarmoniaCognition({
      apiKey: "k",
      model: "cc/claude-opus-5",
      fallbackModels: ["cx/gpt-5.5", "gc/grok-4.6"],
      fetchImpl
    }).read("Chcę tryb ciemny w panelu.");

    expect(models).toEqual(["cc/claude-opus-5", "cx/gpt-5.5", "gc/grok-4.6"]);
    expect(reading.model).toBe("gc/grok-4.6");
    expect(reading.understanding).toContain("tryb ciemny");
    expect(reading.decision.status).toBe("allow");
  });

  it("timeout albo proza na pinie nie zamyka poznania, gdy następny model czyta", async () => {
    const models: string[] = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
      models.push(String(body.model ?? ""));
      if (body.model === "slow") {
        const error = new DOMException("The operation was aborted due to timeout", "TimeoutError");
        throw error;
      }
      if (body.model === "prose") {
        return new Response(JSON.stringify({ choices: [{ message: { content: "Nie umiem tego odczytać." } }] }), {
          status: 200, headers: { "content-type": "application/json" }
        });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: CLEAN } }] }), {
        status: 200, headers: { "content-type": "application/json" }
      });
    }) as unknown as typeof fetch;

    const reading = await new HarmoniaCognition({
      apiKey: "k",
      model: "slow",
      fallbackModels: ["prose", "gc/grok-4.6"],
      fetchImpl
    }).read("Chcę tryb ciemny w panelu.");

    expect(models).toEqual(["slow", "prose", "gc/grok-4.6"]);
    expect(reading.model).toBe("gc/grok-4.6");
    expect(reading.understanding).toContain("tryb ciemny");
  });

  it("wymaga rzeczywistego projektu zamiast czytać pustkę", async () => {
    const { fetchImpl } = gateway(CLEAN);
    await expect(new HarmoniaCognition({ apiKey: "k", model: "m", fetchImpl }).read("   "))
      .rejects.toThrow(/HARMONIA_PROJECT_REQUIRED/);
  });
});

const MAP = JSON.stringify({
  milestones: [
    { id: "M1", title: "Tokeny kolorów", intent: "Wydzielić paletę", modules: ["ui"], allowedPaths: ["web/**"], acceptanceCriteria: ["paleta w jednym miejscu", "brak zmian wizualnych"], dependsOn: [] },
    { id: "M2", title: "Przełącznik", intent: "Dodać sterowanie", modules: ["ui"], allowedPaths: ["web/**"], acceptanceCriteria: ["przełącznik działa"], dependsOn: ["M1"] }
  ]
});

async function readingWith(content: string): Promise<HarmoniaReading> {
  const { fetchImpl } = gateway(content);
  return new HarmoniaCognition({ apiKey: "k", model: "m", fetchImpl }).read("Chcę tryb ciemny w panelu.");
}

describe("Mózg — ręka spisująca mapę", () => {
  it("spisuje kamienie i niesie wskazówki Harmonii do promptu", async () => {
    const { fetchImpl, bodies } = gateway(MAP);
    const brain = new BrainRoadmapWriter({ apiKey: "k", model: "m", fetchImpl });

    const roadmap: Roadmap = await brain.write("Chcę tryb ciemny w panelu.", await readingWith(CLEAN));
    expect(roadmap.milestones.map((item) => item.id)).toEqual(["M1", "M2"]);
    expect(roadmap.milestones[1]!.dependsOn).toEqual(["M1"]);
    expect(roadmap.writtenBy).toBe("brain");

    const sent = bodies[0] as { messages: Array<{ role: string; content: string }> };
    const text = sent.messages.map((message) => message.content).join("\n");
    expect(text).toContain("Najpierw wydziel paletę");
    expect(text).toContain("Nie dotykaj logiki serwera");
  });

  it("nie rusza, dopóki brama Etapu 0 nie przepuści", async () => {
    const denied = await readingWith(JSON.stringify({
      understanding: "u",
      findings: [{ code: "E1", bucket: "errors", detail: "d", cardinal: true, repairable: false }],
      guidance: []
    }));
    const { fetchImpl } = gateway(MAP);
    await expect(new BrainRoadmapWriter({ apiKey: "k", model: "m", fetchImpl }).write("projekt", denied))
      .rejects.toThrow(/BRAIN_STAGE_ZERO_CARDINAL_ISSUE/);

    const paused = await readingWith(JSON.stringify({
      understanding: "u",
      findings: [{ code: "T1", bucket: "tensions", detail: "d", needsAuthor: true }],
      guidance: []
    }));
    const second = gateway(MAP);
    await expect(new BrainRoadmapWriter({ apiKey: "k", model: "m", fetchImpl: second.fetchImpl }).write("projekt", paused))
      .rejects.toThrow(/BRAIN_STAGE_ZERO_CRITICAL_TENSION/);
  });

  it("odrzuca mapę bez kamieni, zakresu albo kryteriów akceptacji", async () => {
    const clean = await readingWith(CLEAN);
    for (const bad of [
      JSON.stringify({ milestones: [] }),
      JSON.stringify({ milestones: [{ id: "M1", title: "t", intent: "i", modules: ["m"], allowedPaths: ["src/**"], acceptanceCriteria: [], dependsOn: [] }] }),
      JSON.stringify({ milestones: [{ id: "M1", title: "t", intent: "i", modules: [], allowedPaths: ["src/**"], acceptanceCriteria: ["a"], dependsOn: [] }] }),
      JSON.stringify({ milestones: [{ id: "M1", title: "t", intent: "i", modules: ["m"], allowedPaths: [], acceptanceCriteria: ["a"], dependsOn: [] }] })
    ]) {
      const { fetchImpl } = gateway(bad);
      await expect(new BrainRoadmapWriter({ apiKey: "k", model: "m", fetchImpl }).write("projekt", clean))
        .rejects.toThrow(BrainError);
    }
  });

  it("odrzuca zależność do nieznanego kamienia — mapa nigdy nie jest źródłem błędu", async () => {
    const clean = await readingWith(CLEAN);
    const broken = JSON.stringify({
      milestones: [{ id: "M1", title: "t", intent: "i", modules: ["m"], allowedPaths: ["src/**"], acceptanceCriteria: ["a"], dependsOn: ["M9"] }]
    });
    const { fetchImpl } = gateway(broken);
    await expect(new BrainRoadmapWriter({ apiKey: "k", model: "m", fetchImpl }).write("projekt", clean))
      .rejects.toThrow(/BRAIN_MILESTONE_DEPENDENCY_UNKNOWN/);
  });
});
