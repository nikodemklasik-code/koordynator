/**
 * Hermes interactive session for Control UI: a real PTY (macOS `script`,
 * optional node-pty) behind /api/hermes/pty. Live Chat stays conversation-only.
 * Spawn is gated on the explicit terminal grant.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { HermesGrantStore } from "./hermes-grant-store.js";

export type PtyHandle = {
  pid?: number;
  write(data: string | Buffer): void;
  resize(cols: number, rows: number): void;
  onData(listener: (chunk: Buffer) => void): void;
  onExit(listener: (code: number) => void): void;
  kill(): void;
};

export type HermesLaunchSpec = {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  close?: () => Promise<void>;
};

export type HermesPtyHooks = {
  spawn?: (spec: HermesLaunchSpec & { cols: number; rows: number }) => PtyHandle;
  prepare?: () => Promise<HermesLaunchSpec>;
};

export type HermesPtyEvent =
  | { type: "out"; text: string }
  | { type: "exit"; code: number };

export class HermesPtyError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
    this.name = "HermesPtyError";
  }
}

const SESSION_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HERMES_MIN_COLS = 100;
const HERMES_MIN_ROWS = 32;

function boundSize(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n)) return fallback;
  return Math.min(300, Math.max(8, n));
}

function hermesSize(size: { cols?: unknown; rows?: unknown }): { cols: number; rows: number } {
  return {
    cols: Math.max(HERMES_MIN_COLS, boundSize(size.cols, 120)),
    rows: Math.max(HERMES_MIN_ROWS, boundSize(size.rows, 40))
  };
}

function shellQuote(value: string): string {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/**
 * Build the `script` argv used by the pipe-backed PTY adapter.
 * `script` gives Hermes a slave PTY, but because Control owns pipes rather than
 * the master fd, later ioctl resize is unavailable. Set the slave dimensions
 * from inside the PTY before exec so rich/TUI rendering never starts at 80x24
 * (or smaller) and emits `Window too small...`.
 */
export function buildScriptPtyArgs(
  spec: HermesLaunchSpec & { cols?: number; rows?: number },
  platform: NodeJS.Platform = process.platform
): { args: string[]; cols: number; rows: number } {
  const size = hermesSize(spec);
  const command = [spec.command, ...spec.args].map(shellQuote).join(" ");
  const wrapped = `stty cols ${size.cols} rows ${size.rows} 2>/dev/null || true; exec ${command}`;
  const args = platform === "darwin"
    ? ["-q", "/dev/null", "/bin/sh", "-lc", wrapped]
    : ["-q", "-f", "-c", wrapped, "/dev/null"];
  return { args, ...size };
}

/** macOS `script` allocates a PTY for the child. Linux uses `script -c`. */
export function spawnScriptPty(spec: HermesLaunchSpec & { cols?: number; rows?: number }): PtyHandle {
  const launch = buildScriptPtyArgs(spec);
  const child = spawn("script", launch.args, {
    cwd: spec.cwd,
    env: {
      ...spec.env,
      TERM: spec.env.TERM || "xterm-256color",
      COLUMNS: String(launch.cols),
      LINES: String(launch.rows)
    },
    stdio: ["pipe", "pipe", "pipe"]
  });
  const listeners: Array<(chunk: Buffer) => void> = [];
  const exitListeners: Array<(code: number) => void> = [];
  const forward = (chunk: Buffer) => { for (const listener of listeners) listener(chunk); };
  child.stdout?.on("data", forward);
  child.stderr?.on("data", forward);
  child.once("exit", (code) => {
    for (const listener of exitListeners) listener(code ?? 0);
  });
  return {
    ...(child.pid === undefined ? {} : { pid: child.pid }),
    write(data) { child.stdin?.write(data); },
    resize() { /* pipe-wrapped script has no master fd to ioctl; initial stty is authoritative */ },
    onData(listener) { listeners.push(listener); },
    onExit(listener) { exitListeners.push(listener); },
    kill() {
      try { child.kill("SIGTERM"); } catch { /* already gone */ }
    }
  };
}

