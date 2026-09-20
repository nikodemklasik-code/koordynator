import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type {
  HllAuthorityCommitRequest,
  HllAuthorityCommitResponse,
  HllAuthorityRequest,
  HllAuthorityResponse,
  HllAuthorityTransport
} from "./hll-authority-adapter.js";

export type HllSubprocessCommand = {
  executable: string;
  args: string[];
  cwd?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
};

type AuthorityEnvelope<T> =
  | { ok: true; response: T }
  | { ok: false; error?: { type?: string; message?: string } };

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

function cleanCommand(input: HllSubprocessCommand): Required<Omit<HllSubprocessCommand, "cwd">> & { cwd?: string } {
  const executable = input.executable.trim();
  if (!executable) throw new Error("HLL_AUTHORITY_EXECUTABLE_REQUIRED");
  if (input.args.some((arg) => arg.includes("\0"))) throw new Error("HLL_AUTHORITY_ARG_INVALID");

  return {
    executable,
    args: [...input.args],
    timeoutMs: Math.max(1_000, Math.min(input.timeoutMs ?? 30_000, 120_000)),
    maxOutputBytes: Math.max(4_096, Math.min(input.maxOutputBytes ?? 2_000_000, 10_000_000)),
    ...(input.cwd === undefined ? {} : { cwd: input.cwd })
  };
}

