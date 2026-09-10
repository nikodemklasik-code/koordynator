import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import {
  GitHubConnectionService,
  type GitHubCommandRunner,
  type GitHubConnectionPort,
  type GitHubConnectionStatus
} from "../src/control/github-connection-service.js";
import { createControlServer } from "../src/control/server.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function connectedStatus(): GitHubConnectionStatus {
  return {
    provider: "github",
    hostname: "github.com",
    state: "CONNECTED",
    cliAvailable: true,
    authenticated: true,
    gitConfigured: true,
    checkedAt: new Date().toISOString()
  };
}

describe("GitHub repository connection service", () => {
  it("requires explicit consent, then uses only the official gh browser login and setup-git flow", async () => {
    const calls: Array<{ executable: string; args: string[]; interactive: boolean }> = [];
    let authenticated = false;
    const runner: GitHubCommandRunner = async (executable, args, options) => {
      calls.push({ executable, args, interactive: options.interactive });
      if (args[0] === "--version") return { code: 0, stdout: "gh version 2.80.0", stderr: "" };
      if (args[0] === "auth" && args[1] === "status") return { code: authenticated ? 0 : 1, stdout: "", stderr: "" };
      if (args[0] === "auth" && args[1] === "login") {
        authenticated = true;
        return { code: 0, stdout: "", stderr: "" };
      }
      if (args[0] === "auth" && args[1] === "setup-git") return { code: 0, stdout: "", stderr: "" };
      return { code: 1, stdout: "", stderr: "unexpected" };
    };
    const service = new GitHubConnectionService(runner, 1);

    expect((await service.status(true)).state).toBe("AUTH_REQUIRED");
    await expect(service.connect(false)).rejects.toThrow("GITHUB_CONSENT_REQUIRED");
    expect(calls.some((call) => call.args[0] === "auth" && call.args[1] === "login")).toBe(false);

    const status = await service.connect(true);
    expect(status.state).toBe("CONNECTED");
    expect(status.authenticated).toBe(true);
    expect(status.gitConfigured).toBe(true);

    const loginCalls = calls.filter((call) => call.args[0] === "auth" && call.args[1] === "login");
    expect(loginCalls).toHaveLength(1);
    expect(loginCalls[0]?.executable).toBe("gh");
    expect(loginCalls[0]?.interactive).toBe(true);
    expect(loginCalls[0]?.args).toEqual([
      "auth", "login", "--hostname", "github.com", "--git-protocol", "https", "--web", "--skip-ssh-key"
    ]);
    expect(calls.some((call) => call.args.join(" ") === "auth setup-git --hostname github.com")).toBe(true);
    expect(JSON.stringify(calls).toLowerCase()).not.toContain("password");
    expect(JSON.stringify(calls).toLowerCase()).not.toContain("cookie");
  });
});

describe("GitHub repository connection HTTP boundary", () => {
  it("reports status, rejects missing consent and connects only after approved=true", async () => {
    const root = await mkdtemp(join(tmpdir(), "koord-github-http-"));
    roots.push(root);
    let connectCalls = 0;
    const authRequired: GitHubConnectionStatus = {
      provider: "github",
      hostname: "github.com",
      state: "AUTH_REQUIRED",
      cliAvailable: true,
      authenticated: false,
      gitConfigured: false,
      checkedAt: new Date().toISOString()
    };
    const githubConnection: GitHubConnectionPort = {
      async status() { return authRequired; },
      async connect(approved) {
        expect(approved).toBe(true);
        connectCalls += 1;
        return connectedStatus();
      }
    };
    const server = createControlServer({
      stateDir: root,
      webRoot: resolve("web/control"),
      githubConnection
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("GITHUB_TEST_ADDRESS");
      const base = `http://127.0.0.1:${address.port}`;

      const statusResponse = await fetch(`${base}/api/integrations/github`);
      expect(statusResponse.status).toBe(200);
      expect((await statusResponse.json()).state).toBe("AUTH_REQUIRED");

      const denied = await fetch(`${base}/api/integrations/github/connect`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approved: false })
      });
      expect(denied.status).toBe(400);
      expect(await denied.json()).toEqual({ error: "GITHUB_CONSENT_REQUIRED" });
      expect(connectCalls).toBe(0);

      const approved = await fetch(`${base}/api/integrations/github/connect`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approved: true })
      });
      expect(approved.status).toBe(200);
      expect((await approved.json()).state).toBe("CONNECTED");
      expect(connectCalls).toBe(1);

      const providersPage = await fetch(`${base}/providers`).then((response) => response.text());
      expect(providersPage).toContain('id="githubConnectionCard"');
      expect(providersPage).toContain('id="githubConsentApprove"');
      expect(providersPage).toContain("Repository authentication is separate from the GitHub Copilot AI provider");

      const chatPage = await fetch(`${base}/chat`).then((response) => response.text());
      expect(chatPage).toContain('id="githubChatButton"');
      expect(chatPage).toContain('id="githubChatConsentApprove"');
      expect(chatPage).toContain('/chat-github.js');
    } finally {
      server.close();
      if (server.listening) await once(server, "close");
    }
  });
});
