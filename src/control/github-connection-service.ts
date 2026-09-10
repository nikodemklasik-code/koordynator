import { spawn } from "node:child_process";

export type GitHubConnectionState = "CONNECTED" | "AUTH_REQUIRED" | "UNAVAILABLE" | "DEGRADED";
export type GitHubConnectionMethod = "GH_CLI" | "GIT_CREDENTIAL" | "NONE";

export type GitHubConnectionStatus = {
  provider: "github";
  hostname: "github.com";
  state: GitHubConnectionState;
  cliAvailable: boolean;
  authenticated: boolean;
  gitConfigured: boolean;
  checkedAt: string;
  connectionMethod?: GitHubConnectionMethod;
  repositoryAccess?: boolean;
  remote?: string;
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
  for (const key of ["PATH", "HOME", "USERPROFILE", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "BROWSER", "TERM", "GH_CONFIG_DIR", "GIT_CONFIG_GLOBAL", "GIT_CONFIG_SYSTEM"]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  env.GIT_TERMINAL_PROMPT = "0";
  return env;
}

function defaultRunner(executable: string, args: string[], options: { interactive: boolean; timeoutMs: number }): Promise<GitHubCommandResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, args, {
      shell: false,
      env: minimalEnv(),
      stdio: options.interactive ? "inherit" : ["ignore", "pipe", "pipe"]
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let timedOut = false;
    let outputExceeded = false;
    const maxOutputBytes = 128 * 1024;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, options.timeoutMs);

    const collect = (target: Buffer[]) => (chunk: Buffer) => {
      const copy = Buffer.from(chunk);
      outputBytes += copy.length;
      if (outputBytes > maxOutputBytes) {
        outputExceeded = true;
        child.kill("SIGKILL");
        return;
      }
      target.push(copy);
    };

    if (!options.interactive) {
      child.stdout?.on("data", collect(stdout));
      child.stderr?.on("data", collect(stderr));
    }

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) return reject(new GitHubConnectionError("GITHUB_CONNECT_TIMEOUT", 504));
      if (outputExceeded) return reject(new GitHubConnectionError("GITHUB_OUTPUT_LIMIT_EXCEEDED", 502));
      resolvePromise({
        code: code ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8")
      });
    });
  });
}

function isGitHubRemote(value: string): boolean {
  const remote = value.trim();
  return /^https?:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?\/?$/i.test(remote)
    || /^git@github\.com:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/i.test(remote)
    || /^ssh:\/\/git@github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?\/?$/i.test(remote);
}

export interface GitHubConnectionPort {
  status(force?: boolean): Promise<GitHubConnectionStatus>;
  connect(approved: boolean): Promise<GitHubConnectionStatus>;
}

export class GitHubConnectionService implements GitHubConnectionPort {
  private cached: { value: GitHubConnectionStatus; expiresAt: number } | null = null;
  private connecting: Promise<GitHubConnectionStatus> | null = null;

  constructor(
    private readonly runner: GitHubCommandRunner = defaultRunner,
    private readonly cacheTtlMs = 10_000
  ) {}

  private async command(executable: string, args: string[], interactive = false, timeoutMs = 10_000): Promise<GitHubCommandResult> {
    return this.runner(executable, args, { interactive, timeoutMs });
  }

  private async gh(args: string[], interactive = false, timeoutMs = 10_000): Promise<GitHubCommandResult> {
    return this.command("gh", args, interactive, timeoutMs);
  }

  private remember(value: GitHubConnectionStatus): GitHubConnectionStatus {
    this.cached = { value, expiresAt: Date.now() + this.cacheTtlMs };
    return value;
  }

  private async gitCredentialStatus(checkedAt: string): Promise<GitHubConnectionStatus | null> {
    try {
      const version = await this.command("git", ["--version"]);
      if (version.code !== 0) return null;
      const remoteResult = await this.command("git", ["config", "--get", "remote.origin.url"]);
      const remote = remoteResult.stdout.trim();
      if (remoteResult.code !== 0 || !isGitHubRemote(remote)) return null;
      const probe = await this.command("git", ["ls-remote", "--exit-code", "origin", "HEAD"], false, 15_000);
      if (probe.code !== 0) return null;
      return {
        provider: "github",
        hostname: "github.com",
        state: "CONNECTED",
        cliAvailable: false,
        authenticated: false,
        gitConfigured: true,
        checkedAt,
        connectionMethod: "GIT_CREDENTIAL",
        repositoryAccess: true,
        remote
      };
    } catch {
      return null;
    }
  }

