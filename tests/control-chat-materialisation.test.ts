import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createControlServer } from "../src/control/server.js";
import { detectProjectConsensus } from "../src/control/chat-consensus.js";
import { verifySignedWorkOrder, type SignedWorkOrder } from "../src/security/work-order-signature.js";
import { validateWorkOrder } from "../src/domain/work-order.js";

const roots: string[] = [];
// The control server may still be flushing session files; a single rm races with ENOTEMPTY.
async function removeRoot(root: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try { await rm(root, { recursive: true, force: true }); return; }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOTEMPTY" && code !== "EBUSY") throw error;
      await new Promise((done) => setTimeout(done, 25 * (attempt + 1)));
    }
  }
  await rm(root, { recursive: true, force: true });
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => removeRoot(root)));
});

function keys() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return { privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(), publicKey };
}

const PLAN = "Proponuję endpoint /api/reports/export.\n\nPLAN UZGODNIONY\nCel: Dodać eksport CSV raportów\nModuły: reports\nŚcieżki: src/reports/**\nKryteria akceptacji:\n- eksport zwraca poprawny CSV\n- test pokrywa pusty raport";

const FREE_MODEL = "auto/best-free";
// Strict billing provenance blocks UNKNOWN models, so the chat-flow test needs a confirmed-free route.
const freeCatalog = {
  models: [FREE_MODEL],
  source: "OMNIROUTE" as const,
  checkedAt: "2026-09-11T10:00:00.000Z",
  billing: {
    liveChatTransport: "OMNIROUTE_API" as const,
    subscriptionHarnessUsed: false,
    subscriptionHarnessPath: "NOT_AVAILABLE" as const,
    modelSources: { [FREE_MODEL]: "FREE_CONFIRMED" as const },
    modelRoutes: {
      [FREE_MODEL]: {
        provider: "test", family: "TEST",
        transport: "OMNIROUTE_API" as const,
        subscriptionHarnessUsed: false,
        billingSource: "FREE_CONFIRMED" as const
      }
    }
  }
};

describe("Chat consensus detection", () => {
  it("fires only when the user explicitly asks to send it to production", () => {
    const agreed = detectProjectConsensus([
      { role: "user", content: "Potrzebuję eksportu CSV z raportów." },
      { role: "assistant", content: PLAN },
      { role: "user", content: "Dobra, kieruj do produkcji." }
    ]);
    expect(agreed?.objective).toContain("eksport CSV");
    expect(agreed?.modules).toContain("reports");
    expect(agreed?.acceptanceCriteria.length).toBeGreaterThanOrEqual(2);

    // An agreed plan alone must NEVER materialise anything — the user has not asked yet.
    expect(detectProjectConsensus([
      { role: "user", content: "Potrzebuję eksportu CSV." },
      { role: "assistant", content: PLAN }
    ])).toBeNull();

    // Discussing production without requesting it is not a trigger.
    expect(detectProjectConsensus([
      { role: "assistant", content: PLAN },
      { role: "user", content: "A co by to znaczyło dla produkcji?" }
    ])).toBeNull();

    // Explicit refusal must not be read as approval.
    expect(detectProjectConsensus([
      { role: "assistant", content: PLAN },
      { role: "user", content: "Nie kieruj tego jeszcze do produkcji." }
    ])).toBeNull();

    // The request must be the user's, not the assistant's own suggestion.
    expect(detectProjectConsensus([
      { role: "assistant", content: `${PLAN}\n\nCzy mam skierować do produkcji?` }
    ])).toBeNull();

    expect(detectProjectConsensus([])).toBeNull();
  });

  it("refuses to fire when asked to ship but nothing concrete was agreed", () => {
    expect(detectProjectConsensus([
      { role: "assistant", content: "Mogę zrobić eksport, ale potrzebuję szczegółów." },
      { role: "user", content: "Kieruj do produkcji." }
    ])).toBeNull();

    expect(detectProjectConsensus([
      { role: "assistant", content: "PLAN UZGODNIONY\nCel: zrobić coś" },
      { role: "user", content: "Kieruj do produkcji." }
    ])).toBeNull();
  });

  it("is logically sound about ordering, staleness and quoted phrases", () => {
    const plan = (objective: string, module: string) =>
      `PLAN UZGODNIONY\nCel: ${objective}\nModuły: ${module}\nŚcieżki: src/${module}/**\nKryteria akceptacji:\n- a\n- b`;

    // The newest agreed plan wins, not a stale earlier one.
    expect(detectProjectConsensus([
      { role: "assistant", content: plan("Stara funkcja", "old") },
      { role: "assistant", content: plan("Nowa funkcja", "new") },
      { role: "user", content: "Kieruj do produkcji." }
    ])?.objective).toBe("Nowa funkcja");

    // Approval must not leak forward into unrelated later conversation.
    expect(detectProjectConsensus([
      { role: "assistant", content: plan("Funkcja", "mod") },
      { role: "user", content: "Kieruj do produkcji." },
      { role: "assistant", content: "Zrobione." },
      { role: "user", content: "A jak działa cache?" }
    ])).toBeNull();

    // A plan proposed AFTER the request was never approved by the user.
    expect(detectProjectConsensus([
      { role: "user", content: "Kieruj do produkcji." },
      { role: "assistant", content: plan("Funkcja", "mod") }
    ])).toBeNull();

    // Quoting or conditioning the phrase is not an instruction.
    for (const text of [
      "Nie mów 'kieruj do produkcji' dopóki nie sprawdzimy testów.",
      "Zanim skierujesz do produkcji, pokaż testy.",
      "Jeśli testy przejdą, kieruj do produkcji."
    ]) {
      expect(detectProjectConsensus([
        { role: "assistant", content: plan("Funkcja", "mod") },
        { role: "user", content: text }
      ])).toBeNull();
    }
  });
});

