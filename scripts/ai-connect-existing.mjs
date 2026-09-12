#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const DRY_RUN = process.argv.includes("--dry-run");
const JSON_MODE = process.argv.includes("--json");
const NO_BOOTSTRAP = process.argv.includes("--no-bootstrap");
const REPO = process.cwd();

function exec(name, args, options = {}) {
  const result = spawnSync(name, args, {
    cwd: options.cwd ?? REPO,
    env: process.env,
    encoding: "utf8",
    timeout: options.timeout ?? 15_000,
    stdio: options.inherit ? "inherit" : "pipe"
  });
  return {
    status: result.status ?? 1,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? "")
  };
}

function log(message) {
  if (!JSON_MODE) console.log(message);
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

  const started = exec("omniroute", ["serve", "--daemon", "--no-open"], { timeout: 20_000 });
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
  const run = exec("omniroute", ["oauth", "start", "--provider", provider, "--import-from-system", "--timeout", "10000"], { timeout: 15_000 });
  return run.status === 0
    ? { provider, result: "IMPORTED", detail: "system credentials imported" }
    : { provider, result: "SKIP", detail: "no importable local session" };
}

function runBootstrap() {
  if (NO_BOOTSTRAP) return 0;
  const packagePath = join(REPO, "package.json");
  if (!existsSync(packagePath)) return 0;
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(packagePath, "utf8"));
  } catch {
    return 0;
  }
  if (!pkg?.scripts?.["ai:bootstrap"]) return 0;
  log("Running Koordynator live probes...");
  return exec("npm", ["run", "ai:bootstrap"], { inherit: !JSON_MODE, timeout: 180_000 }).status;
}

async function main() {
  const plan = {
    mode: "EXISTING_SESSIONS_ONLY",
    freshConsentStarted: false,
    results: [],
    activeProviders: [],
    bootstrapStatus: 0
  };

  if (DRY_RUN) {
    if (JSON_MODE) console.log(JSON.stringify(plan));
    else log("AUTO_IMPORT: existing local AI sessions only; no OAuth/login prompts");
    return;
  }

  const version = exec("omniroute", ["--version"]);
  if (version.status !== 0) throw new Error("OMNIROUTE_CLI_NOT_FOUND");

  // Management API uses OmniRoute's loopback CLI token. Do not leak or substitute
  // the inference-plane client key here.
  delete process.env.OMNIROUTE_API_KEY;
  const apiFetch = await loadApiFetch();
  await ensureOmniRoute(apiFetch);

  let current = await connections(apiFetch);
  let active = activeProviderSet(current);
  const results = [];

  results.push(await importCodex(apiFetch, active));
  current = await connections(apiFetch);
  active = activeProviderSet(current);

  // Safe, non-interactive imports only. If a vendor needs fresh consent these
  // attempts fail/skip because no TTY or browser consent is opened here.
  for (const provider of [
    "claude-code",
    "github",
    "gemini-cli",
    "kimi-coding",
    "qoder",
    "cursor",
    "kilocode",
    "cline",
    "amazonq",
    "antigravity",
    "qwen-oauth",
    "grok-cli",
    "zed"
  ]) {
    results.push(autoImportCli(provider, active));
    current = await connections(apiFetch);
    active = activeProviderSet(current);
  }

  await sleep(250);
  current = await connections(apiFetch);
  plan.results = results;
  plan.activeProviders = [...activeProviderSet(current)].sort();
  plan.bootstrapStatus = runBootstrap();

  if (JSON_MODE) {
    console.log(JSON.stringify(plan));
  } else {
    log("Existing-session import");
    for (const row of results) log(`${row.provider.padEnd(16)} ${row.result.padEnd(8)} ${row.detail}`);
    log(`Active providers: ${plan.activeProviders.length ? plan.activeProviders.join(", ") : "none"}`);
    log("Fresh provider consent was intentionally NOT started. Different vendors do not share one OAuth identity.");
  }

  if (plan.bootstrapStatus !== 0) process.exitCode = plan.bootstrapStatus;
}

main().catch(error => {
  const message = error instanceof Error ? error.message : "AI_CONNECT_EXISTING_FAILED";
  if (JSON_MODE) console.log(JSON.stringify({ ok: false, error: /^[A-Z][A-Z0-9_:]*$/.test(message) ? message : "AI_CONNECT_EXISTING_FAILED" }));
  else console.error(/^[A-Z][A-Z0-9_:]*$/.test(message) ? message : "AI_CONNECT_EXISTING_FAILED");
  process.exitCode = 1;
});