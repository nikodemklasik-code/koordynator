#!/usr/bin/env node
/**
 * Always-on AI setup for Koordynator + OmniRoute + Hermes.
 *
 * Default: NO interactive login. Uses already-active OmniRoute sessions.
 * Priority: free OAuth / subscription first, Codex/OpenAI last.
 *
 * Two commands for daily use:
 *   npm run ai:always-on
 *   npm start
 *
 * Optional:
 *   npm run ai:always-on -- --login   # only when a provider is missing
 *   npm run ai:always-on -- --probe
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
process.chdir(root);

const args = new Set(process.argv.slice(2));
const wantHelp = args.has("-h") || args.has("--help");
const wantProbe = args.has("--probe");
const wantStart = args.has("--start");
const wantLogin = args.has("--login");

if (wantHelp) {
  console.log(`ai-always-on

Default uses already-logged OmniRoute sessions. No browser login unless --login.

Daily:
  npm run ai:always-on
  npm start

Options:
  --login   Allow interactive OAuth for missing providers
  --probe   Live inference probe
  --start   Start control UI after setup
`);
  process.exit(0);
}

function run(label, command, commandArgs, { inherit = true, allowFail = false } = {}) {
  console.log(`\n==> ${label}`);
  const result = spawnSync(command, commandArgs, {
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

function need(bin) {
  const result = spawnSync(bin, ["--version"], { encoding: "utf8", stdio: "pipe" });
  if ((result.status ?? 1) !== 0) {
    console.error(`Missing required command: ${bin}`);
    process.exit(1);
  }
  return (result.stdout || result.stderr || "").trim().split("\n")[0];
}

function ensureOmniRoute() {
  const health = spawnSync("curl", ["-sS", "-o", "/dev/null", "-w", "%{http_code}", "http://127.0.0.1:20128/api/health"], {
    encoding: "utf8",
    stdio: "pipe"
  });
  const code = (health.stdout || "").trim();
  if (code && Number(code) > 0 && Number(code) < 500) {
    console.log("OmniRoute: already running");
    return;
  }
  run("Start OmniRoute", "omniroute", ["serve", "--daemon", "--no-open"], { allowFail: true });
  for (let i = 0; i < 20; i += 1) {
    spawnSync("sleep", ["0.25"]);
    const again = spawnSync("curl", ["-sS", "-o", "/dev/null", "-w", "%{http_code}", "http://127.0.0.1:20128/api/health"], {
      encoding: "utf8",
      stdio: "pipe"
    });
    const status = (again.stdout || "").trim();
    if (status && Number(status) > 0 && Number(status) < 500) {
      console.log("OmniRoute: ready");
      return;
    }
  }
  console.error("OmniRoute did not become ready on :20128");
  process.exit(1);
}

console.log("AI always-on setup");
console.log(`repo: ${root}`);
console.log(`node: ${need("node")}`);
console.log(`npm:  ${need("npm")}`);
console.log(`omniroute: ${need("omniroute")}`);
console.log(`hermes: ${need("hermes")}`);
console.log(wantLogin ? "mode: login allowed for missing providers" : "mode: no login (use existing sessions)");

if (!existsSync(resolve(root, ".env")) && existsSync(resolve(root, ".env.example"))) {
  run("Create .env from example", "cp", [".env.example", ".env"]);
  run("Lock .env permissions", "chmod", ["600", ".env"], { allowFail: true });
}

ensureOmniRoute();
run("Build", "npm", ["run", "build"]);

if (wantLogin) {
  run("Bootstrap / login missing providers", "node", ["dist/runtime/main.js", "bootstrap"]);
}

const {
  loadLocalConfig,
  omniRouteSettings
} = await import(pathToFileURL(resolve(root, "dist/runtime/local-config.js")).href);
const {
  prepareHermes
} = await import(pathToFileURL(resolve(root, "dist/runtime/hermes-launch.js")).href);
const {
  mergeEnvText,
  selectChatModels,
  bootstrapAi
} = await import(pathToFileURL(resolve(root, "dist/runtime/ai-bootstrap.js")).href);

loadLocalConfig();

const familyKeys = [
  "KOORDYNATOR_GEMINI_MODEL",
  "KOORDYNATOR_QWEN_MODEL",
  "KOORDYNATOR_KIRO_MODEL",
  "KOORDYNATOR_AMAZON_Q_MODEL",
  "KOORDYNATOR_ANTIGRAVITY_MODEL",
  "KOORDYNATOR_QODER_MODEL",
  "KOORDYNATOR_ANTHROPIC_MODEL",
  "KOORDYNATOR_GROK_MODEL",
  "KOORDYNATOR_GITHUB_COPILOT_MODEL",
  "KOORDYNATOR_KIMI_MODEL",
  "KOORDYNATOR_CURSOR_MODEL",
  "KOORDYNATOR_KILOCODE_MODEL",
  "KOORDYNATOR_CLINE_MODEL",
  "KOORDYNATOR_OPENAI_MODEL"
];
let family = Object.fromEntries(
  familyKeys
    .map(key => [key, process.env[key]?.trim() || ""])
    .filter(([, value]) => value.length > 0)
);
let selected = selectChatModels(family);

// No interactive OAuth by default. If .env has no family slots yet, discover
// already-connected OmniRoute sessions using the Keychain gateway key.
if (!selected.primary && !wantLogin) {
  console.log("\n==> Discover active OmniRoute routes (no login)");
  await bootstrapAi();
  loadLocalConfig();
  family = Object.fromEntries(
    familyKeys
      .map(key => [key, process.env[key]?.trim() || ""])
      .filter(([, value]) => value.length > 0)
  );
  selected = selectChatModels(family);
}

if (!selected.primary) {
  console.error("No active OmniRoute model routes yet.");
  console.error("Connect a provider in OmniRoute, or run once:");
  console.error("  npm run ai:always-on -- --login");
  process.exit(1);
}

const updates = {
  KOORDYNATOR_CHAT_MODEL: selected.primary,
  KOORDYNATOR_FALLBACK_MODELS: selected.fallbacks.join(",")
};
const envPath = resolve(root, ".env");
const original = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
writeFileSync(envPath, mergeEnvText(original, updates), { encoding: "utf8", mode: 0o600 });
try { chmodSync(envPath, 0o600); } catch { /* best effort */ }
for (const [key, value] of Object.entries(updates)) process.env[key] = value;

console.log(`\n==> Primary/fallbacks`);
console.log(`    primary:   ${selected.primary}`);
console.log(`    fallbacks: ${selected.fallbacks.join(" -> ") || "(none)"}`);

const doctorArgs = ["run", "doctor:omniroute"];
if (wantProbe) doctorArgs.push("--", "--probe");
run("Doctor", "npm", doctorArgs, { allowFail: true });

const settings = omniRouteSettings();
const launch = await prepareHermes(settings, root);
const config = JSON.parse(readFileSync(resolve(launch.env.HERMES_HOME, "config.yaml"), "utf8"));
const fallbacks = Array.isArray(config.fallback_providers)
  ? config.fallback_providers.map(entry => entry.model).filter(Boolean)
  : [];

console.log("\nConfigured");
console.log(`  primary:   ${settings.model}`);
console.log(`  fallbacks: ${fallbacks.length ? fallbacks.join(" -> ") : "(none)"}`);
console.log(`  endpoint:  ${settings.endpoint}`);
console.log(`  hermes:    HERMES_HOME=${launch.env.HERMES_HOME}`);
console.log("\nDone. Next command:\n  npm start");

if (wantStart) {
  run("Start control UI", "npm", ["start"]);
}
