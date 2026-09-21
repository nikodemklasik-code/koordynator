import { spawn } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { HermesWorkspaceContext } from "./hermes-pty.js";

function runGit(args: string[], cwd: string, timeoutMs = 90_000): Promise<void> {
  return new Promise((accept, reject) => {
    const child = spawn("git", args, {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      shell: false,
      stdio: ["ignore", "ignore", "ignore"]
    });
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* gone */ }
      reject(new Error("WORKSPACE_GIT_TIMEOUT"));
    }, timeoutMs);
    child.once("error", () => {
      clearTimeout(timer);
      reject(new Error("WORKSPACE_GIT_UNAVAILABLE"));
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) accept();
      else reject(new Error("WORKSPACE_GIT_FAILED"));
    });
  });
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

export async function resolveHermesWorkspaceRoot(input: {
  context?: HermesWorkspaceContext;
  projectRoot: string;
  stateDir: string;
}): Promise<string> {
  const context = input.context ?? { workspace: "general" as const };
  const repository = context.repository?.trim();

  if (context.workspace === "corporation" || repository?.toLowerCase() === "nikodemklasik-code/koordynator") {
    return resolve(input.projectRoot);
  }

  if (context.workspace === "harmonia-legal") {
    const explicit = process.env.KOORDYNATOR_HARMONIA_LEGAL_ROOT?.trim();
    if (explicit) {
      const root = resolve(explicit);
      if (!await exists(join(root, ".git"))) throw new Error("HARMONIA_LEGAL_ROOT_NOT_GIT");
      return root;
    }

    const parent = resolve(input.stateDir, "product-workspaces");
    const root = join(parent, "harmonia-legal");
    await mkdir(parent, { recursive: true, mode: 0o700 });

    if (!await exists(join(root, ".git"))) {
      await runGit([
        "clone",
        "--single-branch",
        "--branch",
        "develop",
        "--",
        "https://github.com/nikodemklasik-code/Harmonia-Legal-Platform.git",
        root
      ], parent);
    }
    return root;
  }

  if (context.workspace === "general" && repository) {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error("WORKSPACE_REPOSITORY_INVALID");
    const parent = resolve(input.stateDir, "repository-workspaces");
    const slug = repository.replace(/[^A-Za-z0-9_.-]+/g, "--");
    const root = join(parent, slug);
    await mkdir(parent, { recursive: true, mode: 0o700 });
    if (!await exists(join(root, ".git"))) {
      await runGit(["clone", "--", `https://github.com/${repository}.git`, root], parent);
    }
    return root;
  }

  return resolve(input.projectRoot);
}
