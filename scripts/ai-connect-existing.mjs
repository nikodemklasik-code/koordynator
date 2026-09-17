#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const DRY_RUN = process.argv.includes("--dry-run");
const REPO = process.cwd();

function exec(name, args, options = {}) {
  const result = spawnSync(name, args, {
    cwd: options.cwd ?? REPO,
    env: process.env,
    encoding: "utf8",
    stdio: options.inherit ? "inherit" : "pipe"
  });
  return {
    status: result.status ?? 1,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? "")
  };
}

function plan() {
  console.log("AUTO_IMPORT: existing local AI sessions only; no OAuth/login prompts");
  console.log("- Codex/OpenAI: import ~/.codex/auth.json when available");
  console.log("- Cursor: OmniRoute system auto-import when available");
  console.log("- Zed: OmniRoute keychain/system auto-import when available");
  console.log("- Existing OmniRoute sessions: reused as-is");
  console.log("- Providers requiring fresh consent: skipped, never opened automatically");
  console.log("- Final step: npm run ai:bootstrap performs live inference probes");
}

function locateApiModule() {
  const candidates = [];
  const npmRoot = exec("npm", ["root", "-g"]);
  if (npmRoot.status === 0 && npmRoot.stdout.trim()) {
    candidates.push(join(npmRoot.stdout.trim(), "omniroute", "bin", "cli", "api.mjs"));
  }
  candidates.push(join(homedir(), ".local", "lib", "node_modules", "omniroute", "bin", "cli", "api.mjs"));
  return candidates.find(path => existsSync(path)) ?? null;
}

async function loadApiFetch() {
  const modulePath = locateApiModule();
  if (!modulePath) throw new Error("OMNIROUTE_CLI_MODULE_NOT_FOUND");
  const mod = await import(pathToFileURL(modulePath).href);
  if (typeof mod.apiFetch !== "function") throw new Error("OMNIROUTE_APIFETCH_NOT_FOUND");
  return mod.apiFetch;
}

async function sleep(ms) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function ensureOmniRoute(apiFetch) {
  try {
    const response = await apiFetch("/api/health", { acceptNotOk: true, retry: false });
    if (response.ok) return;
  } catch {}

  const started = exec("omniroute", ["serve", "--daemon", "--no-open"]);
  if (started.status !== 0) throw new Error("OMNIROUTE_START_FAILED");
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await sleep(250);
    try {
      const response = await apiFetch("/api/health", { acceptNotOk: true, retry: false });
      if (response.ok) return;
    } catch {}
  }
  throw new Error("OMNIROUTE_NOT_READY");
}

async function connections(apiFetch) {
  const response = await apiFetch("/api/providers", { acceptNotOk: true, retry: false });
  if (!response.ok) throw new Error("OMNIROUTE_PROVIDER_LIST_FAILED");
  const body = await response.json();
  const rows = Array.isArray(body?.connections)
    ? body.connections
    : Array.isArray(body?.providers)
      ? body.providers
      : Array.isArray(body?.items)
        ? body.items
        : [];
  return rows.filter(row => row && typeof row === "object");
}

function activeProviderSet(rows) {
  return new Set(rows
    .filter(row => row.isActive !== false)
    .map(row => typeof row.provider === "string" ? row.provider : "")
    .filter(Boolean));
}

async function importCodex(apiFetch, active) {
  if (active.has("codex")) return { provider: "codex", result: "REUSE", detail: "already connected" };
  const authPath = join(homedir(), ".codex", "auth.json");
  if (!existsSync(authPath)) return { provider: "codex", result: "SKIP", detail: "no local Codex session" };

  let auth;
  try {
    auth = JSON.parse(readFileSync(authPath, "utf8"));
  } catch {
    return { provider: "codex", result: "SKIP", detail: "local Codex session unreadable" };
  }

  const response = await apiFetch("/api/providers/codex-auth/import", {
    method: "POST",
    body: { source: { kind: "json", json: auth }, name: "OpenAI Codex", overwriteExisting: true },
    acceptNotOk: true,
    retry: false
  });
  return response.ok
    ? { provider: "codex", result: "IMPORTED", detail: "local session reused" }
    : { provider: "codex", result: "SKIP", detail: `import HTTP ${response.status}` };
}

function autoImportCli(provider, active) {
  if (active.has(provider)) return { provider, result: "REUSE", detail: "already connected" };
  const run = exec("omniroute", ["oauth", "start", "--provider", provider, "--import-from-system", "--timeout", "60000"]);
  return run.status === 0
    ? { provider, result: "IMPORTED", detail: "system credentials imported" }
    : { provider, result: "SKIP", detail: "no importable local session" };
}

function printRows(rows) {
  const width = Math.max(8, ...rows.map(row => row.provider.length));
  console.log("\nExisting-session import");
  for (const row of rows) {
    console.log(`${row.provider.padEnd(width)}  ${row.result.padEnd(8)}  ${row.detail}`);
  }
}

function printConnected(rows) {
  const active = rows
    .filter(row => row.isActive !== false && typeof row.provider === "string")
    .map(row => row.provider)
    .filter(Boolean)
    .sort();
  console.log(`\nOmniRoute active providers: ${active.length ? active.join(", ") : "none"}`);
}

function runBootstrap() {
  const packagePath = join(REPO, "package.json");
  if (!existsSync(packagePath)) return 0;
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(packagePath, "utf8"));
  } catch {
    return 0;
  }
  if (!pkg?.scripts?.["ai:bootstrap"]) return 0;
  console.log("\nRunning Koordynator live probes...");
  return exec("npm", ["run", "ai:bootstrap"], { inherit: true }).status;
}

async function main() {
  plan();
  if (DRY_RUN) return;

  const version = exec("omniroute", ["--version"]);
  if (version.status !== 0) throw new Error("OMNIROUTE_CLI_NOT_FOUND");

  // Do not let the inference-plane key override OmniRoute's loopback management token.
  delete process.env.OMNIROUTE_API_KEY;
  const apiFetch = await loadApiFetch();
  await ensureOmniRoute(apiFetch);

  let current = await connections(apiFetch);
  let active = activeProviderSet(current);
  const results = [];

  results.push(await importCodex(apiFetch, active));
  current = await connections(apiFetch);
  active = activeProviderSet(current);

  results.push(autoImportCli("cursor", active));
  current = await connections(apiFetch);
  active = activeProviderSet(current);

  results.push(autoImportCli("zed", active));
  await sleep(300);
  current = await connections(apiFetch);

  printRows(results);
  printConnected(current);
  console.log("\nFresh provider consent was intentionally NOT started. Different vendors do not share one OAuth identity.");

  const bootstrapStatus = runBootstrap();
  if (bootstrapStatus !== 0) process.exitCode = bootstrapStatus;
}

main().catch(error => {
  const message = error instanceof Error ? error.message : "AI_CONNECT_EXISTING_FAILED";
  console.error(/^[A-Z][A-Z0-9_:]*$/.test(message) ? message : "AI_CONNECT_EXISTING_FAILED");
  process.exitCode = 1;
});