export class HermesPtySession {
  private readonly grants: HermesGrantStore;
  private handle: PtyHandle | null = null;
  private sessionId: string | null = null;
  private launch: HermesLaunchSpec | null = null;
  private readonly subscribers = new Map<string, Set<(event: HermesPtyEvent) => void>>();
  private cols = HERMES_MIN_COLS;
  private rows = HERMES_MIN_ROWS;

  constructor(
    private readonly options: {
      stateDir: string;
      spawn?: HermesPtyHooks["spawn"];
      prepare: () => Promise<HermesLaunchSpec>;
    }
  ) {
    this.grants = new HermesGrantStore(options.stateDir);
  }

  async start(size: { cols?: unknown; rows?: unknown } = {}): Promise<{ sessionId: string; cols: number; rows: number }> {
    const grant = await this.grants.status();
    if (!grant.terminal) throw new HermesPtyError("HERMES_TERMINAL_REQUIRED", 403);
    this.stop();
    const bounded = hermesSize(size);
    this.cols = bounded.cols;
    this.rows = bounded.rows;
    const spec = await this.options.prepare();
    const spawnPty = this.options.spawn ?? ((launch: HermesLaunchSpec & { cols: number; rows: number }) => spawnScriptPty(launch));
    const handle = spawnPty({ ...spec, cols: this.cols, rows: this.rows });
    const sessionId = randomUUID();
    this.handle = handle;
    this.sessionId = sessionId;
    this.launch = spec;
    handle.onData((chunk) => this.emit(sessionId, { type: "out", text: chunk.toString("utf8") }));
    handle.onExit((code) => {
      this.emit(sessionId, { type: "exit", code });
      if (this.sessionId === sessionId) {
        this.handle = null;
        this.sessionId = null;
      }
    });
    try { handle.resize(this.cols, this.rows); } catch { /* optional */ }
    return { sessionId, cols: this.cols, rows: this.rows };
  }

  status(): { running: boolean; sessionId: string | null; cols: number; rows: number } {
    return { running: this.sessionId !== null, sessionId: this.sessionId, cols: this.cols, rows: this.rows };
  }

  write(sessionId: string, data: string): void {
    const handle = this.require(sessionId);
    if (typeof data !== "string") throw new HermesPtyError("HERMES_PTY_INPUT_INVALID", 400);
    if (Buffer.byteLength(data, "utf8") > 8 * 1024) throw new HermesPtyError("HERMES_PTY_INPUT_TOO_LARGE", 413);
    handle.write(data);
  }

  resize(sessionId: string, cols: unknown, rows: unknown): { cols: number; rows: number } {
    const handle = this.require(sessionId);
    const bounded = hermesSize({ cols, rows });
    this.cols = bounded.cols;
    this.rows = bounded.rows;
    handle.resize(this.cols, this.rows);
    return { cols: this.cols, rows: this.rows };
  }

  stop(sessionId?: string): { stopped: boolean } {
    if (sessionId && this.sessionId && sessionId !== this.sessionId) {
      throw new HermesPtyError("HERMES_PTY_NOT_FOUND", 404);
    }
    if (!this.handle) return { stopped: false };
    try { this.handle.kill(); } catch { /* gone */ }
    const close = this.launch?.close;
    this.handle = null;
    this.sessionId = null;
    this.launch = null;
    void close?.();
    return { stopped: true };
  }

  subscribe(sessionId: string, listener: (event: HermesPtyEvent) => void): () => void {
    this.require(sessionId);
    const set = this.subscribers.get(sessionId) ?? new Set();
    set.add(listener);
    this.subscribers.set(sessionId, set);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.subscribers.delete(sessionId);
    };
  }

  assertSession(sessionId: string): string {
    if (!SESSION_RE.test(sessionId)) throw new HermesPtyError("HERMES_PTY_NOT_FOUND", 404);
    this.require(sessionId);
    return sessionId;
  }

  private require(sessionId: string): PtyHandle {
    if (!SESSION_RE.test(sessionId) || sessionId !== this.sessionId || !this.handle) {
      throw new HermesPtyError("HERMES_PTY_NOT_FOUND", 404);
    }
    return this.handle;
  }

  private emit(sessionId: string, event: HermesPtyEvent): void {
    for (const listener of this.subscribers.get(sessionId) ?? []) listener(event);
  }
}
