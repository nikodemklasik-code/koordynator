#!/usr/bin/env node
import { spawn } from "node:child_process";
import { bootstrapAi } from "./ai-bootstrap.js";
import { loadLocalConfig, omniRouteSettings } from "./local-config.js";
import { checkOmniRoute, probeOmniRoute } from "./omniroute-check.js";
import { prepareHermes } from "./hermes-launch.js";

const HERMES_ROUTE_ENV = {
  openai: "KOORDYNATOR_OPENAI_MODEL",
  anthropic: "KOORDYNATOR_ANTHROPIC_MODEL",
  github: "KOORDYNATOR_GITHUB_COPILOT_MODEL",
  grok: "KOORDYNATOR_GROK_MODEL",
  gemini: "KOORDYNATOR_GEMINI_MODEL",
  kiro: "KOORDYNATOR_KIRO_MODEL",
  qoder: "KOORDYNATOR_QODER_MODEL",
  qwen: "KOORDYNATOR_QWEN_MODEL",
  kimi: "KOORDYNATOR_KIMI_MODEL",
  cursor: "KOORDYNATOR_CURSOR_MODEL",
  kilocode: "KOORDYNATOR_KILOCODE_MODEL",
  cline: "KOORDYNATOR_CLINE_MODEL",
  amazonq: "KOORDYNATOR_AMAZON_Q_MODEL",
  antigravity: "KOORDYNATOR_ANTIGRAVITY_MODEL",
  astra: "KOORDYNATOR_ASTRA_MODEL"
} as const;

type HermesRouteAlias = keyof typeof HERMES_ROUTE_ENV;

function protectedRoutes(
  check: Awaited<ReturnType<typeof checkOmniRoute>>,
  family: string,
  source: "SUBSCRIPTION_HARNESS" | "FREE_OAUTH",
  prefixes: string[] = []
): string[] {
  const routes = new Set(
    check.catalog.entries
      ?.filter(entry => entry.family === family && entry.billingSource === source)
      .map(entry => entry.id) ?? []
  );
  for (const id of check.catalog.models) {
    if (prefixes.some(prefix => id.startsWith(prefix))) routes.add(id);
  }
  return [...routes];
}

async function main(): Promise<void> {
  loadLocalConfig();
  const command = process.argv[2];
  const extra = process.argv.slice(3);

  if (command === "bootstrap") {
    if (extra.length !== 0) throw new Error("UNSUPPORTED_RUNTIME_ARGUMENT");
    await bootstrapAi();
    return;
  }

  const settings = omniRouteSettings();
  if (command !== "doctor" && command !== "hermes") throw new Error("USE_DOCTOR_HERMES_OR_BOOTSTRAP");
  const routeAlias = extra[0] as HermesRouteAlias | undefined;
  const doctorArgsValid = command === "doctor" && extra.length <= 1 && extra.every(arg => arg === "--probe");
  const hermesArgsValid = command === "hermes" && extra.length <= 1 && (!routeAlias || routeAlias in HERMES_ROUTE_ENV);
  if (!doctorArgsValid && !hermesArgsValid) throw new Error("UNSUPPORTED_RUNTIME_ARGUMENT");

  if (command === "hermes" && routeAlias) {
    const name = HERMES_ROUTE_ENV[routeAlias];
    const model = process.env[name]?.trim();
    if (!model) throw new Error(`${name}_REQUIRED_RUN_DOCTOR`);
    settings.model = omniRouteSettings({ ...process.env, KOORDYNATOR_CHAT_MODEL: model }).model;
  }

  const check = await checkOmniRoute(settings);
  if (command === "doctor") {
    console.log(JSON.stringify({ endpoint: settings.endpoint, model: settings.model, key: "configured",
      catalog: "PASS", listed: check.listed, billing: check.billing.decision,
      configuration: check.ready ? "READY_FOR_PROBE" : "BLOCKED", inference: "NOT_TESTED",
      subscriptionRoutes: {
        openai: protectedRoutes(check, "OPENAI", "SUBSCRIPTION_HARNESS", ["cx/", "codex/"]),
        astra: protectedRoutes(check, "OPENAI", "SUBSCRIPTION_HARNESS", ["cx/gpt-6-astra", "cx/gpt-6"]),
        anthropic: protectedRoutes(check, "ANTHROPIC", "SUBSCRIPTION_HARNESS", ["cc/", "claude-code/"]),
        github: protectedRoutes(check, "GITHUB COPILOT", "SUBSCRIPTION_HARNESS", ["gh/", "github/"]),
        grok: protectedRoutes(check, "XAI / GROK", "SUBSCRIPTION_HARNESS", ["gc/", "xao/"]),
        kimi: protectedRoutes(check, "MOONSHOT / KIMI", "SUBSCRIPTION_HARNESS", ["kmc/"]),
        cursor: protectedRoutes(check, "CURSOR", "SUBSCRIPTION_HARNESS", ["cu/"]),
        kilocode: protectedRoutes(check, "KILO CODE", "SUBSCRIPTION_HARNESS", ["kc/"]),
        cline: protectedRoutes(check, "CLINE", "SUBSCRIPTION_HARNESS", ["cl/"])
      },
      oauthRoutes: {
        gemini: protectedRoutes(check, "GOOGLE / GEMINI", "FREE_OAUTH", ["gemini-cli/"]),
        kiro: protectedRoutes(check, "KIRO", "FREE_OAUTH", ["kr/", "kiro/"]),
        qoder: protectedRoutes(check, "QODER", "FREE_OAUTH", ["if/"]),
        qwen: protectedRoutes(check, "QWEN", "FREE_OAUTH", ["qw/", "qwen-oauth/"]),
        amazonq: protectedRoutes(check, "AMAZON Q", "FREE_OAUTH", ["aq/"]),
        antigravity: protectedRoutes(check, "ANTIGRAVITY", "FREE_OAUTH", ["agy/"])
      },
      models: check.catalog.models.map(id => ({ id, billing: check.catalog.billing?.modelSources[id] ?? "UNKNOWN" }))
    }, null, 2));
    if (!check.ready) { process.exitCode = 1; return; }
    if (process.argv.includes("--probe")) console.log(JSON.stringify(await probeOmniRoute(settings)));
    return;
  }
  if (!check.listed) throw new Error("OMNIROUTE_MODEL_NOT_IN_CATALOG_RUN_DOCTOR");
  if (!check.billing.allowed) throw new Error(check.billing.decision);
  const launch = await prepareHermes(settings);
  console.log(`Hermes → OmniRoute: ${settings.endpoint} · ${settings.model}`);
  const child = spawn(launch.command, launch.args, { cwd: launch.cwd, env: launch.env, stdio: "inherit", shell: false });
  child.once("error", () => { console.error("HERMES_START_FAILED: sprawdź instalację poleceniem hermes --version"); process.exitCode = 1; });
  child.once("exit", (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
}

main().catch(error => {
  // Never print upstream responses/config objects, which can contain credentials.
  const message = error instanceof Error ? error.message : "RUNTIME_FAILED";
  console.error(/^[A-Z][A-Z0-9_:]*$/.test(message) ? message : "RUNTIME_FAILED");
  process.exitCode = 1;
});
