import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createControlServer } from "../src/control/server.js";
import { sessionToProject, stageZeroScope } from "../src/control/stage-zero-service.js";
import type { ChatSession } from "../src/control/chat-service.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const CLEAN = JSON.stringify({
  understanding: "Panel ma dostać tryb ciemny sterowany przełącznikiem.",
  findings: [
    { code: "A1", bucket: "assumptions", detail: "Zakładam brak zmian w API.", cardinal: false, repairable: true, needsAuthor: false, risk: 0.1 }
  ],
  guidance: [
    { subject: "tokeny", advice: "Najpierw wydziel paletę, potem sterowanie.", rationale: "Inaczej podwójna praca." }
  ]
});

const MAP = JSON.stringify({
  milestones: [
    { id: "M1", title: "Tokeny kolorów", intent: "Wydzielić paletę", modules: ["ui"], allowedPaths: ["web/**"], acceptanceCriteria: ["paleta w jednym miejscu"], dependsOn: [] },
    { id: "M2", title: "Przełącznik", intent: "Dodać sterowanie", modules: ["ui"], allowedPaths: ["web/**"], acceptanceCriteria: ["przełącznik działa"], dependsOn: ["M1"] }
  ]
});

const CARDINAL = JSON.stringify({
  understanding: "Sprzeczny fundament.",
  findings: [{ code: "E1", bucket: "errors", detail: "Cel niemożliwy.", cardinal: true, repairable: false, needsAuthor: true, risk: 0.9 }],
  guidance: []
});

function gateway(contents: string[]): { fetchImpl: typeof fetch; bodies: unknown[] } {
  const bodies: unknown[] = [];
  let index = 0;
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body ?? "{}")));
    const content = contents[Math.min(index, contents.length - 1)] ?? "{}";
    index += 1;
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
      status: 200, headers: { "content-type": "application/json" }
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, bodies };
}