describe("Automatic materialisation from chat to Tasks", () => {
  it("signs and persists a real WorkOrder that the orchestrator gate accepts", async () => {
    const root = await mkdtemp(join(tmpdir(), "control-materialise-"));
    roots.push(root);
    const { privateKey, publicKey } = keys();

    const server = createControlServer({
      stateDir: root,
      webRoot: resolve("web/control"),
      materialisationPrivateKeyPem: privateKey,
      materialisationKeyId: "control-plane"
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("NO_ADDR");
      const base = `http://127.0.0.1:${address.port}`;

      const created = await fetch(`${base}/api/tasks/materialise`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          objective: "Dodać eksport CSV raportów",
          modules: ["reports"],
          allowedPaths: ["src/reports/**"],
          acceptanceCriteria: ["eksport zwraca poprawny CSV", "test pokrywa pusty raport"]
        })
      });
      expect(created.status).toBe(201);
      const payload = await created.json() as { taskId: string; state: string; orderFp: string; keyId: string };
      expect(payload.taskId).toMatch(/^TASK-[A-Za-z0-9._-]+$/);
      expect(payload.state).toBe("CREATED");
      expect(payload.keyId).toBe("control-plane");

      // The stored envelope must be a genuinely signed, schema-valid WorkOrder.
      const stored = JSON.parse(await readFile(
        join(root, "work-orders", `${payload.taskId}.r1.signed.json`), "utf8"
      )) as SignedWorkOrder;
      validateWorkOrder(stored.order);
      expect(stored.order.objective).toBe("Dodać eksport CSV raportów");
      expect(stored.order.scope.modules).toEqual(["reports"]);
      expect(stored.order.acceptanceCriteria).toHaveLength(2);
      expect(verifySignedWorkOrder(stored, publicKey)).toBe(true);

      // A tampered objective must break signature verification.
      const tampered = { ...stored, order: { ...stored.order, objective: "coś innego" } };
      expect(verifySignedWorkOrder(tampered as SignedWorkOrder, publicKey)).toBe(false);

      // And it must show up on the Tasks list as real runtime state.
      const tasks = await fetch(`${base}/api/tasks`).then((item) => item.json()) as {
        tasks: Array<{ taskId: string; objective: string; state: string; initiatedBy: string }>;
      };
      const row = tasks.tasks.find((item) => item.taskId === payload.taskId);
      expect(row).toBeTruthy();
      expect(row?.objective).toBe("Dodać eksport CSV raportów");
      expect(row?.initiatedBy).toBe("control-plane");
    } finally {
      server.close();
      if (server.listening) await once(server, "close");
    }
  });

  it("materialises from a real chat turn only after the user asks, and never twice", async () => {
    const root = await mkdtemp(join(tmpdir(), "control-chat-flow-"));
    roots.push(root);
    const { privateKey, publicKey } = keys();

    const reply = (text: string): typeof fetch => (async () => {
      const encoder = new TextEncoder();
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        }
      }), { status: 200, headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch;

    const server = createControlServer({
      stateDir: root,
      webRoot: resolve("web/control"),
      chatApiKey: "test-key",
      chatFetchImpl: reply(PLAN),
      chatModelCatalog: { async list() { return freeCatalog; } },
      materialisationPrivateKeyPem: privateKey,
      materialisationKeyId: "control-plane"
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("NO_ADDR");
      const base = `http://127.0.0.1:${address.port}`;
      const session = await fetch(`${base}/api/chat/sessions`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: FREE_MODEL })
      }).then((item) => item.json()) as { sessionId: string };

      const say = async (message: string, expectTask = false) => {
        // startMessage rejects with 409 while the previous generation is still releasing its
        // slot, so retry briefly instead of asserting on a racy first attempt.
        let accepted: Response | null = null;
        for (let attempt = 0; attempt < 40; attempt += 1) {
          accepted = await fetch(`${base}/api/chat/sessions/${session.sessionId}/messages`, {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ message, model: FREE_MODEL, attachments: [] })
          });
          if (accepted.status !== 409) break;
          await new Promise((done) => setTimeout(done, 25));
        }
        expect(accepted?.status).toBe(202);
        for (let attempt = 0; attempt < 150; attempt += 1) {
          const state = await fetch(`${base}/api/chat/sessions/${session.sessionId}`).then((item) => item.json()) as {
            messages: Array<{ role: string; state: string; materialisedTaskId?: string }>;
          };
          const last = state.messages.at(-1);
          // `state: complete` is persisted BEFORE materialisation runs, so when a task is
          // expected we must keep polling until the id lands (or the turn is deemed done).
          if (last?.role === "assistant" && last.state === "complete" && (!expectTask || last.materialisedTaskId)) {
            return state.messages;
          }
          await new Promise((done) => setTimeout(done, 15));
        }
        throw new Error("CHAT_TURN_TIMEOUT");
      };

      // The assistant proposes an agreed plan — but the user has not asked to ship it.
      await say("Potrzebuję eksportu CSV raportów.");
      const beforeAsk = await fetch(`${base}/api/tasks`).then((item) => item.json()) as { tasks: unknown[] };
      expect(beforeAsk.tasks).toHaveLength(0);

      // Now the user explicitly asks. This is the only trigger.
      const messages = await say("Dobra, kieruj do produkcji.", true);
      const taskId = messages.filter((m) => m.role === "assistant").at(-1)?.materialisedTaskId;
      expect(taskId).toMatch(/^TASK-/);

      const tasks = await fetch(`${base}/api/tasks`).then((item) => item.json()) as {
        tasks: Array<{ taskId: string; state: string; initiatedBy: string }>;
      };
      expect(tasks.tasks).toHaveLength(1);
      expect(tasks.tasks[0]!.taskId).toBe(taskId);
      expect(tasks.tasks[0]!.state).toBe("CREATED");

      // Signed with the control-plane key, verifiable end to end.
      const stored = JSON.parse(await readFile(
        join(root, "work-orders", `${taskId}.r1.signed.json`), "utf8"
      )) as SignedWorkOrder;
      expect(verifySignedWorkOrder(stored, publicKey)).toBe(true);

      // Asking again must NOT create a second task for the same agreed plan.
      await say("Kieruj do produkcji.");
      const after = await fetch(`${base}/api/tasks`).then((item) => item.json()) as {
        tasks: Array<{ taskId: string }>;
      };
      expect(after.tasks).toHaveLength(1);
      expect(after.tasks[0]!.taskId).toBe(taskId);
    } finally {
      server.close();
      if (server.listening) await once(server, "close");
    }
  }, 30_000);

  it("materialises a specific message on demand when the user clicks the button", async () => {
    const root = await mkdtemp(join(tmpdir(), "control-manual-mat-"));
    roots.push(root);
    const { privateKey, publicKey } = keys();
    const server = createControlServer({
      stateDir: root, webRoot: resolve("web/control"),
      materialisationPrivateKeyPem: privateKey, materialisationKeyId: "control-plane"
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("NO_ADDR");
      const base = `http://127.0.0.1:${address.port}`;

      // The button ships the plan text verbatim — no agreed-phrase requirement, because the
      // click IS the explicit request.
      const created = await fetch(`${base}/api/tasks/materialise-plan`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan: PLAN })
      });
      expect(created.status).toBe(201);
      const payload = await created.json() as { taskId: string; state: string };
      expect(payload.taskId).toMatch(/^TASK-/);
      expect(payload.state).toBe("CREATED");

      const stored = JSON.parse(await readFile(
        join(root, "work-orders", `${payload.taskId}.r1.signed.json`), "utf8"
      )) as SignedWorkOrder;
      validateWorkOrder(stored.order);
      expect(verifySignedWorkOrder(stored, publicKey)).toBe(true);
      expect(stored.order.objective).toContain("eksport CSV");

      // Text without a concrete plan cannot be shipped, even by an explicit click.
      for (const bad of ["zwykła rozmowa bez planu", "PLAN UZGODNIONY\nCel: samo to", ""]) {
        const rejected = await fetch(`${base}/api/tasks/materialise-plan`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ plan: bad })
        });
        expect(rejected.status).toBe(400);
        expect((await rejected.json() as { error: string }).error).toBe("MATERIALISATION_PLAN_INCOMPLETE");
      }
    } finally {
      server.close();
      if (server.listening) await once(server, "close");
    }
  });

  it("refuses to materialise without a configured signing key or with junk input", async () => {
    const root = await mkdtemp(join(tmpdir(), "control-materialise-off-"));
    roots.push(root);
    const unsigned = createControlServer({ stateDir: root, webRoot: resolve("web/control") });
    unsigned.listen(0, "127.0.0.1");
    await once(unsigned, "listening");
    try {
      const address = unsigned.address();
      if (!address || typeof address === "string") throw new Error("NO_ADDR");
      const base = `http://127.0.0.1:${address.port}`;
      const body = {
        objective: "cokolwiek",
        modules: ["m"],
        allowedPaths: ["src/**"],
        acceptanceCriteria: ["a"]
      };
      const blocked = await fetch(`${base}/api/tasks/materialise`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
      });
      expect(blocked.status).toBe(503);
      expect((await blocked.json() as { error: string }).error).toBe("MATERIALISATION_SIGNING_KEY_UNAVAILABLE");
    } finally {
      unsigned.close();
      if (unsigned.listening) await once(unsigned, "close");
    }

    const root2 = await mkdtemp(join(tmpdir(), "control-materialise-bad-"));
    roots.push(root2);
    const { privateKey } = keys();
    const server = createControlServer({
      stateDir: root2, webRoot: resolve("web/control"),
      materialisationPrivateKeyPem: privateKey, materialisationKeyId: "control-plane"
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("NO_ADDR");
      const base = `http://127.0.0.1:${address.port}`;
      for (const bad of [
        {},
        { objective: "x", modules: [], allowedPaths: ["src/**"], acceptanceCriteria: ["a"] },
        { objective: "x", modules: ["m"], allowedPaths: [], acceptanceCriteria: ["a"] },
        { objective: "   ", modules: ["m"], allowedPaths: ["src/**"], acceptanceCriteria: ["a"] },
        { objective: "x", modules: ["m"], allowedPaths: ["../etc/passwd"], acceptanceCriteria: ["a"] }
      ]) {
        const rejected = await fetch(`${base}/api/tasks/materialise`, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(bad)
        });
        expect(rejected.status).toBe(400);
      }
    } finally {
      server.close();
      if (server.listening) await once(server, "close");
    }
  });
});
