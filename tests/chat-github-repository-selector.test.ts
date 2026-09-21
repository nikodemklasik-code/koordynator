import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { GitHubConnectionService, type GitHubCommandRunner } from "../src/control/github-connection-service.js";

describe("chat GitHub repository workspace", () => {
  it("lists authenticated repositories through the existing GitHub CLI connection", async () => {
    const runner: GitHubCommandRunner = async (executable, args) => {
      if (executable !== "gh") return { code: 1, stdout: "", stderr: "unexpected executable" };
      if (args[0] === "--version") return { code: 0, stdout: "gh version 2", stderr: "" };
      if (args[0] === "auth" && args[1] === "status") return { code: 0, stdout: "logged in", stderr: "" };
      if (args[0] === "repo" && args[1] === "list") {
        return {
          code: 0,
          stdout: JSON.stringify([
            {
              nameWithOwner: "nikodemklasik-code/koordynator",
              url: "https://github.com/nikodemklasik-code/koordynator",
              defaultBranchRef: "main",
              visibility: "PUBLIC",
              isPrivate: false,
              isArchived: false
            },
            {
              nameWithOwner: "nikodemklasik-code/Harmonia-Legal-Platform",
              url: "https://github.com/nikodemklasik-code/Harmonia-Legal-Platform",
              defaultBranchRef: "develop",
              visibility: "PRIVATE",
              isPrivate: true,
              isArchived: false
            }
          ]),
          stderr: ""
        };
      }
      return { code: 1, stdout: "", stderr: "unexpected gh command" };
    };

    const service = new GitHubConnectionService(runner, 10_000);
    const repositories = await service.repositories(true);

    expect(repositories.map((item) => item.repository)).toEqual([
      "nikodemklasik-code/Harmonia-Legal-Platform",
      "nikodemklasik-code/koordynator"
    ]);
    expect(repositories.find((item) => item.repository.endsWith("/koordynator"))?.defaultBranch).toBe("main");
  });

  it("keeps a persistent selected repository in the chat and sends it separately from user text", async () => {
    const [githubUi, chat, server, main] = await Promise.all([
      readFile(new URL("../web/control/chat-github.js", import.meta.url), "utf8"),
      readFile(new URL("../web/control/chat.js", import.meta.url), "utf8"),
      readFile(new URL("../src/control/server.ts", import.meta.url), "utf8"),
      readFile(new URL("../src/control/main.ts", import.meta.url), "utf8")
    ]);

    expect(githubUi).toContain('GITHUB_FALLBACK_REPOSITORY = "nikodemklasik-code/koordynator"');
    expect(githubUi).toContain('localStorage.setItem(GITHUB_REPOSITORY_STORAGE_KEY, value)');
    expect(githubUi).toContain('window.koordynatorSelectedRepository');
    expect(githubUi).toContain('/api/integrations/github/repositories');
    expect(githubUi).toContain('github-repository-menu');

    expect(chat).toContain('window.koordynatorSelectedRepository');
    expect(chat).toContain('...(repository ? { repository } : {})');
    expect(chat).toContain('restoreOrStartHermesPty()');

    expect(server).toContain('assertExactKeys(payload, ["message", "model", "attachments", "repository"])');
    expect(server).toContain('url.pathname === "/api/integrations/github/repositories"');
    expect(server).toContain('selectedIsLocalWorkspace');
    expect(main).toContain('KOORDYNATOR_CHAT_DEFAULT_REPOSITORY');
    expect(main).toContain('"nikodemklasik-code/koordynator"');
  });
});
