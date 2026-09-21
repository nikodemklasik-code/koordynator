import { randomUUID } from "node:crypto";
import { mkdir, realpath } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CapabilityLeaseReceipt } from "./receipts.js";
import { createCapabilityLeaseReceipt, verifyCapabilityLeaseReceipt } from "./receipts.js";

const execFileAsync = promisify(execFile);

export type WorktreeLease = CapabilityLeaseReceipt;

export type PreparedWorktree = {
  worktreeId: string;
  lease: WorktreeLease;
  repoRoot: string;
  worktreePath: string;
  branchName: string;
  baseRef: string;
  baseSha: string;
  createdAt: string;
};

export type WorktreeStatus = {
  worktreeId: string;
  baseSha: string;
  headSha: string;
  changedPaths: string[];
  clean: boolean;
};

export interface GitWorktreePort {
  run(cwd: string, args: string[]): Promise<string>;
}

export class SystemGitWorktreePort implements GitWorktreePort {
  async run(cwd: string, args: string[]): Promise<string> {
    const result = await execFileAsync("git", args, {
      cwd,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        LANG: process.env.LANG,
        LC_ALL: process.env.LC_ALL,
        GIT_TERMINAL_PROMPT: "0"
      }
    });
    return result.stdout.trim();
  }
}

function safeId(value: string): string {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!cleaned) throw new Error("WORKTREE_ID_INVALID");
  return cleaned.slice(0, 80);
}

export class EphemeralWorktreeManager {
  private readonly repoRoot: string;
  private readonly worktreeRoot: string;

  constructor(
    repoRoot: string,
    stateDir: string,
    private readonly git: GitWorktreePort = new SystemGitWorktreePort()
  ) {
    this.repoRoot = resolve(repoRoot);
    this.worktreeRoot = join(resolve(stateDir), "corporation-v2", "worktrees");
  }

  createLease(input: {
    taskId: string;
    stageId: string;
    candidateId: string;
    roleId: string;
    executorId: string;
    allowedCapabilities: string[];
    allowedEffects: string[];
    allowedTools: string[];
    ttlMs?: number;
  }): WorktreeLease {
    return createCapabilityLeaseReceipt(input);
  }

  async prepare(input: {
    lease: WorktreeLease;
    baseRef: string;
  }): Promise<PreparedWorktree> {
    this.assertLease(input.lease);
    await mkdir(this.worktreeRoot, { recursive: true, mode: 0o700 });

    const actualRoot = await this.git.run(this.repoRoot, ["rev-parse", "--show-toplevel"]);
    if (resolve(actualRoot) !== this.repoRoot) throw new Error("WORKTREE_REPO_ROOT_MISMATCH");

    const baseSha = await this.git.run(this.repoRoot, ["rev-parse", "--verify", input.baseRef]);
    const worktreeId = `WT-${randomUUID().slice(0, 10).toUpperCase()}`;
    const directory = safeId(`${input.lease.taskId}-${input.lease.stageId}-${input.lease.candidateId}-${worktreeId}`);
    const worktreePath = join(this.worktreeRoot, directory);
    const branchName = `corp/${safeId(input.lease.taskId)}/${safeId(input.lease.candidateId)}/${worktreeId.toLowerCase()}`;

    await this.git.run(this.repoRoot, ["worktree", "add", "--detach", worktreePath, baseSha]);
    try {
      await this.git.run(worktreePath, ["switch", "-c", branchName]);
    } catch (error) {
      await this.git.run(this.repoRoot, ["worktree", "remove", "--force", worktreePath]).catch(() => undefined);
      throw error;
    }

    return {
      worktreeId,
      lease: structuredClone(input.lease),
      repoRoot: this.repoRoot,
      worktreePath,
      branchName,
      baseRef: input.baseRef,
      baseSha,
      createdAt: new Date().toISOString()
    };
  }

  async status(worktree: PreparedWorktree): Promise<WorktreeStatus> {
    this.assertLease(worktree.lease);
    await this.assertContained(worktree.worktreePath);

    const headSha = await this.git.run(worktree.worktreePath, ["rev-parse", "HEAD"]);
    const porcelain = await this.git.run(worktree.worktreePath, ["status", "--porcelain=v1"]);
    const changedPaths = porcelain
      .split("\n")
      .filter(Boolean)
      .map((line) => line.slice(3).trim())
      .filter(Boolean);

    return {
      worktreeId: worktree.worktreeId,
      baseSha: worktree.baseSha,
      headSha,
      changedPaths,
      clean: changedPaths.length === 0
    };
  }

  async cleanup(worktree: PreparedWorktree): Promise<void> {
    await this.assertContained(worktree.worktreePath);
    await this.git.run(this.repoRoot, ["worktree", "remove", "--force", worktree.worktreePath]);
    await this.git.run(this.repoRoot, ["branch", "-D", worktree.branchName]).catch(() => undefined);
  }

  assertLease(lease: WorktreeLease, now = new Date()): void {
    verifyCapabilityLeaseReceipt(lease, now);
    if (!lease.taskId.trim() || !lease.stageId.trim() || !lease.candidateId.trim()) {
      throw new Error("WORKTREE_LEASE_SCOPE_INVALID");
    }
  }

  private async assertContained(worktreePath: string): Promise<void> {
    const expectedRoot = resolve(this.worktreeRoot);
    const candidate = resolve(worktreePath);
    if (!candidate.startsWith(`${expectedRoot}/`)) throw new Error("WORKTREE_PATH_OUTSIDE_ISOLATION_ROOT");

    try {
      const actual = await realpath(candidate);
      if (!actual.startsWith(`${expectedRoot}/`)) throw new Error("WORKTREE_REALPATH_ESCAPE");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }

    if (basename(candidate) === ".") throw new Error("WORKTREE_PATH_INVALID");
  }
}
