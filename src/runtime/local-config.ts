import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { platform, userInfo } from "node:os";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

export type OmniRouteKeyLookup = () => string;

function keychainOmniRouteApiKey(): string {
  if (platform() !== "darwin") return "";
  const account = process.env.USER?.trim() || userInfo().username;
  const result = spawnSync(
    "security",
    ["find-generic-password", "-a", account, "-s", "hermes-omniroute-api-key", "-w"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );
  if ((result.status ?? 1) !== 0) return "";
  return String(result.stdout || "").trim();
}

/** Prefer process/env; fall back to macOS Keychain (`hermes-omniroute-api-key`). Never log the value. */
export function resolveOmniRouteApiKey(
  env: NodeJS.ProcessEnv = process.env,
  keychainLookup: OmniRouteKeyLookup = keychainOmniRouteApiKey
): string {
  const fromEnv = env.OMNIROUTE_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  return keychainLookup().trim();
}

/** Load application settings only; inherited process values have precedence. Never execute .env. */
export function loadLocalConfig(
  path = resolve(".env"),
  env: NodeJS.ProcessEnv = process.env,
  keychainLookup: OmniRouteKeyLookup = keychainOmniRouteApiKey
): void {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      // Still hydrate from Keychain when .env is absent.
      if (!env.OMNIROUTE_API_KEY?.trim()) {
        const key = resolveOmniRouteApiKey(env, keychainLookup);
        if (key) env.OMNIROUTE_API_KEY = key;
      }
      return;
    }
    throw new Error("LOCAL_ENV_UNREADABLE");
  }
  for (const [key, value] of Object.entries(parseEnv(text))) {
    if (/^(KOORDYNATOR_|OMNIROUTE_)/.test(key) && env[key] === undefined) env[key] = value;
  }
  // Blank OMNIROUTE_API_KEY= in .env must not block Keychain hydration.
  if (!env.OMNIROUTE_API_KEY?.trim()) {
    const key = resolveOmniRouteApiKey(env, keychainLookup);
    if (key) env.OMNIROUTE_API_KEY = key;
  }
}

export function omniRouteSettings(
  env: NodeJS.ProcessEnv = process.env,
  keychainLookup: OmniRouteKeyLookup = keychainOmniRouteApiKey
) {
  const value = env.OMNIROUTE_ENDPOINT?.trim() || "http://127.0.0.1:20128/v1";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("OMNIROUTE_ENDPOINT_INVALID");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("OMNIROUTE_ENDPOINT_INVALID");
  }
  const path = url.pathname.replace(/\/+$/, "");
  if (path && !path.endsWith("/v1")) throw new Error("OMNIROUTE_ENDPOINT_USE_V1_NOT_HOME");
  url.pathname = path || "/v1";
  const model = env.KOORDYNATOR_CHAT_MODEL?.trim() || "auto/best-free";
  if (/\s|[\x00-\x1f]/.test(model) || model.startsWith("-")) throw new Error("OMNIROUTE_MODEL_INVALID");
  return {
    endpoint: url.toString().replace(/\/+$/, ""),
    model,
    apiKey: resolveOmniRouteApiKey(env, keychainLookup)
  };
}
