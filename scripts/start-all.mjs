#!/usr/bin/env node
/**
 * One-click always-on start for Koordynator.
 * Boots OmniRoute (if needed), safely reuses persisted/local AI sessions,
 * refreshes live routes, starts Control UI, then opens chat.
 *
 * Daily:
 *   npm run start:all
 *
 * Or double-click:
 *   scripts/Koordynator-Start.command
 *
 * Fresh vendor authorization is deliberately NOT part of normal launch. Use the
 * explicit one-time `npm run ai:auth-missing` wizard only when a route needs it.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
process.chdir(root);

const host = process.env.KOORDYNATOR_CONTROL_HOST || "127.0.0.1";
const port = process.env.KOORDYNATOR_CONTROL_PORT || "8787";
const chatUrl = `http://${host}:${port}/chat`;
const pidDir = resolve(root, ".orchestrator", "runtime");
const pidFile = resolve(pidDir, "control.pid");
const logFile = resolve(pidDir, "control.log");
const expectedRuntimeRevision = "PRODUCT_WORKSPACES_V3";
const runtimeEnv = {
  ...process.env,
  PATH: [process.env.HOME ? resolve(process.env.HOME, ".local", "bin") : "", process.env.PATH || ""]
    .filter(Boolean)
    .join(":")
};

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

function healthJson(url) {
  const probe = spawnSync("curl", ["-fsS", url], {
    encoding: "utf8",
    stdio: "pipe"
  });
  if ((probe.status ?? 1) !== 0) return null;
  try { return JSON.parse(probe.stdout || "null"); } catch { return null; }
}

function controlRuntimeState() {
  const health = healthJson(`http://${host}:${port}/api/health`);
  if (!health) return { state: "DOWN", health: null };
  const routes = Array.isArray(health.workspaceRoutes) ? health.workspaceRoutes : [];
  if (
    health.runtimeRevision === expectedRuntimeRevision &&
    health.productWorkspaces === true &&
    health.sharedRooms === true &&
    routes.includes("/corporation") &&
    routes.includes("/harmonia-legal") &&
    routes.includes("/studio") &&
    health.modelCatalogMode === "WORKING_SET_ACTIVE_ONLY" &&
    health.hermesPtyModelParameter === true
  ) return { state: "CURRENT", health };
  return { state: "STALE", health };
}

function stopManagedStaleControl() {
  if (!existsSync(pidFile)) return false;
  const pid = Number(readFileSync(pidFile, "utf8").trim());
  if (!Number.isInteger(pid) || pid <= 1) return false;
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return false;
  }
  for (let i = 0; i < 40; i += 1) {
    spawnSync("sleep", ["0.1"]);
    if (controlRuntimeState().state === "DOWN") return true;
  }
  try { process.kill(pid, "SIGKILL"); } catch {}
  return controlRuntimeState().state === "DOWN";
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
  return controlRuntimeState().state === "CURRENT";
}

function startControlWithLog() {
  const before = controlRuntimeState();
  if (before.state === "CURRENT") {
    console.log(`Control UI: current runtime already running at http://${host}:${port}`);
    return;
  }
  if (before.state === "STALE") {
    console.log(`Control UI: stale runtime detected at http://${host}:${port}`);
    if (!stopManagedStaleControl()) {
      console.error("STALE_CONTROL_RUNTIME");
      console.error(`Expected runtimeRevision=${expectedRuntimeRevision}, got=${before.health?.runtimeRevision ?? "legacy"}`);
      console.error(`Stop the process listening on port ${port}, then rerun npm run start:all.`);
      process.exit(1);
    }
    console.log("Control UI: stale managed runtime stopped");
  }

  mkdirSync(pidDir, { recursive: true });
  run("Build", "npm", ["run", "build"]);
  const child = spawn("bash", ["-lc", `npm run control:run >> ${JSON.stringify(logFile)} 2>&1`], {
    cwd: root,
    env: runtimeEnv,
    detached: true,
    stdio: "ignore"
  });
  child.unref();
  writeFileSync(pidFile, String(child.pid ?? ""), "utf8");
  for (let i = 0; i < 80; i += 1) {
    spawnSync("sleep", ["0.25"]);
    if (controlAlreadyUp()) {
      const live = controlRuntimeState().health;
      console.log(`Control UI: ready at http://${host}:${port}`);
      console.log(`Control runtime: ${live?.runtimeRevision ?? "unknown"} · ${live?.modelCatalogMode ?? "unknown"}`);
      return;
    }
  }
  console.error(`Control UI did not become ready with runtime ${expectedRuntimeRevision} at http://${host}:${port}`);
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
run("Reuse existing AI sessions (no login)", "npm", ["run", "ai:connect-existing", "--", "--no-bootstrap"], { allowFail: true });
run("AI always-on (no login)", "npm", ["run", "ai:always-on"]);
startControlWithLog();
openChat();
console.log(`\nDone. Chat: ${chatUrl}`);
console.log("Fresh vendor authorization is never launched here. Run npm run ai:auth-missing only when a missing route needs one-time consent.");
console.log("Stop later: close the Control UI process; OmniRoute can stay running.");