  async status(force = false): Promise<GitHubConnectionStatus> {
    const nowMs = Date.now();
    if (!force && this.cached && this.cached.expiresAt > nowMs) return this.cached.value;
    const checkedAt = new Date().toISOString();

    let version: GitHubCommandResult | null = null;
    try {
      version = await this.gh(["--version"]);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        const gitFallback = await this.gitCredentialStatus(checkedAt);
        if (gitFallback) return this.remember(gitFallback);
        return this.remember({
          provider: "github",
          hostname: "github.com",
          state: "DEGRADED",
          cliAvailable: false,
          authenticated: false,
          gitConfigured: false,
          checkedAt,
          connectionMethod: "NONE",
          repositoryAccess: false
        });
      }
    }

    if (!version || version.code !== 0) {
      const gitFallback = await this.gitCredentialStatus(checkedAt);
      if (gitFallback) return this.remember(gitFallback);
      return this.remember({
        provider: "github",
        hostname: "github.com",
        state: "UNAVAILABLE",
        cliAvailable: false,
        authenticated: false,
        gitConfigured: false,
        checkedAt,
        connectionMethod: "NONE",
        repositoryAccess: false
      });
    }

    let auth: GitHubCommandResult;
    try {
      auth = await this.gh(["auth", "status", "--hostname", "github.com"]);
    } catch {
      const gitFallback = await this.gitCredentialStatus(checkedAt);
      if (gitFallback) return this.remember({ ...gitFallback, cliAvailable: true });
      return this.remember({
        provider: "github",
        hostname: "github.com",
        state: "DEGRADED",
        cliAvailable: true,
        authenticated: false,
        gitConfigured: false,
        checkedAt,
        connectionMethod: "NONE",
        repositoryAccess: false
      });
    }

    const authenticated = auth.code === 0;
    if (!authenticated) {
      const gitFallback = await this.gitCredentialStatus(checkedAt);
      if (gitFallback) return this.remember({ ...gitFallback, cliAvailable: true });
    }
    return this.remember({
      provider: "github",
      hostname: "github.com",
      state: authenticated ? "CONNECTED" : "AUTH_REQUIRED",
      cliAvailable: true,
      authenticated,
      gitConfigured: authenticated,
      checkedAt,
      connectionMethod: authenticated ? "GH_CLI" : "NONE",
      repositoryAccess: authenticated
    });
  }

  private async connectApproved(): Promise<GitHubConnectionStatus> {
    const before = await this.status(true);
    if (before.state === "CONNECTED" && before.repositoryAccess !== false) return before;
    if (!before.cliAvailable) throw new GitHubConnectionError("GITHUB_CLI_UNAVAILABLE", 503);

    if (!before.authenticated) {
      const login = await this.gh([
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

    const setup = await this.gh(["auth", "setup-git", "--hostname", "github.com"], false, 20_000);
    if (setup.code !== 0) throw new GitHubConnectionError("GITHUB_GIT_SETUP_FAILED", 502);

    this.cached = null;
    const after = await this.status(true);
    if (!after.authenticated) throw new GitHubConnectionError("GITHUB_AUTH_FAILED", 502);
    return this.remember({ ...after, gitConfigured: true, state: "CONNECTED", connectionMethod: "GH_CLI", repositoryAccess: true });
  }

  async connect(approved: boolean): Promise<GitHubConnectionStatus> {
    if (!approved) throw new GitHubConnectionError("GITHUB_CONSENT_REQUIRED", 400);
    if (this.connecting) return this.connecting;
    this.connecting = this.connectApproved();
    try {
      return await this.connecting;
    } finally {
      this.connecting = null;
    }
  }
}
