#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const root = resolve(import.meta.dirname, "..");
const runtimeDir = resolve(root, ".orchestrator", "runtime");
const pidFile = resolve(runtimeDir, "omniroute-keeper.pid");
const healthUrl = process.env.KOORDYNATOR_OMNIROUTE_HEALTH || "http://127.0.0.1:20128/api/health";

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function claimKeeper() {
  mkdirSync(runtimeDir, { recursive: true });
  try {
    const existing = Number(readFileSync(pidFile, "utf8").trim());
    if (processAlive(existing)) return false;
  } catch {
  }
  writeFileSync(pidFile, `${process.pid}\n`, { encoding: "utf8", mode: 0o600 });
  return true;
}

function cleanup() {
  try {
    const current = Number(readFileSync(pidFile, "utf8").trim());
    if (current === process.pid) rmSync(pidFile, { force: true });
  } catch {
  }
}

async function healthy() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1000);
  try {
    const response = await fetch(healthUrl, {
      headers: { accept: "application/json" },
      signal: controller.signal
    });
    return response.status === 200;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function startOmniRoute() {
  return spawnSync("omniroute", ["serve", "--daemon", "--no-open"], {
    cwd: root,
    env: process.env,
    stdio: "ignore",
    timeout: 15000,
    shell: false
  });
}

async function ensureRunning() {
  if (await healthy()) return true;
  const result = startOmniRoute();
  if (result.error || (result.status ?? 1) !== 0) return false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await new Promise(resolvePromise => setTimeout(resolvePromise, 250));
    if (await healthy()) return true;
  }
  return false;
}

if (!claimKeeper()) process.exit(0);

process.on("exit", cleanup);
process.on("SIGINT", () => {
  cleanup();
  process.exit(0);
});
process.on("SIGTERM", () => {
  cleanup();
  process.exit(0);
});

let checking = false;

async function tick() {
  if (checking) return;
  checking = true;
  try {
    await ensureRunning();
  } finally {
    checking = false;
  }
}

await tick();
setInterval(() => void tick(), 5000);
