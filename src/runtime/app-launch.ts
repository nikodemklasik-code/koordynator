#!/usr/bin/env node
import { spawn } from "node:child_process";
import { platform } from "node:os";
import { resolve } from "node:path";
import { bootstrapAi } from "./ai-bootstrap.js";
import { bootstrapFreeSwarm } from "./free-swarm.js";
import { loadLocalConfig } from "./local-config.js";
import { chooseControlPort, isKoordynatorControl } from "./control-instance.js";

function browserUrl(host: string, port: number): string {
  const safeHost = host === "0.0.0.0"
    ? "127.0.0.1"
    : host === "::"
      ? "[::1]"
      : host.includes(":") && !host.startsWith("[")
        ? `[${host}]`
        : host;
  return `http://${safeHost}:${port}`;
}

function openUrl(url: string): void {
  const opener = platform() === "darwin"
    ? ["open", [url]] as const
    : platform() === "win32"
      ? ["cmd", ["/c", "start", "", url]] as const
      : ["xdg-open", [url]] as const;
  const child = spawn(opener[0], opener[1], {
    detached: true,
    stdio: "ignore",
    env: process.env
  });
  child.unref();
}

function controlPort(): number {
  const value = Number(process.env.KOORDYNATOR_CONTROL_PORT ?? "8787");
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error("INVALID_CONTROL_PORT");
  return value;
}

async function main(): Promise<void> {
  loadLocalConfig();

  const host = process.env.KOORDYNATOR_CONTROL_HOST ?? "127.0.0.1";
  const preferredPort = controlPort();
  const preferredUrl = browserUrl(host, preferredPort);

  // Fast path: if Koordynator is already running, reuse it instead of probing AI
  // and then crashing with EADDRINUSE.
  if (await isKoordynatorControl(preferredUrl)) {
    console.log(`KOORDYNATOR_CONTROL_REUSE ${preferredUrl}`);
    openUrl(preferredUrl);
    return;
  }

  // 8787 is the documented/default port and appears in .env.example, so merely
  // loading KOORDYNATOR_CONTROL_PORT=8787 must not disable automatic fallback.
  // Only a non-default configured value is treated as an operator-pinned port.
  const explicitPort = process.env.KOORDYNATOR_CONTROL_PORT !== undefined && preferredPort !== 8787;
  const port = await chooseControlPort(host, preferredPort, explicitPort);
  const url = browserUrl(host, port);
  if (port !== preferredPort) {
    process.env.KOORDYNATOR_CONTROL_PORT = String(port);
    console.log(`KOORDYNATOR_CONTROL_PORT_BUSY ${preferredPort}; using ${port}`);
  }

  // Reuse only already-persisted OmniRoute sessions. This never starts a fresh login.
  await bootstrapAi();

  // Then discover OmniRoute's explicitly no-auth/free providers and put every
  // route that passes a real inference probe ahead of quota-limited accounts.
  // Failure here is non-fatal: the already-proven subscription route remains active.
  try {
    await bootstrapFreeSwarm();
  } catch {
    console.log("FREE_SWARM_UNAVAILABLE; keeping existing AI route");
  }

  const controlEntry = resolve("dist", "control", "main.js");
  const child = spawn(process.execPath, [controlEntry], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["inherit", "pipe", "inherit"],
    shell: false
  });

  let opened = false;
  child.stdout?.on("data", (chunk: Buffer | string) => {
    const text = String(chunk);
    process.stdout.write(text);
    if (!opened && text.includes("KOORDYNATOR_CONTROL")) {
      opened = true;
      openUrl(url);
    }
  });

  child.once("error", () => {
    console.error("KOORDYNATOR_APP_START_FAILED");
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0);
  });

  const relay = (signal: NodeJS.Signals) => {
    if (!child.killed) child.kill(signal);
  };
  process.once("SIGINT", () => relay("SIGINT"));
  process.once("SIGTERM", () => relay("SIGTERM"));
}

main().catch(error => {
  const message = error instanceof Error ? error.message : "KOORDYNATOR_APP_START_FAILED";
  console.error(/^[A-Z][A-Z0-9_:]*$/.test(message) ? message : "KOORDYNATOR_APP_START_FAILED");
  process.exitCode = 1;
});
