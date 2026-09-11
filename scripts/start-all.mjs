#!/usr/bin/env node
/**
 * One-click always-on start for Koordynator.
 * Boots OmniRoute (if needed), refreshes free/sub AI routes, starts Control UI, opens chat.
 *
 * Daily:
 *   npm run start:all
 *
 * Or double-click:
 *   scripts/Koordynator-Start.command
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
process.chdir(root);

const host = process.env.KOORDYNATOR_CONTROL_HOST || "127.0.0.1";
const port = process.env.KOORDYNATOR_CONTROL_PORT || "8787";
const chatUrl = `http://${host}:${port}/chat`;
const pidDir = resolve(root, ".orchestrator", "runtime");
const pidFile = resolve(pidDir, "control.pid");
const logFile = resolve(pidDir, "control.log");

function run(label, command, args, { allowFail = false, inherit = true } = {}) {
  console.log(`\n==> ${label}`);
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: inherit ? "inherit" : "pipe",
    encoding: "utf8",
    shell: false
  });
  const code = result.status ?? 1;
  if (code !== 0 && !allowFail) {
    console.error(`${label} failed (exit ${code})`);
    process.exit(code || 1);
  }
  return result;
}

function healthCode(url) {
  const probe = spawnSync("curl", ["-sS", "-o", "/dev/null", "-w", "%{http_code}", url], {
    encoding: "utf8",
    stdio: "pipe"
  });
  return (probe.stdout || "").trim();
}

function ensureOmniRoute() {
  const code = healthCode("http://127.0.0.1:20128/api/health");
  if (code && Number(code) > 0 && Number(code) < 500) {
    console.log("OmniRoute: already running");
    return;
  }
  run("Start OmniRoute", "omniroute", ["serve", "--daemon", "--no-open"], { allowFail: true });
  for (let i = 0; i < 40; i += 1) {
    spawnSync("sleep", ["0.25"]);
    const again = healthCode("http://127.0.0.1:20128/api/health");
    if (again && Number(again) > 0 && Number(again) < 500) {
      console.log("OmniRoute: ready");
      return;
    }
  }
  console.error("OmniRoute did not become ready on :20128");
  process.exit(1);
}

function controlAlreadyUp() {
  const code = healthCode(`http://${host}:${port}/api/health`);
  return Boolean(code && Number(code) > 0 && Number(code) < 500);
}

function startControlWithLog() {
  if (controlAlreadyUp()) {
    console.log(`Control UI: already running at http://${host}:${port}`);
    return;
  }
  mkdirSync(pidDir, { recursive: true });
  run("Build", "npm", ["run", "build"]);
  const child = spawn("bash", ["-lc", `npm run control >> ${JSON.stringify(logFile)} 2>&1`], {
    cwd: root,
    env: process.env,
    detached: true,
    stdio: "ignore"
  });
  child.unref();
  writeFileSync(pidFile, String(child.pid ?? ""), "utf8");
  for (let i = 0; i < 60; i += 1) {
    spawnSync("sleep", ["0.25"]);
    if (controlAlreadyUp()) {
      console.log(`Control UI: ready at http://${host}:${port}`);
      return;
    }
  }
  console.error(`Control UI did not become ready at http://${host}:${port}`);
  console.error(`See log: ${logFile}`);
  process.exit(1);
}

function openChat() {
  if (process.platform === "darwin") {
    run("Open chat", "open", [chatUrl], { allowFail: true });
  } else if (process.platform === "win32") {
    run("Open chat", "cmd", ["/c", "start", "", chatUrl], { allowFail: true });
  } else {
    run("Open chat", "xdg-open", [chatUrl], { allowFail: true });
  }
}

console.log("Koordynator start-all");
console.log(`repo: ${root}`);
ensureOmniRoute();
run("AI always-on (no login)", "npm", ["run", "ai:always-on"]);
startControlWithLog();
openChat();
console.log(`\nDone. Chat: ${chatUrl}`);
console.log("Stop later: close the Control UI process; OmniRoute can stay running.");
