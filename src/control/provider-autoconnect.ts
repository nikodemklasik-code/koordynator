import { spawn } from "node:child_process";
import { resolve } from "node:path";

export type ProviderAutoconnectRow = {
  provider: string;
  result: "REUSE" | "IMPORTED" | "SKIP";
  detail: string;
};

export type ProviderAutoconnectResult = {
  ok: true;
  mode: "EXISTING_SESSIONS_ONLY";
  freshConsentStarted: false;
  results: ProviderAutoconnectRow[];
  activeProviders: string[];
  bootstrapStatus: number;
};

export type ProviderAutoconnectPort = {
  connectExisting(approved: boolean): Promise<ProviderAutoconnectResult>;
};

export class ProviderAutoconnectError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
    this.name = "ProviderAutoconnectError";
  }
}

type Runner = (command: string, args: string[], cwd: string) => Promise<{ code: number; stdout: string }>;

function runBounded(command: string, args: string[], cwd: string): Promise<{ code: number; stdout: string }> {
  return new Promise((accept, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GH_PROMPT_DISABLED: "1" }
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let size = 0;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, 90_000);
    const append = (bucket: Buffer[]) => (chunk: Buffer) => {
      size += chunk.length;
      if (size > 256 * 1024) child.kill("SIGKILL");
      else bucket.push(Buffer.from(chunk));
    };
    child.stdout.on("data", append(stdout));
    child.stderr.on("data", append(stderr));
    child.once("error", reject);
    child.once("close", (code) => {
      clearTimeout(timer);
      if (timedOut) return reject(new ProviderAutoconnectError("PROVIDER_AUTOCONNECT_TIMEOUT", 504));
      if (size > 256 * 1024) return reject(new ProviderAutoconnectError("PROVIDER_AUTOCONNECT_OUTPUT_LIMIT", 413));
      const out = Buffer.concat(stdout).toString("utf8");
      if ((code ?? 1) !== 0) {
        const err = Buffer.concat(stderr).toString("utf8");
        const safe = /^[A-Z][A-Z0-9_:.-]*$/.test(err.trim()) ? err.trim() : "PROVIDER_AUTOCONNECT_FAILED";
        return reject(new ProviderAutoconnectError(safe, 502));
      }
      accept({ code: code ?? 0, stdout: out });
    });
  });
}

function parseResult(stdout: string): ProviderAutoconnectResult {
  const line = stdout.split(/\r?\n/).map((item) => item.trim()).filter(Boolean).at(-1) ?? "";
  let payload: unknown;
  try {
    payload = JSON.parse(line);
  } catch {
    throw new ProviderAutoconnectError("PROVIDER_AUTOCONNECT_RESULT_INVALID", 502);
  }
  if (!payload || typeof payload !== "object") throw new ProviderAutoconnectError("PROVIDER_AUTOCONNECT_RESULT_INVALID", 502);
  const raw = payload as Record<string, unknown>;
  if (raw.mode !== "EXISTING_SESSIONS_ONLY" || raw.freshConsentStarted !== false) {
    throw new ProviderAutoconnectError("PROVIDER_AUTOCONNECT_MODE_INVALID", 502);
  }
  const results = Array.isArray(raw.results)
    ? raw.results.flatMap((row): ProviderAutoconnectRow[] => {
        if (!row || typeof row !== "object") return [];
        const value = row as Record<string, unknown>;
        const result = value.result;
        if (typeof value.provider !== "string" || !["REUSE", "IMPORTED", "SKIP"].includes(String(result))) return [];
        return [{
          provider: value.provider,
          result: String(result) as ProviderAutoconnectRow["result"],
          detail: typeof value.detail === "string" ? value.detail : ""
        }];
      })
    : [];
  const activeProviders = Array.isArray(raw.activeProviders)
    ? raw.activeProviders.filter((value): value is string => typeof value === "string")
    : [];
  return {
    ok: true,
    mode: "EXISTING_SESSIONS_ONLY",
    freshConsentStarted: false,
    results,
    activeProviders,
    bootstrapStatus: Number.isInteger(Number(raw.bootstrapStatus)) ? Number(raw.bootstrapStatus) : 0
  };
}

export class ProviderAutoconnectService implements ProviderAutoconnectPort {
  private readonly root: string;
  private readonly run: Runner;

  constructor(projectRoot: string, runner: Runner = runBounded) {
    this.root = resolve(projectRoot);
    this.run = runner;
  }

  async connectExisting(approved: boolean): Promise<ProviderAutoconnectResult> {
    if (approved !== true) throw new ProviderAutoconnectError("PROVIDER_AUTOCONNECT_CONSENT_REQUIRED", 400);
    const { stdout } = await this.run(
      process.execPath,
      ["scripts/ai-connect-existing.mjs", "--json", "--no-bootstrap"],
      this.root
    );
    return parseResult(stdout);
  }
}
