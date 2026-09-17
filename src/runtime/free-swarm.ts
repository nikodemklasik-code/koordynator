import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { mergeEnvText } from "./ai-bootstrap.js";
import { resolveOmniRouteApiKey } from "./local-config.js";

export type FreeSwarmRow = {
  key: string;
  model: string | null;
  status: "PASS" | "SKIP" | "FAILED";
  detail: string;
};

type FreeSwarmTarget = {
  key: string;
  prefixes: string[];
  envName: string;
  hints: string[];
  timeoutMs: number;
};

export const FREE_SWARM_TARGETS: FreeSwarmTarget[] = [
  {
    key: "opencode-free",
    prefixes: ["oc/"],
    envName: "KOORDYNATOR_OPENCODE_FREE_MODEL",
    hints: ["kimi", "qwen", "glm", "minimax", "mimo"],
    timeoutMs: 15000
  },
  {
    key: "duckduckgo-free",
    prefixes: ["ddgw/"],
    envName: "KOORDYNATOR_DUCKDUCKGO_FREE_MODEL",
    hints: ["gpt", "claude", "mistral", "llama"],
    timeoutMs: 15000
  },
  {
    key: "uncloseai-free",
    prefixes: ["unc/"],
    envName: "KOORDYNATOR_UNCLOSEAI_FREE_MODEL",
    hints: ["hermes", "llama", "qwen", "glm"],
    timeoutMs: 15000
  },
  {
    key: "aihorde-free",
    prefixes: ["horde/"],
    envName: "KOORDYNATOR_AIHORDE_FREE_MODEL",
    hints: [],
    timeoutMs: 8000
  }
];

const MARKER = "KOORDYNATOR_SWARM_OK";

function unique(values: string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

export function mergeSwarmSelection(
  freeModels: string[],
  existingPrimary?: string,
  existingFallbacks: string[] = []
): { primary: string | null; fallbacks: string[] } {
  const ordered = unique([
    ...freeModels,
    existingPrimary ?? "",
    ...existingFallbacks
  ]);
  return {
    primary: ordered[0] ?? null,
    fallbacks: ordered.slice(1, 8)
  };
}

function rankModel(target: FreeSwarmTarget, model: string): number {
  const lower = model.toLowerCase();
  const hint = target.hints.findIndex(value => lower.includes(value));
  return hint >= 0 ? hint : target.hints.length + 10;
}

export function modelsForFreeTarget(target: FreeSwarmTarget, models: string[]): string[] {
  return models
    .filter(model => target.prefixes.some(prefix => model.startsWith(prefix)))
    .filter(model => !model.toLowerCase().includes("deepseek"))
    .sort((a, b) => rankModel(target, a) - rankModel(target, b) || a.localeCompare(b));
}

async function fetchModels(endpoint: string, key: string): Promise<string[]> {
  const response = await fetch(`${endpoint.replace(/\/+$/, "")}/models`, {
    headers: { authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`FREE_SWARM_MODELS_HTTP_${response.status}`);
  const payload = await response.json() as { data?: Array<{ id?: unknown }> };
  return unique((payload.data ?? [])
    .map(item => typeof item.id === "string" ? item.id : "")
    .filter(Boolean));
}

function responseText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return "";
  const first = choices[0];
  if (!first || typeof first !== "object") return "";
  const message = (first as { message?: unknown }).message;
  if (!message || typeof message !== "object") return "";
  const content = (message as { content?: unknown }).content;
  return typeof content === "string" ? content : "";
}

async function probeModel(
  endpoint: string,
  key: string,
  model: string,
  timeoutMs: number
): Promise<{ ok: boolean; detail: string }> {
  let response: Response;
  try {
    response = await fetch(`${endpoint.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model,
        stream: false,
        max_tokens: 24,
        messages: [{ role: "user", content: `Reply exactly: ${MARKER}` }]
      }),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch {
    return { ok: false, detail: "request failed or timed out" };
  }

  if (!response.ok) return { ok: false, detail: `HTTP ${response.status}` };
  try {
    const payload = await response.json();
    return responseText(payload).includes(MARKER)
      ? { ok: true, detail: "live inference probe passed" }
      : { ok: false, detail: "HTTP 200 but marker missing" };
  } catch {
    return { ok: false, detail: "HTTP 200 but invalid response" };
  }
}

function persist(updates: Record<string, string>, envPath = resolve(".env")): void {
  const original = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  writeFileSync(envPath, mergeEnvText(original, updates), { encoding: "utf8", mode: 0o600 });
  try {
    chmodSync(envPath, 0o600);
  } catch {
    // Best effort only.
  }
  for (const [key, value] of Object.entries(updates)) process.env[key] = value;
}

function printRows(rows: FreeSwarmRow[]): void {
  const width = Math.max(8, ...rows.map(row => row.key.length));
  console.log("\nFree no-auth swarm");
  for (const row of rows) {
    console.log(`${row.key.padEnd(width)}  ${row.status.padEnd(6)}  ${(row.model ?? "-").padEnd(34)} ${row.detail}`);
  }
}

/**
 * Discovers only OmniRoute providers that are explicitly no-auth/free upstream.
 * No browser, device-code, token paste, or vendor sign-in is ever started here.
 */
export async function bootstrapFreeSwarm(): Promise<FreeSwarmRow[]> {
  const endpoint = process.env.OMNIROUTE_ENDPOINT?.trim() || "http://127.0.0.1:20128/v1";
  const key = resolveOmniRouteApiKey(process.env);
  if (!key) throw new Error("OMNIROUTE_GATEWAY_KEY_MISSING");

  const models = await fetchModels(endpoint, key);
  const rows: FreeSwarmRow[] = [];
  const updates: Record<string, string> = {};
  const working: string[] = [];

  for (const target of FREE_SWARM_TARGETS) {
    const candidates = modelsForFreeTarget(target, models).slice(0, 6);
    if (candidates.length === 0) {
      rows.push({ key: target.key, model: null, status: "SKIP", detail: "not present in live OmniRoute catalog" });
      continue;
    }

    let selected: string | null = null;
    let lastDetail = "not probed";
    for (const model of candidates) {
      const probe = await probeModel(endpoint, key, model, target.timeoutMs);
      lastDetail = probe.detail;
      if (probe.ok) {
        selected = model;
        break;
      }
    }

    if (!selected) {
      rows.push({ key: target.key, model: candidates[0] ?? null, status: "FAILED", detail: lastDetail });
      continue;
    }

    updates[target.envName] = selected;
    working.push(selected);
    rows.push({ key: target.key, model: selected, status: "PASS", detail: "live inference probe passed" });
  }

  printRows(rows);
  if (working.length === 0) {
    console.log("\nFree swarm: no live no-auth route; keeping the existing chat route.");
    return rows;
  }

  const currentPrimary = process.env.KOORDYNATOR_CHAT_MODEL?.trim();
  const currentFallbacks = (process.env.KOORDYNATOR_FALLBACK_MODELS ?? "")
    .split(",")
    .map(model => model.trim())
    .filter(Boolean);
  const selection = mergeSwarmSelection(working, currentPrimary, currentFallbacks);
  if (!selection.primary) return rows;

  updates.KOORDYNATOR_CHAT_MODEL = selection.primary;
  updates.KOORDYNATOR_FALLBACK_MODELS = selection.fallbacks.join(",");
  persist(updates);

  console.log(`\nFree swarm primary: ${selection.primary}`);
  if (selection.fallbacks.length > 0) console.log(`Free swarm fallbacks: ${selection.fallbacks.join(" -> ")}`);
  return rows;
}
