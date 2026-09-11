import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { GitHubConnectionService, type GitHubCommandRunner } from "../src/control/github-connection-service.js";
import type { GitHubRepositoryContextPort } from "../src/control/github-repository-context.js";
import type { ChatModelCatalogPort } from "../src/control/chat-model-catalog.js";
import { createControlServer } from "../src/control/server.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function waitForPersistedGeneration(base: string, sessionId: string): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const session = await fetch(`${base}/api/chat/sessions/${sessionId}`).then((response) => response.json()) as {
      messages?: Array<{ role?: string; state?: string; usageAudit?: string }>;
    };
    const assistant = session.messages?.find((message) => message.role === "assistant");
    if (assistant?.state === "complete" && assistant.usageAudit === "PERSISTED") return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 15));
  }
  throw new Error("GITHUB_RUNTIME_PERSIST_TIMEOUT");
}

describe("GitHub runtime fallback", () => {
  it("uses an already working Git credential path when gh is not installed", async () => {
    const calls: Array<{ executable: string; args: string[] }> = [];
    const runner: GitHubCommandRunner = async (executable, args) => {
      calls.push({ executable, args });
      if (executable === "gh") {
        const error = new Error("spawn gh ENOENT") as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      }
      if (args[0] === "--version") return { code: 0, stdout: "git version 2.46.0", stderr: "" };
      if (args.join(" ") === "config --get remote.origin.url") {
        return { code: 0, stdout: "https://github.com/nikodemklasik-code/koordynator\n", stderr: "" };
      }
      if (args.join(" ") === "ls-remote --exit-code origin HEAD") {
        return { code: 0, stdout: "deadbeef\tHEAD\n", stderr: "" };
      }
      return { code: 1, stdout: "", stderr: "unexpected" };
    };

    const service = new GitHubConnectionService(runner, 1);
    const status = await service.status(true);
    expect(status.state).toBe("CONNECTED");
    expect(status.connectionMethod).toBe("GIT_CREDENTIAL");
    expect(status.repositoryAccess).toBe(true);
    expect(status.cliAvailable).toBe(false);

    const connected = await service.connect(true);
    expect(connected.connectionMethod).toBe("GIT_CREDENTIAL");
    expect(calls.some((call) => call.args.includes("login"))).toBe(false);
  });

  it("materializes bounded repository context as an internal chat file before OmniRoute generation", async () => {
    const root = await mkdtemp(join(tmpdir(), "koord-repo-context-http-"));
    roots.push(root);
    let capturedBody: any;
    let capturedResolve!: () => void;
    const captured = new Promise<void>((resolvePromise) => { capturedResolve = resolvePromise; });
    const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body ?? "{}"));
      capturedResolve();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
          controller.close();
        }
      });
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch;
    const githubRepositoryContext: GitHubRepositoryContextPort = {
      async fromMessage(message) {
        if (!message.includes("github.com")) return null;
        return {
          repository: "nikodemklasik-code/Harmonia-VERA",
          commit: "1234567890abcdef1234567890abcdef12345678",
          files: ["Cargo.toml", "crates/vera-core-module/src/lib.rs"],
          context: "Repository: nikodemklasik-code/Harmonia-VERA\n--- FILE Cargo.toml ---\n[workspace]\n--- END FILE ---"
        };
      }
    };
    const chatModelCatalog: ChatModelCatalogPort = {
      async list() {
        return {
          models: ["auto/best-free"],
          source: "OMNIROUTE",
          checkedAt: "2026-09-10T15:00:00.000Z",
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
      stateDir: root,
      webRoot: resolve("web/control"),
      chatApiKey: "secret",
      chatFetchImpl: fetchImpl,
      chatAllowGithubContext: true,
      githubRepositoryContext,
      chatModelCatalog
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("GITHUB_RUNTIME_TEST_ADDRESS");
      const base = `http://127.0.0.1:${address.port}`;
      const created = await fetch(`${base}/api/chat/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "auto/best-free" })
      });
      const session = await created.json() as { sessionId: string };
      const sent = await fetch(`${base}/api/chat/sessions/${session.sessionId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "Review https://github.com/nikodemklasik-code/Harmonia-VERA and assess core" })
      });
      expect(sent.status).toBe(202);
      await captured;

      const user = capturedBody.messages?.find((message: { role?: string }) => message.role === "user");
      expect(user?.role).toBe("user");
      expect(Array.isArray(user.content)).toBe(true);
      expect(user.content[0]).toEqual({ type: "text", text: "Review https://github.com/nikodemklasik-code/Harmonia-VERA and assess core" });
      const blob = JSON.stringify(user.content);
      expect(blob).toContain("Cargo.toml");
      expect(blob).toContain("Harmonia-VERA");
      expect(blob).not.toContain("\"type\":\"file\"");
      await waitForPersistedGeneration(base, session.sessionId);
    } finally {
      server.close();
      if (server.listening) await once(server, "close");
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 40));
    }
  });
});
