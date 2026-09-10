import { constants } from "node:fs";
import { chmod, lstat, mkdir, open } from "node:fs/promises";
import { join, resolve } from "node:path";
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

/** Managed, repo-local profile: global Nous/OpenRouter configuration is never edited. */
export async function prepareHermes(settings: ReturnType<typeof omniRouteSettings>, root = process.cwd()) {
  if (!settings.apiKey) throw new Error("OMNIROUTE_API_KEY_REQUIRED");
  const state = resolve(root, ".orchestrator");
  await privateDirectory(state);
  const home = join(state, "hermes-omniroute");
  await privateDirectory(home);
  // JSON is valid YAML. The key is bound to this endpoint, not a global OpenAI/OpenRouter key.
  await privateFile(join(home, "config.yaml"), JSON.stringify({
    model: { provider: "custom", default: settings.model, base_url: settings.endpoint,
      api_mode: "chat_completions", api_key: settings.apiKey }
  }, null, 2) + "\n");
  // Hermes clears inherited known provider keys when a profile .env exists.
  await privateFile(join(home, ".env"), "# Credentials are endpoint-bound in the managed config.yaml.\n");
  return {
    command: "hermes",
    args: ["chat", "--provider", "custom", "--model", settings.model],
    cwd: resolve(root),
    env: { ...process.env, HERMES_HOME: home, HERMES_INFERENCE_PROVIDER: "custom",
      HERMES_INFERENCE_MODEL: settings.model, CUSTOM_BASE_URL: settings.endpoint,
      OPENAI_BASE_URL: settings.endpoint, OPENAI_API_KEY: settings.apiKey,
      OPENROUTER_API_KEY: "", OPENROUTER_BASE_URL: "" }
  };
}
