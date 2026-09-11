import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GitHubRepositoryContextService, type GitRunner } from "../src/control/github-repository-context.js";

describe("GitHub repository context auth", () => {
  it("uses gh auth token for https clone when available", async () => {
    const calls: Array<{ executable: string; args: string[] }> = [];
    const runner: GitRunner = async (executable, args) => {
      calls.push({ executable, args });
      if (executable === "gh" && args.join(" ") === "auth token") {
        return { code: 0, stdout: "gho_test_token_not_real\n", stderr: "" };
      }
      if (executable === "git" && args[0] === "clone") {
        const dest = args.at(-1);
        if (!dest) return { code: 1, stdout: "", stderr: "missing dest" };
        await mkdir(dest, { recursive: true });
        await writeFile(join(dest, "README.md"), "# demo\n", "utf8");
        await writeFile(join(dest, "package.json"), "{\"name\":\"demo\"}\n", "utf8");
        await writeFile(join(dest, "AGENTS.md"), "rules\n", "utf8");
        return { code: 0, stdout: "", stderr: "" };
      }
      if (executable === "git" && args[0] === "rev-parse") {
        return { code: 0, stdout: "1234567890abcdef1234567890abcdef12345678\n", stderr: "" };
      }
      if (executable === "git" && args[0] === "ls-files") {
        return { code: 0, stdout: "README.md\npackage.json\nAGENTS.md\n", stderr: "" };
      }
      return { code: 1, stdout: "", stderr: "unexpected" };
    };

    const service = new GitHubRepositoryContextService(runner);
    const context = await service.fromMessage("sprawdź https://github.com/nikodemklasik-code/koordynator i AGENTS");
    expect(context?.repository).toBe("nikodemklasik-code/koordynator");
    const clone = calls.find((call) => call.executable === "git" && call.args[0] === "clone");
    expect(clone?.args.join(" ")).toContain("https://x-access-token:gho_test_token_not_real@github.com/nikodemklasik-code/koordynator.git");
    expect(calls.some((call) => call.executable === "gh" && call.args.join(" ") === "auth token")).toBe(true);
    expect(context?.files).toEqual(expect.arrayContaining(["AGENTS.md"]));
  });
});
