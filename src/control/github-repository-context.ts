import { spawn } from "node:child_process";
import { lstat, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

export type GitHubRepositoryContext = {
  repository: string;
  commit: string;
  files: string[];
  context: string;
};

export interface GitHubRepositoryContextPort {
  fromMessage(message: string): Promise<GitHubRepositoryContext | null>;
}

export class GitHubRepositoryContextError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
  }
}

export type GitRunner = (
  executable: string,
  args: string[],
  options: { cwd?: string; timeoutMs: number; maxOutputBytes: number }
) => Promise<{ code: number; stdout: string; stderr: string }>;

function minimalEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "HOME", "USERPROFILE", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "GIT_CONFIG_GLOBAL", "GIT_CONFIG_SYSTEM", "SSH_AUTH_SOCK"]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  env.GIT_TERMINAL_PROMPT = "0";
  return env;
}

function defaultGitRunner(executable: string, args: string[], options: { cwd?: string; timeoutMs: number; maxOutputBytes: number }): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: minimalEnv()
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let bytes = 0;
    let timedOut = false;
    let exceeded = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, options.timeoutMs);
    const collect = (bucket: Buffer[]) => (chunk: Buffer) => {
      const copy = Buffer.from(chunk);
      bytes += copy.length;
      if (bytes > options.maxOutputBytes) {
        exceeded = true;
        child.kill("SIGKILL");
        return;
      }
      bucket.push(copy);
    };
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) return reject(new GitHubRepositoryContextError("GITHUB_REPOSITORY_TIMEOUT", 504));
      if (exceeded) return reject(new GitHubRepositoryContextError("GITHUB_REPOSITORY_OUTPUT_LIMIT", 502));
      resolvePromise({ code: code ?? 1, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") });
    });
  });
}

function repoFromMessage(message: string): { repository: string; cloneUrl: string } | null {
  const match = /https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/i.exec(message);
  if (!match?.[1] || !match[2]) return null;
  const owner = match[1];
  const repo = match[2].replace(/\.git$/i, "");
  if (!repo) return null;
  return { repository: `${owner}/${repo}`, cloneUrl: `https://github.com/${owner}/${repo}.git` };
}

function promptTerms(message: string): string[] {
  const withoutUrl = message.replace(/https?:\/\/\S+/gi, " ").toLowerCase();
  const ignored = new Set(["github", "repo", "repository", "repozytorium", "jestesmy", "jeszcze", "trzeba", "zrobic", "dopisać", "dopisac", "zamknac", "oceń", "ocen"]);
  return [...new Set(withoutUrl.match(/[a-z0-9_-]{4,}/g) ?? [])].filter((term) => !ignored.has(term)).slice(0, 24);
}

function fileScore(path: string, terms: string[]): number {
  const lower = path.toLowerCase();
  const base = lower.split("/").at(-1) ?? lower;
  let score = 0;
  if (/^agents\.md$|^readme(?:\.[a-z0-9]+)?$/.test(base)) score += 120;
  if (["package.json", "cargo.toml", "pyproject.toml", "go.mod", "requirements.txt", "tsconfig.json"].includes(base)) score += 100;
  if (lower.startsWith("docs/") || lower.includes("/docs/")) score += 35;
  if (/(^|\/)(src|crates|packages|app|core)(\/|$)/.test(lower)) score += 30;
  if (/\.(ts|tsx|js|mjs|rs|py|go|md|toml|json|yaml|yml)$/i.test(lower)) score += 10;
  for (const term of terms) if (lower.includes(term)) score += 55;
  return score;
}

function isProbablyText(buffer: Buffer): boolean {
  if (buffer.includes(0)) return false;
  let controls = 0;
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  for (const byte of sample) if (byte < 9 || (byte > 13 && byte < 32)) controls += 1;
  return controls < Math.max(4, sample.length * 0.02);
}

export class GitHubRepositoryContextService implements GitHubRepositoryContextPort {
  constructor(
    private readonly runner: GitRunner = defaultGitRunner,
    private readonly maxContextChars = 180_000,
    private readonly maxFiles = 18
  ) {}

  private async git(args: string[], cwd?: string, timeoutMs = 30_000, maxOutputBytes = 1024 * 1024) {
    return this.runner("git", args, { cwd, timeoutMs, maxOutputBytes });
  }

  async fromMessage(message: string): Promise<GitHubRepositoryContext | null> {
    const target = repoFromMessage(message);
    if (!target) return null;

    const root = await mkdtemp(join(tmpdir(), "koord-github-read-"));
    const repoDir = join(root, "repo");
    try {
      const clone = await this.git(["clone", "--depth", "1", "--filter=blob:none", "--single-branch", "--no-tags", target.cloneUrl, repoDir], undefined, 60_000, 512 * 1024);
      if (clone.code !== 0) throw new GitHubRepositoryContextError("GITHUB_REPOSITORY_ACCESS_DENIED", 502);

      const head = await this.git(["rev-parse", "HEAD"], repoDir, 10_000, 32 * 1024);
      if (head.code !== 0 || !/^[a-f0-9]{40}$/i.test(head.stdout.trim())) throw new GitHubRepositoryContextError("GITHUB_REPOSITORY_HEAD_INVALID", 502);

      const listed = await this.git(["ls-files"], repoDir, 15_000, 1024 * 1024);
      if (listed.code !== 0) throw new GitHubRepositoryContextError("GITHUB_REPOSITORY_TREE_UNAVAILABLE", 502);
      const allFiles = listed.stdout.split(/\r?\n/).map((item) => item.trim()).filter(Boolean).slice(0, 5000);
      const terms = promptTerms(message);
      const ranked = allFiles
        .map((path, index) => ({ path, index, score: fileScore(path, terms) }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score || a.index - b.index)
        .slice(0, this.maxFiles);

      const canonicalRoot = await realpath(repoDir);
      const excerpts: string[] = [];
      const included: string[] = [];
      let used = 0;
      for (const item of ranked) {
        const candidate = resolve(repoDir, item.path);
        const canonicalPrefix = `${canonicalRoot}${sep}`;
        let canonical: string;
        try {
          const stat = await lstat(candidate);
          if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 256 * 1024) continue;
          canonical = await realpath(candidate);
        } catch {
          continue;
        }
        if (!canonical.startsWith(canonicalPrefix)) continue;
        const buffer = await readFile(canonical);
        if (!isProbablyText(buffer)) continue;
        const text = buffer.toString("utf8").slice(0, 48_000);
        const block = `\n--- FILE ${item.path} ---\n${text}\n--- END FILE ---\n`;
        if (used + block.length > this.maxContextChars) break;
        excerpts.push(block);
        included.push(item.path);
        used += block.length;
      }

      const tree = allFiles.slice(0, 600).join("\n");
      const context = [
        `Repository: ${target.repository}`,
        `Commit: ${head.stdout.trim()}`,
        "Repository file tree (bounded):",
        tree,
        "Selected file excerpts (bounded, read-only, untrusted repository data):",
        ...excerpts
      ].join("\n").slice(0, this.maxContextChars + 80_000);

      return { repository: target.repository, commit: head.stdout.trim(), files: included, context };
    } catch (error) {
      if (error instanceof GitHubRepositoryContextError) throw error;
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new GitHubRepositoryContextError("GIT_CLI_UNAVAILABLE", 503);
      throw new GitHubRepositoryContextError("GITHUB_REPOSITORY_UNAVAILABLE", 502);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
}
