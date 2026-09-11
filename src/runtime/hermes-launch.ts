import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open } from "node:fs/promises";
import { join, resolve } from "node:path";
import { loadHermesGrants } from "../control/hermes-grant-store.js";
import { mintTaskTicket } from "../security/task-ticket.js";
import { startTicketProxy, type TicketProxy } from "../security/ticket-proxy.js";
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

const STRIP_FROM_CHILD = [
  "OMNIROUTE_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "OPENROUTER_API_KEY",
  "XAI_API_KEY",
  "GOOGLE_API_KEY",
  "GEMINI_API_KEY"
];

function childEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = { ...env };
  for (const key of STRIP_FROM_CHILD) delete next[key];
  return next;
}

function fallbackProviders(endpoint: string, settings: ReturnType<typeof omniRouteSettings>, env: NodeJS.ProcessEnv = process.env) {
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
    base_url: endpoint,
    // Ticket lives in the child as OPENAI_API_KEY; Hermes custom provider reads that env name.
    key_env: "OPENAI_API_KEY"
  }));
}

export type HermesLaunch = {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  close: () => Promise<void>;
};

/** Managed, repo-local profile: global Nous/OpenRouter configuration is never edited. */
export async function prepareHermes(settings: ReturnType<typeof omniRouteSettings>, root = process.cwd(), env: NodeJS.ProcessEnv = process.env): Promise<HermesLaunch> {
  if (!settings.apiKey) throw new Error("OMNIROUTE_API_KEY_REQUIRED");
  const state = resolve(root, ".orchestrator");
  await privateDirectory(state);
  const home = join(state, "hermes-omniroute");
  await privateDirectory(home);

  const secret = randomBytes(32).toString("hex");
  const { token } = mintTaskTicket(secret, { aud: "hermes", model: settings.model });
  let proxy: TicketProxy | undefined;
  try {
    proxy = await startTicketProxy({
      upstream: settings.endpoint,
      apiKey: settings.apiKey,
      secret,
      audience: "hermes"
    });
    const fallbacks = fallbackProviders(proxy.url, settings, env);
    const grants = await loadHermesGrants(join(root, ".orchestrator"));
    // JSON is valid YAML. The gateway key stays in Control; the profile only names the env.
    const config: Record<string, unknown> = {
      model: { provider: "custom", default: settings.model, base_url: proxy.url,
        api_mode: "chat_completions", key_env: "OPENAI_API_KEY" },
      approvals: { mode: grants.terminal ? "off" : "smart" },
      terminal: { cwd: resolve(root) }
    };
    if (!grants.terminal) config.disabled_toolsets = ["terminal"];
    if (fallbacks.length > 0) config.fallback_providers = fallbacks;
    await privateFile(join(home, "config.yaml"), JSON.stringify(config, null, 2) + "\n");
    // Hermes clears inherited known provider keys when a profile .env exists.
    await privateFile(join(home, ".env"), "# Credentials are a short-lived task ticket, never the gateway key.\n");
    const held = proxy;
    return {
      command: "hermes",
      args: ["chat", "--provider", "custom", "--model", settings.model],
      cwd: resolve(root),
      env: {
        ...childEnvironment(env),
        HERMES_HOME: home,
        HERMES_INFERENCE_PROVIDER: "custom",
        HERMES_INFERENCE_MODEL: settings.model,
        CUSTOM_BASE_URL: held.url,
        OPENAI_BASE_URL: held.url,
        OPENAI_API_KEY: token,
        OMNIROUTE_TASK_TICKET: token,
        OPENROUTER_API_KEY: "",
        OPENROUTER_BASE_URL: ""
      },
      close: () => held.close()
    };
  } catch (error) {
    await proxy?.close().catch(() => undefined);
    throw error;
  }
}