function asError(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new Error(fallback);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Stateful cross-language transport to the authoritative HLL Engine.
 *
 * The Platform bridge is intentionally a long-lived JSONL process because
 * assess() creates authority-side bindings that commit() must consume from the
 * same CanonicalStore. A crash therefore poisons this transport instance:
 * silently spawning a fresh authority would destroy the assess -> commit
 * continuity and turn a state-loss bug into a counterfeit success path.
 *
 * Security / integrity properties:
 * - no shell interpolation;
 * - fixed argv supplied by trusted runtime configuration;
 * - one JSON request per stdin line;
 * - one bounded JSON envelope per stdout line;
 * - bounded stderr;
 * - per-request hard timeout;
 * - non-zero exit / malformed output / state loss fail closed;
 * - FIFO request/response binding on one authority process.
 */
export class SubprocessHllAuthorityTransport implements HllAuthorityTransport {
  private readonly command: ReturnType<typeof cleanCommand>;
  private child: ChildProcessWithoutNullStreams | undefined;
  private readonly pending: PendingRequest[] = [];
  private stdoutBuffer = "";
  private stderr = Buffer.alloc(0);
  private closed = false;
  private poisoned = false;

  constructor(command: HllSubprocessCommand) {
    this.command = cleanCommand(command);
  }

  async assess(request: HllAuthorityRequest): Promise<HllAuthorityResponse> {
    return this.call<HllAuthorityResponse>(request);
  }

  async commit(request: HllAuthorityCommitRequest): Promise<HllAuthorityCommitResponse> {
    return this.call<HllAuthorityCommitResponse>(request);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    const child = this.child;
    this.child = undefined;
    this.stdoutBuffer = "";
    this.rejectPending(new Error("HLL_AUTHORITY_TRANSPORT_CLOSED"));

    if (child) {
      child.stdin.end();
      if (child.exitCode === null && !child.killed) child.kill("SIGTERM");
    }
  }

  private ensureProcess(): ChildProcessWithoutNullStreams {
    if (this.closed) throw new Error("HLL_AUTHORITY_TRANSPORT_CLOSED");
    if (this.poisoned) throw new Error("HLL_AUTHORITY_STATE_LOST");

    if (this.child && this.child.exitCode === null && !this.child.killed) {
      return this.child;
    }

    const child = spawn(this.command.executable, this.command.args, {
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      ...(this.command.cwd === undefined ? {} : { cwd: this.command.cwd }),
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        LANG: process.env.LANG,
        LC_ALL: process.env.LC_ALL,
        PYTHONUNBUFFERED: "1"
      }
    });

    this.child = child;
    this.stdoutBuffer = "";
    this.stderr = Buffer.alloc(0);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.onStdout(chunk));
    child.stderr.on("data", (chunk: Buffer | string) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8");
      this.stderr = Buffer.concat([this.stderr, bytes]);
      if (this.stderr.length > this.command.maxOutputBytes) {
        this.failProcess(new Error("HLL_AUTHORITY_STDERR_LIMIT_EXCEEDED"));
      }
    });
    child.stdin.on("error", (error) => this.failProcess(asError(error, "HLL_AUTHORITY_STDIN_FAILED")));
    child.on("error", (error) => this.failProcess(asError(error, "HLL_AUTHORITY_PROCESS_ERROR")));
    child.on("close", (code, signal) => {
      if (this.child === child) this.child = undefined;
      if (this.closed) return;
      this.poisoned = true;
      this.rejectPending(new Error(
        `HLL_AUTHORITY_PROCESS_FAILED:code=${code ?? "null"}:signal=${signal ?? "null"}:${this.stderr.toString("utf8").trim().slice(0, 4000)}`
      ));
    });

    return child;
  }

  private call<T>(request: HllAuthorityRequest | HllAuthorityCommitRequest): Promise<T> {
    const child = this.ensureProcess();

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.failProcess(new Error("HLL_AUTHORITY_TIMEOUT"));
      }, this.command.timeoutMs);

      this.pending.push({
        resolve: (value) => resolve(value as T),
        reject,
        timer
      });

      try {
        child.stdin.write(`${JSON.stringify(request)}\n`, "utf8");
      } catch (error) {
        this.failProcess(asError(error, "HLL_AUTHORITY_STDIN_FAILED"));
      }
    });
  }

  private onStdout(chunk: string): void {
    this.stdoutBuffer += chunk;

    while (true) {
      const newline = this.stdoutBuffer.indexOf("\n");
      if (newline < 0) {
        if (Buffer.byteLength(this.stdoutBuffer, "utf8") > this.command.maxOutputBytes) {
          this.failProcess(new Error("HLL_AUTHORITY_STDOUT_LIMIT_EXCEEDED"));
        }
        return;
      }

      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (!line) continue;

      if (Buffer.byteLength(line, "utf8") > this.command.maxOutputBytes) {
        this.failProcess(new Error("HLL_AUTHORITY_STDOUT_LIMIT_EXCEEDED"));
        return;
      }

      const pending = this.pending.shift();
      if (!pending) {
        this.failProcess(new Error("HLL_AUTHORITY_UNSOLICITED_RESPONSE"));
        return;
      }
      clearTimeout(pending.timer);

      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        pending.reject(new Error("HLL_AUTHORITY_INVALID_JSON"));
        this.poisonAfterProtocolFailure();
        return;
      }

      if (!isObject(parsed) || typeof parsed.ok !== "boolean") {
        pending.reject(new Error("HLL_AUTHORITY_INVALID_ENVELOPE"));
        this.poisonAfterProtocolFailure();
        return;
      }

      const envelope = parsed as AuthorityEnvelope<unknown>;
      if (!envelope.ok) {
        const type = envelope.error?.type?.trim() || "REMOTE_ERROR";
        const message = envelope.error?.message?.trim() || "authority rejected request";
        pending.reject(new Error(`HLL_AUTHORITY_REMOTE_ERROR:${type}:${message}`));
        continue;
      }

      if (!isObject(envelope.response)) {
        pending.reject(new Error("HLL_AUTHORITY_RESPONSE_NOT_OBJECT"));
        this.poisonAfterProtocolFailure();
        return;
      }

      pending.resolve(envelope.response);
    }
  }

  private poisonAfterProtocolFailure(): void {
    this.poisoned = true;
    const child = this.child;
    this.child = undefined;
    if (child && child.exitCode === null && !child.killed) child.kill("SIGKILL");
    this.rejectPending(new Error("HLL_AUTHORITY_STATE_LOST"));
  }

  private failProcess(error: Error): void {
    if (this.closed) return;
    this.poisoned = true;
    const child = this.child;
    this.child = undefined;
    if (child && child.exitCode === null && !child.killed) child.kill("SIGKILL");
    this.rejectPending(error);
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.splice(0)) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
  }
}

export function hllSubprocessCommandFromEnv(
  env: NodeJS.ProcessEnv = process.env
): HllSubprocessCommand {
  const raw = env.CORPORATION_HLL_AUTHORITY_COMMAND_JSON;
  if (!raw) throw new Error("CORPORATION_HLL_AUTHORITY_COMMAND_JSON_REQUIRED");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("CORPORATION_HLL_AUTHORITY_COMMAND_JSON_INVALID");
  }

  if (!Array.isArray(parsed) || !parsed.length || parsed.some((item) => typeof item !== "string")) {
    throw new Error("CORPORATION_HLL_AUTHORITY_COMMAND_JSON_INVALID");
  }

  const [executable, ...args] = parsed as string[];
  if (!executable) throw new Error("HLL_AUTHORITY_EXECUTABLE_REQUIRED");

  return {
    executable,
    args,
    ...(env.CORPORATION_HLL_AUTHORITY_CWD ? { cwd: env.CORPORATION_HLL_AUTHORITY_CWD } : {})
  };
}
