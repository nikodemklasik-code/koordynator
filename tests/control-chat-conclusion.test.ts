import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { createControlServer } from "../src/control/server.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function signingKey(): string {
  const { privateKey } = generateKeyPairSync("ed25519");
  return privateKey.export({ type: "pkcs8", format: "pem" }).toString();
}

function conclusionFetch(): typeof fetch {
  return (async (_input: string | URL | Request, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body || "{}")) as { stream?: boolean };
    if (request.stream === false) {
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              tasks: [{
                title: "Koniec rozmowy",
                objective: "Dodać zakończenie rozmowy, które tworzy zadania",
                modules: ["chat"],
                allowedPaths: ["src/control/chat-service.ts"],
                acceptanceCriteria: ["przycisk kończy rozmowę i tworzy zadanie"],
                evidence: [
                  {
                    messageId: "MESSAGE_ID_REPLACED_BY_TEST_PROVIDER",
                    quote: "Wdrożymy moduł chat w src/control/chat-service.ts."
                  }
                ]
              }]
            })
          }
        }],
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 }
      }), {
        status: 200,
        headers: { "content-type": "application/json", "x-request-id": "conclusion-test-request" }
      });
    }

    const encoder = new TextEncoder();
    return new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "Rozumiem ustalenie." } }] })}\n\n`));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      }
    }), { status: 200, headers: { "content-type": "text/event-stream" } });
  }) as typeof fetch;
}

describe("end conversation -> deterministic Tasks", () => {
  it("grounds conclusions, materialises tasks once, locks the ended chat and audits model use", async () => {
    const root = await mkdtemp(join(tmpdir(), "koord-chat-conclude-"));
    roots.push(root);

    let extractionMessageId = "";
    const baseFetch = conclusionFetch();
    const fetchImpl: typeof fetch = (async (input, init) => {
      const request = JSON.parse(String(init?.body || "{}")) as {
        stream?: boolean;
        messages?: Array<{ role?: string; content?: string }>;
      };
      if (request.stream === false) {
        const transcript = request.messages?.find((message) => message.role === "user")?.content || "";
        const match = /\[([0-9a-f-]{36})\] USER: Wdrożymy moduł chat/.exec(transcript);
        extractionMessageId = match?.[1] || "";
        const response = await baseFetch(input, init);
        const payload = await response.json() as {
          choices: Array<{ message: { content: string } }>;
          usage: Record<string, number>;
        };
        const parsed = JSON.parse(payload.choices[0]!.message.content);
        parsed.tasks[0].evidence[0].messageId = extractionMessageId;
        payload.choices[0]!.message.content = JSON.stringify(parsed);
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "content-type": "application/json", "x-request-id": "conclusion-test-request" }
        });
      }
      return baseFetch(input, init);
    }) as typeof fetch;

    const server = createControlServer({
      stateDir: root,
      webRoot: resolve("web/control"),
      chatApiKey: "test-key",
      chatFetchImpl: fetchImpl,
      materialisationPrivateKeyPem: signingKey(),
      materialisationKeyId: "control-plane"
    });

    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("NO_ADDR");
      const base = `http://127.0.0.1:${address.port}`;

      const session = await fetch(`${base}/api/chat/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({})
      }).then((response) => response.json()) as { sessionId: string };

      const accepted = await fetch(`${base}/api/chat/sessions/${session.sessionId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: "Wdrożymy moduł chat w src/control/chat-service.ts. Kryterium: przycisk kończy rozmowę i tworzy zadanie.",
          attachments: []
        })
      });
      expect(accepted.status).toBe(202);

      for (let attempt = 0; attempt < 100; attempt += 1) {
        const current = await fetch(`${base}/api/chat/sessions/${session.sessionId}`).then((response) => response.json()) as {
          messages: Array<{ role: string; state: string }>;
        };
        if (current.messages.at(-1)?.state === "complete") break;
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 15));
      }

      const conclude = await fetch(`${base}/api/chat/sessions/${session.sessionId}/conclude`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}"
      });
      expect(conclude.status).toBe(200);
      const receipt = await conclude.json() as {
        conclusion: {
          modelAssisted: boolean;
          tasks: Array<{ state: string; taskId?: string; evidence: Array<{ messageId: string }> }>;
        };
      };

      expect(extractionMessageId).toMatch(/^[0-9a-f-]{36}$/);
      expect(receipt.conclusion.modelAssisted).toBe(true);
      expect(receipt.conclusion.tasks).toHaveLength(1);
      expect(receipt.conclusion.tasks[0]?.state).toBe("MATERIALISED");
      expect(receipt.conclusion.tasks[0]?.taskId).toMatch(/^TASK-/);
      expect(receipt.conclusion.tasks[0]?.evidence[0]?.messageId).toBe(extractionMessageId);

      const taskList = await fetch(`${base}/api/tasks`).then((response) => response.json()) as { tasks: unknown[] };
      expect(taskList.tasks).toHaveLength(1);

      const again = await fetch(`${base}/api/chat/sessions/${session.sessionId}/conclude`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}"
      });
      expect(again.status).toBe(200);
      const afterAgain = await fetch(`${base}/api/tasks`).then((response) => response.json()) as { tasks: unknown[] };
      expect(afterAgain.tasks).toHaveLength(1);

      const rejected = await fetch(`${base}/api/chat/sessions/${session.sessionId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "Jeszcze jedna wiadomość", attachments: [] })
      });
      expect(rejected.status).toBe(409);
      expect((await rejected.json() as { error: string }).error).toBe("CHAT_SESSION_ENDED");

      const usage = await fetch(`${base}/api/chat/usage?hours=24`).then((response) => response.json()) as {
        requests: number;
        tokenTelemetryReported: number;
      };
      expect(usage.requests).toBeGreaterThanOrEqual(2);
      expect(usage.tokenTelemetryReported).toBeGreaterThanOrEqual(1);
    } finally {
      server.close();
      if (server.listening) await once(server, "close");
    }
  }, 30_000);
});
