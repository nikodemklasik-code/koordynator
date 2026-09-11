import { constants } from "node:fs";
import { chmod, lstat, mkdir, open } from "node:fs/promises";
import { join, resolve } from "node:path";
import { loadHermesGrants } from "../control/hermes-grant-store.js";
import { omniRouteSettings } from "./local-config.js";

async function privateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const stat = await lstat(path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("HERMES_PROFILE_PATH_UNSAFE");
  await chmod(path, 0o700);
}

async function privateFile(path: string, content: string): Promise<void> {
  const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600);
  try { await file.chmod(0o600); await file.writeFile(content, "utf8"); }
  finally { await file.close(); }
}

function fallbackProviders(settings: ReturnType<typeof omniRouteSettings>, env: NodeJS.ProcessEnv = process.env) {
  const seen = new Set<string>();
  const models: string[] = [];
  for (const raw of (env.KOORDYNATOR_FALLBACK_MODELS ?? "").split(",")) {
    const model = raw.trim();
    if (!model || model === settings.model || seen.has(model)) continue;
    seen.add(model);
    models.push(model);
    if (models.length >= 6) break;
  }
  return models.map(model => ({
    provider: "custom",
    model,
    base_url: settings.endpoint,
    // Transitional: child still receives OPENAI_API_KEY in process env.
    // Persistent profile files must not store the raw gateway key.
    key_env: "OPENAI_API_KEY"
  }));
}

/** Managed, repo-local profile: global Nous/OpenRouter configuration is never edited. */
export async function prepareHermes(settings: ReturnType<typeof omniRouteSettings>, root = process.cwd(), env: NodeJS.ProcessEnv = process.env) {
  if (!settings.apiKey) throw new Error("OMNIROUTE_API_KEY_REQUIRED");
  const state = resolve(root, ".orchestrator");
  await privateDirectory(state);
  const home = join(state, "hermes-omniroute");
  await privateDirectory(home);
  const fallbacks = fallbackProviders(settings, env);
  const grants = await loadHermesGrants(join(root, ".orchestrator"));
  // JSON is valid YAML. Raw provider keys stay out of the persisted profile.
  const config: Record<string, unknown> = {
    model: { provider: "custom", default: settings.model, base_url: settings.endpoint,
      api_mode: "chat_completions" },
    approvals: { mode: grants.terminal ? "off" : "smart" },
    terminal: { cwd: resolve(root) }
  };
  if (!grants.terminal) config.disabled_toolsets = ["terminal"];
  if (fallbacks.length > 0) config.fallback_providers = fallbacks;
  await privateFile(join(home, "config.yaml"), JSON.stringify(config, null, 2) + "\n");
  await privateFile(join(home, ".env"), "# Credentials are not persisted in the managed Hermes profile.\n");
  return {
    command: "hermes",
    args: ["chat", "--provider", "custom", "--model", settings.model],
    cwd: resolve(root),
    env: { ...env, HERMES_HOME: home, HERMES_INFERENCE_PROVIDER: "custom",
      HERMES_INFERENCE_MODEL: settings.model, CUSTOM_BASE_URL: settings.endpoint,
      OPENAI_BASE_URL: settings.endpoint, OPENAI_API_KEY: settings.apiKey,
      OPENROUTER_API_KEY: "", OPENROUTER_BASE_URL: "" }
  };
}
