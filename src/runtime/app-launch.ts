#!/usr/bin/env node
import { spawn } from "node:child_process";
import { platform } from "node:os";
import { resolve } from "node:path";
import { bootstrapAi } from "./ai-bootstrap.js";
import { loadLocalConfig } from "./local-config.js";

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

  // Reuse only already-persisted OmniRoute sessions. This never starts OAuth.
  await bootstrapAi();

  const host = process.env.KOORDYNATOR_CONTROL_HOST ?? "127.0.0.1";
  const port = controlPort();
  const url = browserUrl(host, port);
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
