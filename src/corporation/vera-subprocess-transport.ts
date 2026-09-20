import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { VeraRpcMethod, VeraRpcPort } from "./vera-authority.js";

export type VeraSubprocessCommand = {
  executable: string;
  args: string[];
  cwd?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

type VeraRpcResponse = {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: {
    code?: string;
    message?: string;
  } | null;
};

function cleanCommand(input: VeraSubprocessCommand): Required<Omit<VeraSubprocessCommand, "cwd">> & { cwd?: string } {
  const executable = input.executable.trim();
  if (!executable) throw new Error("VERA_EXECUTABLE_REQUIRED");
  if (input.args.some((arg) => arg.includes("\0"))) throw new Error("VERA_ARG_INVALID");

  return {
    executable,
    args: [...input.args],
    timeoutMs: Math.max(1_000, Math.min(input.timeoutMs ?? 30_000, 120_000)),
    maxOutputBytes: Math.max(4_096, Math.min(input.maxOutputBytes ?? 2_000_000, 10_000_000)),
    ...(input.cwd === undefined ? {} : { cwd: input.cwd })
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asError(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new Error(fallback);
}

/**
 * Stateful client for the existing HLP VERA runtime:
 * core/hlp-vera/crates/vera-core-runtime/src/bin/vera-core-runtime.rs
 *
 * The Rust runtime owns capability grants, revocations, receipts, permits,
 * trusted time and the audit journal. Corporation only sends RPC requests.
 * Process loss is authority-state loss, so this instance becomes poisoned
 * rather than silently restarting with an empty VERA store.
 */
export class SubprocessVeraRpcTransport implements VeraRpcPort {
  private readonly command: ReturnType<typeof cleanCommand>;
  private child: ChildProcessWithoutNullStreams | undefined;
  private stdoutBuffer = "";
  private stderr = Buffer.alloc(0);
  private readonly pending = new Map<string, PendingRequest>();
  private closed = false;
  private poisoned = false;

  constructor(command: VeraSubprocessCommand) {
    this.command = cleanCommand(command);
  }

  async call<T = unknown>(method: VeraRpcMethod, params: Record<string, unknown>): Promise<T> {
    const child = this.ensureProcess();
    const id = `VERA-${randomUUID()}`;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.failProcess(new Error(`VERA_TIMEOUT:${method}`));
      }, this.command.timeoutMs);

      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer
      });

      try {
        child.stdin.write(`${JSON.stringify({ id, method, params })}\n`, "utf8");
      } catch (error) {
        this.failProcess(asError(error, "VERA_STDIN_FAILED"));
      }
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    const child = this.child;
    this.child = undefined;
    this.stdoutBuffer = "";
    this.rejectPending(new Error("VERA_TRANSPORT_CLOSED"));

    if (child) {
      child.stdin.end();
      if (child.exitCode === null && !child.killed) child.kill("SIGTERM");
    }
  }

  private ensureProcess(): ChildProcessWithoutNullStreams {
    if (this.closed) throw new Error("VERA_TRANSPORT_CLOSED");
    if (this.poisoned) throw new Error("VERA_AUTHORITY_STATE_LOST");

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
        LC_ALL: process.env.LC_ALL
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
        this.failProcess(new Error("VERA_STDERR_LIMIT_EXCEEDED"));
      }
    });
    child.stdin.on("error", (error) => this.failProcess(asError(error, "VERA_STDIN_FAILED")));
    child.on("error", (error) => this.failProcess(asError(error, "VERA_PROCESS_ERROR")));
    child.on("close", (code, signal) => {
      if (this.child === child) this.child = undefined;
      if (this.closed) return;
      this.poisoned = true;
      this.rejectPending(new Error(
        `VERA_PROCESS_FAILED:code=${code ?? "null"}:signal=${signal ?? "null"}:${this.stderr.toString("utf8").trim().slice(0, 4000)}`
      ));
    });

    return child;
  }

  private onStdout(chunk: string): void {
    this.stdoutBuffer += chunk;

    while (true) {
      const newline = this.stdoutBuffer.indexOf("\n");
      if (newline < 0) {
        if (Buffer.byteLength(this.stdoutBuffer, "utf8") > this.command.maxOutputBytes) {
          this.failProcess(new Error("VERA_STDOUT_LIMIT_EXCEEDED"));
        }
        return;
      }

      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (!line) continue;

      if (Buffer.byteLength(line, "utf8") > this.command.maxOutputBytes) {
        this.failProcess(new Error("VERA_STDOUT_LIMIT_EXCEEDED"));
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        this.failProcess(new Error("VERA_INVALID_JSON"));
        return;
      }
      if (!isObject(parsed) || typeof parsed.id !== "string" || typeof parsed.ok !== "boolean") {
        this.failProcess(new Error("VERA_INVALID_RESPONSE"));
        return;
      }

      const response = parsed as VeraRpcResponse;
      const pending = this.pending.get(response.id);
      if (!pending) {
        this.failProcess(new Error("VERA_UNSOLICITED_RESPONSE"));
        return;
      }
      this.pending.delete(response.id);
      clearTimeout(pending.timer);

      if (!response.ok) {
        const code = response.error?.code?.trim() || "CORE_ERROR";
        const message = response.error?.message?.trim() || "VERA request denied";
        pending.reject(new Error(`VERA_REMOTE_ERROR:${code}:${message}`));
        continue;
      }

      if (response.result === undefined) {
        pending.reject(new Error("VERA_RESULT_MISSING"));
        continue;
      }

      pending.resolve(response.result);
    }
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
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }
}

export function veraSubprocessCommandFromEnv(
  env: NodeJS.ProcessEnv = process.env
): VeraSubprocessCommand {
  const raw = env.CORPORATION_VERA_COMMAND_JSON;
  if (!raw) throw new Error("CORPORATION_VERA_COMMAND_JSON_REQUIRED");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("CORPORATION_VERA_COMMAND_JSON_INVALID");
  }

  if (!Array.isArray(parsed) || !parsed.length || parsed.some((item) => typeof item !== "string")) {
    throw new Error("CORPORATION_VERA_COMMAND_JSON_INVALID");
  }

  const [executable, ...args] = parsed as string[];
  if (!executable) throw new Error("VERA_EXECUTABLE_REQUIRED");

  return {
    executable,
    args,
    ...(env.CORPORATION_VERA_CWD ? { cwd: env.CORPORATION_VERA_CWD } : {})
  };
}
