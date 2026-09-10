#!/usr/bin/env node
import { spawn } from "node:child_process";
import { loadLocalConfig, omniRouteSettings } from "./local-config.js";
import { checkOmniRoute, probeOmniRoute } from "./omniroute-check.js";
import { prepareHermes } from "./hermes-launch.js";

async function main(): Promise<void> {
  loadLocalConfig();
  const settings = omniRouteSettings();
  const command = process.argv[2];
  if (command !== "doctor" && command !== "hermes") throw new Error("USE_DOCTOR_OR_HERMES");
  const extra = process.argv.slice(3);
  if (extra.length > 1 || extra.some(arg => command === "doctor" ? arg !== "--probe" : !["openai", "anthropic"].includes(arg))) throw new Error("UNSUPPORTED_RUNTIME_ARGUMENT");
  if (command === "hermes" && extra[0]) {
    const name = extra[0] === "openai" ? "KOORDYNATOR_OPENAI_MODEL" : "KOORDYNATOR_ANTHROPIC_MODEL";
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
        openai: check.catalog.entries?.filter(entry => entry.family === "OPENAI" && entry.billingSource === "SUBSCRIPTION_HARNESS").map(entry => entry.id) ?? [],
        anthropic: check.catalog.entries?.filter(entry => entry.family === "ANTHROPIC" && entry.billingSource === "SUBSCRIPTION_HARNESS").map(entry => entry.id) ?? []
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
