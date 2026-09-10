import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

/** Load application settings only; inherited process values have precedence. Never execute .env. */
export function loadLocalConfig(path = resolve(".env"), env: NodeJS.ProcessEnv = process.env): void {
  let text: string;
  try { text = readFileSync(path, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw new Error("LOCAL_ENV_UNREADABLE");
  }
  for (const [key, value] of Object.entries(parseEnv(text))) {
    if (/^(KOORDYNATOR_|OMNIROUTE_)/.test(key) && env[key] === undefined) env[key] = value;
  }
}

export function omniRouteSettings(env: NodeJS.ProcessEnv = process.env) {
  const value = env.OMNIROUTE_ENDPOINT?.trim() || "http://127.0.0.1:20128/v1";
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("OMNIROUTE_ENDPOINT_INVALID"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("OMNIROUTE_ENDPOINT_INVALID");
  }
  const path = url.pathname.replace(/\/+$/, "");
  if (path && !path.endsWith("/v1")) throw new Error("OMNIROUTE_ENDPOINT_USE_V1_NOT_HOME");
  url.pathname = path || "/v1";
  const model = env.KOORDYNATOR_CHAT_MODEL?.trim() || "auto/best-free";
  if (/\s|[\x00-\x1f]/.test(model) || model.startsWith("-")) throw new Error("OMNIROUTE_MODEL_INVALID");
  return { endpoint: url.toString().replace(/\/+$/, ""), model, apiKey: env.OMNIROUTE_API_KEY?.trim() || "" };
}
