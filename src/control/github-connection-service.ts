import { spawn } from "node:child_process";

export type GitHubConnectionState = "CONNECTED" | "AUTH_REQUIRED" | "UNAVAILABLE" | "DEGRADED";

export type GitHubConnectionStatus = {
  provider: "github";
  hostname: "github.com";
  state: GitHubConnectionState;
  cliAvailable: boolean;
  authenticated: boolean;
  gitConfigured: boolean;
  checkedAt: string;
};

export type GitHubCommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

export type GitHubCommandRunner = (
  executable: string,
  args: string[],
  options: { interactive: boolean; timeoutMs: number }
) => Promise<GitHubCommandResult>;

export class GitHubConnectionError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
  }
}

function minimalEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "HOME", "USERPROFILE", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "BROWSER", "TERM", "GH_CONFIG_DIR"]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return env;
}

function defaultRunner(executable: string, args: string[], options: { interactive: boolean; timeoutMs: number }): Promise<GitHubCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      shell: false,
      env: minimalEnv(),
      stdio: options.interactive ? "inherit" : ["ignore", "pipe", "pipe"]
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, options.timeoutMs);

    if (!options.interactive) {
      child.stdout?.on("data", (chunk: Buffer) => stdout.push(Buffer.from(chunk)));
      child.stderr?.on("data", (chunk: Buffer) => stderr.push(Buffer.from(chunk)));
    }

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) return reject(new GitHubConnectionError("GITHUB_CONNECT_TIMEOUT", 504));
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8")
      });
    });
  });
}

export interface GitHubConnectionPort {
  status(force?: boolean): Promise<GitHubConnectionStatus>;
  connect(approved: boolean): Promise<GitHubConnectionStatus>;
}

export class GitHubConnectionService implements GitHubConnectionPort {
  private cached: { value: GitHubConnectionStatus; expiresAt: number } | null = null;

  constructor(
    private readonly runner: GitHubCommandRunner = defaultRunner,
    private readonly cacheTtlMs = 10_000
  ) {}

  private async command(args: string[], interactive = false, timeoutMs = 10_000): Promise<GitHubCommandResult> {
    return this.runner("gh", args, { interactive, timeoutMs });
  }

  async status(force = false): Promise<GitHubConnectionStatus> {
    const nowMs = Date.now();
    if (!force && this.cached && this.cached.expiresAt > nowMs) return this.cached.value;
    const checkedAt = new Date().toISOString();

    let version: GitHubCommandResult;
    try {
      version = await this.command(["--version"]);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        const unavailable: GitHubConnectionStatus = {
          provider: "github",
          hostname: "github.com",
          state: "UNAVAILABLE",
          cliAvailable: false,
          authenticated: false,
          gitConfigured: false,
          checkedAt
        };
        this.cached = { value: unavailable, expiresAt: nowMs + this.cacheTtlMs };
        return unavailable;
      }
      const degraded: GitHubConnectionStatus = {
        provider: "github",
        hostname: "github.com",
        state: "DEGRADED",
        cliAvailable: false,
        authenticated: false,
        gitConfigured: false,
        checkedAt
      };
      this.cached = { value: degraded, expiresAt: nowMs + this.cacheTtlMs };
      return degraded;
    }

    if (version.code !== 0) {
      const unavailable: GitHubConnectionStatus = {
        provider: "github",
        hostname: "github.com",
        state: "UNAVAILABLE",
        cliAvailable: false,
        authenticated: false,
        gitConfigured: false,
        checkedAt
      };
      this.cached = { value: unavailable, expiresAt: nowMs + this.cacheTtlMs };
      return unavailable;
    }

    const auth = await this.command(["auth", "status", "--hostname", "github.com"]);
    const authenticated = auth.code === 0;
    const value: GitHubConnectionStatus = {
      provider: "github",
      hostname: "github.com",
      state: authenticated ? "CONNECTED" : "AUTH_REQUIRED",
      cliAvailable: true,
      authenticated,
      gitConfigured: authenticated,
      checkedAt
    };
    this.cached = { value, expiresAt: nowMs + this.cacheTtlMs };
    return value;
  }

  async connect(approved: boolean): Promise<GitHubConnectionStatus> {
    if (!approved) throw new GitHubConnectionError("GITHUB_CONSENT_REQUIRED", 400);
    const before = await this.status(true);
    if (!before.cliAvailable) throw new GitHubConnectionError("GITHUB_CLI_UNAVAILABLE", 503);

    if (!before.authenticated) {
      const login = await this.command([
        "auth",
        "login",
        "--hostname",
        "github.com",
        "--git-protocol",
        "https",
        "--web",
        "--skip-ssh-key"
      ], true, 5 * 60_000);
      if (login.code !== 0) throw new GitHubConnectionError("GITHUB_AUTH_FAILED", 502);
    }

    const setup = await this.command(["auth", "setup-git", "--hostname", "github.com"], false, 20_000);
    if (setup.code !== 0) throw new GitHubConnectionError("GITHUB_GIT_SETUP_FAILED", 502);

    this.cached = null;
    const after = await this.status(true);
    if (!after.authenticated) throw new GitHubConnectionError("GITHUB_AUTH_FAILED", 502);
    return { ...after, gitConfigured: true, state: "CONNECTED" };
  }
}
