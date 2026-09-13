import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { mergeEnvText } from "./ai-bootstrap.js";
import { omniRouteSettings } from "./local-config.js";
import { ChatModelCatalogService } from "../control/chat-model-catalog.js";
import { selectWorkingFreeRoutes } from "./free-routes.js";

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
  const settings = omniRouteSettings();
  const freeOnly = process.env.KOORDYNATOR_FREE_ONLY === "1";
  const live = await new ChatModelCatalogService(settings).list();
  const candidates = freeOnly ? live.models : FREE_SWARM_TARGETS.flatMap(target => modelsForFreeTarget(target, live.models));
  const selection = await selectWorkingFreeRoutes(settings, { catalog: { list: async () => ({ ...live, models: candidates }) } });
  const rows: FreeSwarmRow[] = selection.probes.map(probe => ({
    key: FREE_SWARM_TARGETS.find(target => target.prefixes.some(prefix => probe.model.startsWith(prefix)))?.key ?? "free-route",
    model: probe.model,
    status: probe.status === "PASS" ? "PASS" : "FAILED",
    detail: probe.detail
  }));
  for (const target of FREE_SWARM_TARGETS) {
    if (!rows.some(row => row.key === target.key)) rows.push({ key: target.key, model: null, status: "SKIP", detail: "no catalog-confirmed free route probed" });
  }
  printRows(rows);
  if (!selection.primary) {
    if (freeOnly) throw new Error("FREE_ROUTE_UNAVAILABLE");
    console.log("Free swarm: no verified free tool route; keeping the configured route.");
    return rows;
  }
  const working = [selection.primary, ...selection.fallbacks];
  const selected = freeOnly ? selection : mergeSwarmSelection(working, settings.model,
    (process.env.KOORDYNATOR_FALLBACK_MODELS ?? "").split(","));
  const updates: Record<string, string> = {
    KOORDYNATOR_CHAT_MODEL: selection.primary,
    KOORDYNATOR_FALLBACK_MODELS: selected.fallbacks.join(",")
  };
  for (const target of FREE_SWARM_TARGETS) {
    const model = working.find(value => target.prefixes.some(prefix => value.startsWith(prefix)));
    if (model) updates[target.envName] = model;
  }
  persist(updates);
  console.log(`Free swarm primary: ${selection.primary}`);
  return rows;
}
