import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import type { ChatModelCatalogPort } from "../src/control/chat-model-catalog.js";
import { createControlServer } from "../src/control/server.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function waitForAssistant(base: string, sessionId: string): Promise<any> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const session = await fetch(`${base}/api/chat/sessions/${sessionId}`).then((response) => response.json());
    const assistant = session.messages?.find((message: any) => message.role === "assistant");
    if (assistant?.state === "complete" || assistant?.state === "error") return session;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 15));
  }
  throw new Error("WORKSPACE_CONTEXT_TIMEOUT");
}

describe("Live Chat local workspace context", () => {
  it("attaches bounded local workspace files when the user asks for lokalne repo/pliki", async () => {
    const root = await mkdtemp(join(tmpdir(), "koord-ws-http-"));
    roots.push(root);
    const projectRoot = join(root, "project");
    await mkdir(projectRoot, { recursive: true });
    await writeFile(join(projectRoot, "AGENTS.md"), "Use hermetic builds.", "utf8");
    await mkdir(join(projectRoot, "src", "control"), { recursive: true });
    await writeFile(join(projectRoot, "src", "control", "server.ts"), "export const ok = true;\n", "utf8");

    let capturedBody: any;
    const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body ?? "{}"));
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("data: {\"choices\":[{\"delta\":{\"content\":\"OK\"}}]}\\n\\n"));
          controller.enqueue(new TextEncoder().encode("data: [DONE]\\n\\n"));
          controller.close();
        }
      });
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch;

    const chatModelCatalog: ChatModelCatalogPort = {
      async list() {
        return {
          models: ["auto/best-free"],
          source: "OMNIROUTE",
          checkedAt: "2026-09-11T06:00:00.000Z",
          billing: {
            liveChatTransport: "OMNIROUTE_API",
            subscriptionHarnessUsed: false,
            subscriptionHarnessPath: "NOT_WIRED_TO_LIVE_CHAT",
            modelSources: { "auto/best-free": "FREE_CONFIRMED" }
          }
        };
      }
    };

    const server = createControlServer({
      stateDir: join(root, "state"),
      projectRoot: join(root, "project"),
      webRoot: resolve("web/control"),
      chatApiKey: "test-key",
      chatFetchImpl: fetchImpl,
      chatAllowGithubContext: true,
      chatAllowWorkspaceContext: true,
      chatModelCatalog,
      githubRepositoryContext: { async fromMessage() { return null; } }
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("NO_ADDRESS");
      const base = `http://127.0.0.1:${address.port}`;
      const created = await fetch(`${base}/api/chat/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "auto/best-free" })
      }).then((response) => response.json());
      const accepted = await fetch(`${base}/api/chat/sessions/${created.sessionId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: "wejdź w lokalne repo i pokaż pliki w src/control",
          model: "auto/best-free",
          attachments: []
        })
      });
      expect(accepted.status).toBe(202);
      await waitForAssistant(base, created.sessionId);

      const messages = capturedBody?.messages as Array<{ role: string; content: unknown }>;
      const user = messages.find((message) => message.role === "user");
      const blob = JSON.stringify(user?.content ?? []);
      expect(blob).toContain("LOCAL_WORKSPACE");
      expect(blob).toContain("src/control/server.ts");
      expect(blob).toContain("export const ok = true;");
      expect(blob).not.toContain("\"type\":\"file\"");
      expect(blob).not.toContain("\"sessionId\"");
    } finally {
      server.close();
      if (server.listening) await once(server, "close");
    }
  });
});