async function seedSession(root: string, over: Partial<ChatSession> & { messages: ChatSession["messages"] }): Promise<ChatSession> {
  const session: ChatSession = {
    sessionId: over.sessionId ?? randomUUID(),
    createdAt: over.createdAt ?? "2026-09-11T10:00:00.000Z",
    updatedAt: over.updatedAt ?? "2026-09-11T10:00:00.000Z",
    model: over.model ?? "cc/claude-opus-4-8",
    messages: over.messages
  };
  const dir = join(root, "chat");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${session.sessionId}.json`), `${JSON.stringify(session, null, 2)}\n`, "utf8");
  return session;
}

function message(role: "user" | "assistant", content: string, extra: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    sessionId: "pending",
    role,
    content,
    createdAt: "2026-09-11T10:00:00.000Z",
    state: "complete" as const,
    ...extra
  };
}

async function listen(options: Parameters<typeof createControlServer>[0]) {
  const server = createControlServer(options);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("NO_ADDR");
  return {
    base: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.close();
      if (server.listening) await once(server, "close");
    }
  };
}

describe("sessionToProject", () => {
  it("składa transkrypt user/assistant i załączniki, pomija error i streaming", () => {
    const session = {
      sessionId: "s", createdAt: "", updatedAt: "", model: "m",
      messages: [
        message("user", "Chcę tryb ciemny.", {
          attachments: [{ id: "a", name: "brief.txt", mimeType: "text/plain", size: 4, dataUrl: "data:text/plain;base64,YQ==", extractedText: "Paleta: grafit." }]
        }),
        message("assistant", "Rozumiem.", { state: "streaming" }),
        message("assistant", "Błąd sieci.", { state: "error" }),
        message("assistant", "Mogę to rozplanować.")
      ]
    } as ChatSession;
    const project = sessionToProject(session);
    expect(project).toContain("Użytkownik:");
    expect(project).toContain("Chcę tryb ciemny.");
    expect(project).toContain("Paleta: grafit.");
    expect(project).toContain("Koordynator:");
    expect(project).toContain("Mogę to rozplanować.");
  });

  it("ogranicza poznanie do wybranego zakresu wiadomości (fromIndex..toIndex włącznie)", () => {
    const session = {
      sessionId: "s", createdAt: "", updatedAt: "", model: "m",
      messages: [
        message("user", "Pierwsza sprawa."),
        message("assistant", "Odpowiedź do pierwszej."),
        message("user", "Druga sprawa — to chcę w poznaniu."),
        message("assistant", "Odpowiedź do drugiej.")
      ]
    } as ChatSession;
    // Only messages 2..3 (0-based, inclusive) enter cognition.
    const project = sessionToProject(session, { fromIndex: 2, toIndex: 3 });
    expect(project).toContain("Druga sprawa");
    expect(project).toContain("Odpowiedź do drugiej.");
    expect(project).not.toContain("Pierwsza sprawa");
    expect(project).not.toContain("Odpowiedź do pierwszej.");
  });

  it("stageZeroScope raportuje ile wiadomości i załączników wejdzie (dla UI zakresu)", () => {
    const session = {
      sessionId: "s", createdAt: "", updatedAt: "", model: "m",
      messages: [
        message("user", "A", { attachments: [{ id: "a", name: "f.txt", mimeType: "text/plain", size: 1, dataUrl: "data:text/plain;base64,YQ==", extractedText: "x" }] }),
        message("assistant", "B", { state: "streaming" }),
        message("assistant", "C")
      ]
    } as ChatSession;
    const scope = stageZeroScope(session);
    expect(scope.messageCount).toBe(2); // streaming excluded
    expect(scope.attachmentCount).toBe(1);
    expect(scope.total).toBe(3);
  });
});

describe("Etap 0 zasilany z chatu", () => {
  it("czyta transkrypt sesji, a nie pole project z body, i spisuje mapę po ALLOW", async () => {
    const root = await mkdtemp(join(tmpdir(), "stage-zero-allow-"));
    roots.push(root);
    const seeded = await seedSession(root, {
      messages: [
        { ...message("user", "Chcę tryb ciemny w panelu."), sessionId: "x" },
        { ...message("assistant", "Mogę to rozplanować bez ruszania API."), sessionId: "x" }
      ]
    });
    const { fetchImpl, bodies } = gateway([CLEAN, MAP]);
    const { base, close } = await listen({
      stateDir: root,
      webRoot: resolve("web/control"),
      chatApiKey: "test-key",
      chatFetchImpl: fetchImpl
    });
    try {
      const created = await fetch(`${base}/api/chat/sessions/${seeded.sessionId}/stage-zero`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ project: "TEN TEKST NIE MA TRAFIĆ DO HARMONII" })
      });
      expect(created.status).toBe(400);
      expect(await created.json()).toEqual({ error: "CHAT_UNKNOWN_FIELD" });

      const run = await fetch(`${base}/api/chat/sessions/${seeded.sessionId}/stage-zero`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}"
      });
      expect(run.status).toBe(200);
      const payload = await run.json() as {
        source: string;
        reading: { understanding: string; decision: { status: string } };
        roadmap: { milestones: Array<{ id: string }>; writtenBy: string } | null;
      };
      expect(payload.source).toBe("chat");
      expect(payload.reading.understanding).toContain("tryb ciemny");
      expect(payload.reading.decision.status).toBe("allow");
      expect(payload.roadmap?.writtenBy).toBe("brain");
      expect(payload.roadmap?.milestones.map((item) => item.id)).toEqual(["M1", "M2"]);

      const sent = bodies.map((body) => JSON.stringify(body)).join("\n");
      expect(sent).toContain("Chcę tryb ciemny w panelu.");
      expect(sent).toContain("Użytkownik:");
      expect(sent).not.toContain("TEN TEKST NIE MA TRAFIĆ DO HARMONII");
      expect(bodies).toHaveLength(2);

      const stored = JSON.parse(await readFile(join(root, "stage-zero", `${seeded.sessionId}.json`), "utf8")) as { source: string };
      expect(stored.source).toBe("chat");

      const again = await fetch(`${base}/api/chat/sessions/${seeded.sessionId}/stage-zero`);
      expect(again.status).toBe(200);
      expect((await again.json() as { reading: { understanding: string } }).reading.understanding).toContain("tryb ciemny");
    } finally {
      await close();
    }
  });

  it("GET ?scope=1 raportuje zakres, a POST z range zawęża poznanie do fragmentu (podpięcie=akcja)", async () => {
    const root = await mkdtemp(join(tmpdir(), "stage-zero-range-"));
    roots.push(root);
    const seeded = await seedSession(root, {
      messages: [
        { ...message("user", "Pierwsza sprawa nieistotna."), sessionId: "x" },
        { ...message("assistant", "Odpowiedź pierwsza."), sessionId: "x" },
        { ...message("user", "Chcę tryb ciemny w panelu."), sessionId: "x" },
        { ...message("assistant", "Mogę to rozplanować bez ruszania API."), sessionId: "x" }
      ]
    });
    const { fetchImpl, bodies } = gateway([CLEAN, MAP]);
    const { base, close } = await listen({ stateDir: root, webRoot: resolve("web/control"), chatApiKey: "k", chatFetchImpl: fetchImpl });
    try {
      // Scope preview: whole session is 4 messages.
      const scopeAll = await fetch(`${base}/api/chat/sessions/${seeded.sessionId}/stage-zero?scope=1`);
      expect(scopeAll.status).toBe(200);
      expect((await scopeAll.json() as { messageCount: number }).messageCount).toBe(4);
      // Scope preview for a fragment (messages 2..3).
      const scopeFrag = await fetch(`${base}/api/chat/sessions/${seeded.sessionId}/stage-zero?scope=1&from=2&to=3`);
      expect((await scopeFrag.json() as { messageCount: number }).messageCount).toBe(2);

      // Run only the fragment: Harmonia must NOT see the first, irrelevant message.
      const run = await fetch(`${base}/api/chat/sessions/${seeded.sessionId}/stage-zero`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ range: { fromIndex: 2, toIndex: 3 } })
      });
      expect(run.status).toBe(200);
      const sent = bodies.map((b) => JSON.stringify(b)).join("\n");
      expect(sent).toContain("tryb ciemny");
      expect(sent).not.toContain("Pierwsza sprawa nieistotna");
    } finally {
      await close();
    }
  });

  it("przy DENY nie woła Mózgu — mapa nie powstaje", async () => {
    const root = await mkdtemp(join(tmpdir(), "stage-zero-deny-"));
    roots.push(root);
    const seeded = await seedSession(root, {
      messages: [{ ...message("user", "Zrób A i jednocześnie nigdy nie rób A."), sessionId: "x" }]
    });
    const { fetchImpl, bodies } = gateway([CARDINAL, MAP]);
    const { base, close } = await listen({
      stateDir: root, webRoot: resolve("web/control"), chatApiKey: "k", chatFetchImpl: fetchImpl
    });
    try {
      const run = await fetch(`${base}/api/chat/sessions/${seeded.sessionId}/stage-zero`, {
        method: "POST", headers: { "content-type": "application/json" }, body: "{}"
      });
      expect(run.status).toBe(200);
      const payload = await run.json() as { reading: { decision: { status: string; reason: string } }; roadmap: unknown };
      expect(payload.reading.decision).toEqual({ status: "deny", reason: "cardinal_issue", action: "need_author" });
      expect(payload.roadmap).toBeNull();
      expect(bodies).toHaveLength(1);
    } finally {
      await close();
    }
  });

  it("przy PAUSE (urwany ogon) nie woła Mózgu", async () => {
    const root = await mkdtemp(join(tmpdir(), "stage-zero-pause-"));
    roots.push(root);
    const seeded = await seedSession(root, {
      messages: [{ ...message("user", "Projekt zaczyna się i urywa..."), sessionId: "x" }]
    });
    const { fetchImpl, bodies } = gateway([CLEAN, MAP]);
    const { base, close } = await listen({
      stateDir: root, webRoot: resolve("web/control"), chatApiKey: "k", chatFetchImpl: fetchImpl
    });
    try {
      const run = await fetch(`${base}/api/chat/sessions/${seeded.sessionId}/stage-zero`, {
        method: "POST", headers: { "content-type": "application/json" }, body: "{}"
      });
      expect(run.status).toBe(200);
      const payload = await run.json() as { reading: { decision: { status: string; reason: string } }; roadmap: unknown };
      expect(payload.reading.decision.status).toBe("pause");
      expect(payload.reading.decision.reason).toBe("read_not_closed");
      expect(payload.roadmap).toBeNull();
      expect(bodies).toHaveLength(1);
    } finally {
      await close();
    }
  });

  it("pusta sesja to NEEDS_INPUT, brak sesji 404, streaming 409", async () => {
    const root = await mkdtemp(join(tmpdir(), "stage-zero-empty-"));
    roots.push(root);
    const empty = await seedSession(root, { messages: [] });
    const busy = await seedSession(root, {
      messages: [{ ...message("assistant", "piszę…", { state: "streaming" }), sessionId: "x" }]
    });
    const { fetchImpl } = gateway([CLEAN]);
    const { base, close } = await listen({
      stateDir: root, webRoot: resolve("web/control"), chatApiKey: "k", chatFetchImpl: fetchImpl
    });
    try {
      const needs = await fetch(`${base}/api/chat/sessions/${empty.sessionId}/stage-zero`, {
        method: "POST", headers: { "content-type": "application/json" }, body: "{}"
      });
      expect(needs.status).toBe(400);
      expect(await needs.json()).toEqual({ error: "STAGE_ZERO_NEEDS_INPUT" });

      const missing = await fetch(`${base}/api/chat/sessions/${randomUUID()}/stage-zero`, {
        method: "POST", headers: { "content-type": "application/json" }, body: "{}"
      });
      expect(missing.status).toBe(404);

      const locked = await fetch(`${base}/api/chat/sessions/${busy.sessionId}/stage-zero`, {
        method: "POST", headers: { "content-type": "application/json" }, body: "{}"
      });
      expect(locked.status).toBe(409);
      expect(await locked.json()).toEqual({ error: "STAGE_ZERO_CHAT_BUSY" });

      const never = await fetch(`${base}/api/chat/sessions/${empty.sessionId}/stage-zero`);
      expect(never.status).toBe(404);
      expect(await never.json()).toEqual({ error: "STAGE_ZERO_NOT_RUN" });
    } finally {
      await close();
    }
  });

  it("504 na pinie Harmonii nie zamyka Etapu 0 — poznanie idzie na fallback tokenów", async () => {
    const root = await mkdtemp(join(tmpdir(), "stage-zero-504-fallback-"));
    roots.push(root);
    const seeded = await seedSession(root, {
      model: "gc/grok-4.6",
      messages: [
        { ...message("user", "Chcę tryb ciemny w panelu."), sessionId: "x" },
        { ...message("assistant", "Mogę to rozplanować bez ruszania API."), sessionId: "x" }
      ]
    });
    const models: string[] = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
      models.push(String(body.model ?? ""));
      if (body.model === "cc/claude-opus-5") {
        return new Response(JSON.stringify({ error: { message: "gateway timeout" } }), { status: 504 });
      }
      const content = models.filter((model) => model === "gc/grok-4.6").length === 1 ? CLEAN : MAP;
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
        status: 200, headers: { "content-type": "application/json" }
      });
    }) as unknown as typeof fetch;
    const { base, close } = await listen({
      stateDir: root,
      webRoot: resolve("web/control"),
      chatApiKey: "k",
      chatFetchImpl: fetchImpl,
      chatHarmoniaModel: "cc/claude-opus-5",
      chatFallbackModels: ["gc/grok-4.6"]
    });
    try {
      const run = await fetch(`${base}/api/chat/sessions/${seeded.sessionId}/stage-zero`, {
        method: "POST", headers: { "content-type": "application/json" }, body: "{}"
      });
      expect(run.status).toBe(200);
      const payload = await run.json() as { reading: { model: string; understanding: string; decision: { status: string } }; roadmap: { writtenBy: string } | null };
      expect(payload.reading.model).toBe("gc/grok-4.6");
      expect(payload.reading.understanding).toContain("tryb ciemny");
      expect(payload.reading.decision.status).toBe("allow");
      expect(payload.roadmap?.writtenBy).toBe("brain");
      expect(models[0]).toBe("cc/claude-opus-5");
      expect(models).toContain("gc/grok-4.6");
    } finally {
      await close();
    }
  });

  it("Harmonia czyta na pinie KOORDYNATOR_HARMONIA_MODEL, Mózg spisuje na modelu sesji", async () => {
    const root = await mkdtemp(join(tmpdir(), "stage-zero-harmonia-model-"));
    roots.push(root);
    const seeded = await seedSession(root, {
      model: "gc/grok-4.6",
      messages: [
        { ...message("user", "Chcę tryb ciemny w panelu."), sessionId: "x" },
        { ...message("assistant", "Mogę to rozplanować bez ruszania API."), sessionId: "x" }
      ]
    });
    const { fetchImpl, bodies } = gateway([CLEAN, MAP]);
    const { base, close } = await listen({
      stateDir: root,
      webRoot: resolve("web/control"),
      chatApiKey: "test-key",
      chatFetchImpl: fetchImpl,
      chatHarmoniaModel: "cx/gpt-5.6-sol"
    });
    try {
      const run = await fetch(`${base}/api/chat/sessions/${seeded.sessionId}/stage-zero`, {
        method: "POST", headers: { "content-type": "application/json" }, body: "{}"
      });
      expect(run.status).toBe(200);
      const payload = await run.json() as { reading: { model: string }; roadmap: { writtenBy: string } | null };
      expect(payload.reading.model).toBe("cx/gpt-5.6-sol");
      expect(payload.roadmap?.writtenBy).toBe("brain");
      expect(bodies).toHaveLength(2);
      expect((bodies[0] as { model: string }).model).toBe("cx/gpt-5.6-sol");
      expect((bodies[1] as { model: string }).model).toBe("gc/grok-4.6");
    } finally {
      await close();
    }
  });

  it("bez pinu Harmonii oba wywołania jadą na modelu sesji", async () => {
    const root = await mkdtemp(join(tmpdir(), "stage-zero-session-model-"));
    roots.push(root);
    const seeded = await seedSession(root, {
      model: "gc/grok-4.6",
      messages: [
        { ...message("user", "Chcę tryb ciemny w panelu."), sessionId: "x" },
        { ...message("assistant", "Mogę to rozplanować bez ruszania API."), sessionId: "x" }
      ]
    });
    const { fetchImpl, bodies } = gateway([CLEAN, MAP]);
    const { base, close } = await listen({
      stateDir: root,
      webRoot: resolve("web/control"),
      chatApiKey: "test-key",
      chatFetchImpl: fetchImpl
    });
    try {
      const run = await fetch(`${base}/api/chat/sessions/${seeded.sessionId}/stage-zero`, {
        method: "POST", headers: { "content-type": "application/json" }, body: "{}"
      });
      expect(run.status).toBe(200);
      const payload = await run.json() as { reading: { model: string } };
      expect(payload.reading.model).toBe("gc/grok-4.6");
      expect(bodies).toHaveLength(2);
      expect((bodies[0] as { model: string }).model).toBe("gc/grok-4.6");
      expect((bodies[1] as { model: string }).model).toBe("gc/grok-4.6");
    } finally {
      await close();
    }
  });

  it("serwuje przycisk Etapu 0 w Live Chat", async () => {
    const root = await mkdtemp(join(tmpdir(), "stage-zero-ui-"));
    roots.push(root);
    const { base, close } = await listen({ stateDir: root, webRoot: resolve("web/control") });
    try {
      const page = await fetch(`${base}/chat`).then((item) => item.text());
      expect(page).toContain('id="stageZeroButton"');
      expect(page).toContain('id="stageZeroNotice"');
      expect(page).toContain('id="stageZeroDialog"');
      expect(page).toContain('id="stageZeroRangeList"');
      expect(page).toContain('id="stageZeroScopePreview"');
      expect(page).toContain('id="stageZeroRunButton"');
      expect(page).toContain('id="stageZeroFrom"');
      expect(page).toContain('id="stageZeroTo"');
      const js = await fetch(`${base}/chat.js`).then((item) => item.text());
      expect(js).toContain("/stage-zero");
      expect(js).toContain("openStageZeroDialog");
      expect(js).toContain("runStageZero");
      expect(js).toContain("searchParams.set(\"scope\", \"1\")");
      expect(js).toContain("fromIndex");
      expect(js).toContain("toIndex");
      expect(js).toContain("fontSize: 15");
      expect(js).toContain("colorizeHermesOutput");
      expect(js).toContain("▶");
      expect(js).toContain("◀");
      const css = await fetch(`${base}/chat.css`).then((item) => item.text());
      expect(css).toContain(".stage-zero-range-list");
      expect(css).toContain(".stage-zero-dialog");
      expect(css).toContain("font-size:15px");
    } finally {
      await close();
    }
  });
});
