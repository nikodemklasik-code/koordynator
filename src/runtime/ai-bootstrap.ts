import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { resolveOmniRouteApiKey } from "./local-config.js";

export type AiBootstrapRow = {
  key: string;
  model: string | null;
  status: "PASS" | "SKIP" | "MISSING" | "FAILED";
  detail: string;
};

type Target = {
  key: string;
  prefixes: string[];
  envName: string;
  preferred: string[];
  localImport?: "codex";
};

export type AiBootstrapOptions = {
  /** Never opens OAuth/login flows. Kept explicit so app startup cannot surprise the operator. */
  interactive?: false;
};

export const AI_TARGETS: Target[] = [
  { key: "openai", prefixes: ["cx/"], envName: "KOORDYNATOR_OPENAI_MODEL", preferred: ["cx/gpt-5.6-sol", "cx/gpt-5.5"], localImport: "codex" },
  { key: "anthropic", prefixes: ["cc/"], envName: "KOORDYNATOR_ANTHROPIC_MODEL", preferred: ["cc/claude-opus-5", "cc/claude-sonnet-5", "cc/claude-opus-4-8"] },
  { key: "github", prefixes: ["gh/"], envName: "KOORDYNATOR_GITHUB_COPILOT_MODEL", preferred: [] },
  { key: "grok", prefixes: ["gc/", "xao/"], envName: "KOORDYNATOR_GROK_MODEL", preferred: ["gc/grok-4.6", "gc/grok-4.5"] },
  { key: "gemini", prefixes: ["gemini-cli/"], envName: "KOORDYNATOR_GEMINI_MODEL", preferred: [] },
  { key: "kiro", prefixes: ["kr/", "kiro/"], envName: "KOORDYNATOR_KIRO_MODEL", preferred: [] },
  { key: "qwen", prefixes: ["qw/", "qwen-oauth/"], envName: "KOORDYNATOR_QWEN_MODEL", preferred: [] },
  { key: "kimi", prefixes: ["kmc/"], envName: "KOORDYNATOR_KIMI_MODEL", preferred: ["kmc/kimi-k2.6"] },
  { key: "qoder", prefixes: ["if/"], envName: "KOORDYNATOR_QODER_MODEL", preferred: [] },
  { key: "astra", prefixes: ["cx/gpt-6-astra", "codex/gpt-6-astra"], envName: "KOORDYNATOR_ASTRA_MODEL", preferred: ["cx/gpt-6-astra", "cx/gpt-6-astra-pro"] },
  { key: "cursor", prefixes: ["cu/"], envName: "KOORDYNATOR_CURSOR_MODEL", preferred: [] },
  { key: "kilocode", prefixes: ["kc/"], envName: "KOORDYNATOR_KILOCODE_MODEL", preferred: [] },
  { key: "cline", prefixes: ["cl/"], envName: "KOORDYNATOR_CLINE_MODEL", preferred: [] },
  { key: "amazonq", prefixes: ["aq/"], envName: "KOORDYNATOR_AMAZON_Q_MODEL", preferred: [] },
  { key: "antigravity", prefixes: ["agy/"], envName: "KOORDYNATOR_ANTIGRAVITY_MODEL", preferred: [] }
];

/** Free OAuth first, then strongest subscription harness; Codex/OpenAI last (quota-prone). */
export const CHAT_MODEL_PRIORITY = [
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
  "KOORDYNATOR_ASTRA_MODEL",
  "KOORDYNATOR_OPENAI_MODEL"
] as const;

export function selectChatModels(updates: Record<string, string>): { primary: string | null; fallbacks: string[] } {
  const ordered = CHAT_MODEL_PRIORITY
    .map(key => updates[key]?.trim())
    .filter((model): model is string => Boolean(model));
  const unique = [...new Set(ordered)];
  return { primary: unique[0] ?? null, fallbacks: unique.slice(1, 7) };
}

type ApiFetch = (path: string, opts?: Record<string, unknown>) => Promise<Response>;

function sleep(ms: number): Promise<void> {
  return new Promise(resolveSleep => setTimeout(resolveSleep, ms));
}

function endpointRoot(endpoint: string): string {
  const url = new URL(endpoint);
  url.pathname = url.pathname.replace(/\/+$/, "").replace(/\/v1$/, "") || "/";
  return url.toString().replace(/\/$/, "");
}

function command(name: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(name, args, {
    encoding: "utf8",
    stdio: "pipe",
    env: process.env
  });
  return {
    status: result.status ?? 1,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? "")
  };
}

export function gatewayKey(): string {
  return resolveOmniRouteApiKey(process.env);
}

async function serverUp(root: string): Promise<boolean> {
  try {
    const response = await fetch(`${root}/api/health`, { signal: AbortSignal.timeout(1500) });
    return response.status < 500;
  } catch {
    return false;
  }
}

async function ensureServer(root: string): Promise<void> {
  if (await serverUp(root)) return;
  const started = command("omniroute", ["serve", "--daemon", "--no-open"]);
  if (started.status !== 0) throw new Error("OMNIROUTE_START_FAILED");
  for (let i = 0; i < 20; i += 1) {
    await sleep(250);
    if (await serverUp(root)) return;
  }
  throw new Error("OMNIROUTE_NOT_READY");
}

function globalOmniRouteApiModule(): string {
  const candidates: string[] = [];
  const npmRoot = command("npm", ["root", "-g"]);
  if (npmRoot.status === 0 && npmRoot.stdout.trim()) {
    candidates.push(join(npmRoot.stdout.trim(), "omniroute", "bin", "cli", "api.mjs"));
  }
  candidates.push(join(homedir(), ".local", "lib", "node_modules", "omniroute", "bin", "cli", "api.mjs"));
  const path = candidates.find(candidate => existsSync(candidate));
  if (!path) throw new Error("OMNIROUTE_CLI_MODULE_NOT_FOUND");
  return path;
}

async function managementApiFetch(): Promise<ApiFetch> {
  const modulePath = globalOmniRouteApiModule();
  const imported = await import(pathToFileURL(modulePath).href) as { apiFetch?: ApiFetch };
  if (typeof imported.apiFetch !== "function") throw new Error("OMNIROUTE_APIFETCH_NOT_FOUND");
  return imported.apiFetch;
}

async function fetchModels(endpoint: string, key: string): Promise<string[]> {
  const headers: Record<string, string> = {};
  if (key) headers.authorization = `Bearer ${key}`;
  const response = await fetch(`${endpoint.replace(/\/+$/, "")}/models`, {
    headers,
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`OMNIROUTE_MODELS_HTTP_${response.status}`);
  const payload = await response.json() as { data?: Array<{ id?: unknown }> };
  return [...new Set((payload.data ?? []).map(item => typeof item.id === "string" ? item.id : "").filter(Boolean))].sort();
}

function modelsFor(target: Target, models: string[]): string[] {
  const found = models.filter(model => target.prefixes.some(prefix => model.startsWith(prefix)));
  const rank = new Map(target.preferred.map((model, index) => [model, index]));
  return found.sort((a, b) => (rank.get(a) ?? 999) - (rank.get(b) ?? 999) || a.localeCompare(b));
}

async function probeModel(endpoint: string, key: string, model: string): Promise<{ ok: boolean; detail: string }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (key) headers.authorization = `Bearer ${key}`;
  let response: Response;
  try {
    response = await fetch(`${endpoint.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        stream: false,
        max_tokens: 24,
        messages: [{ role: "user", content: "Reply exactly: KOORDYNATOR_BOOTSTRAP_OK" }]
      }),
      signal: AbortSignal.timeout(45000)
    });
  } catch {
    return { ok: false, detail: "request failed or timed out" };
  }
  if (response.ok) return { ok: true, detail: `HTTP ${response.status}` };
  let detail = `HTTP ${response.status}`;
  try {
    const body = await response.json() as { detail?: unknown; error?: { message?: unknown } };
    const text = typeof body.detail === "string"
      ? body.detail
      : typeof body.error?.message === "string"
        ? body.error.message
        : "";
    if (/not supported|not entitled|model/i.test(text)) detail = `${detail} model unavailable`;
  } catch {
    // Never print upstream bodies: they may contain credentials or internal metadata.
  }
  return { ok: false, detail };
}

async function importCodex(apiFetch: ApiFetch): Promise<boolean> {
  const authPath = join(homedir(), ".codex", "auth.json");
  if (!existsSync(authPath)) return false;
  let auth: unknown;
  try {
    auth = JSON.parse(readFileSync(authPath, "utf8"));
  } catch {
    return false;
  }
  const response = await apiFetch("/api/providers/codex-auth/import", {
    method: "POST",
    body: { source: { kind: "json", json: auth }, name: "OpenAI Codex", overwriteExisting: true },
    acceptNotOk: true,
    retry: false
  });
  return response.ok;
}

export function mergeEnvText(original: string, updates: Record<string, string>): string {
  const remaining = new Map(Object.entries(updates));
  const output = original.split(/\r?\n/).map(line => {
    const match = /^([A-Z][A-Z0-9_]*)=/.exec(line);
    if (!match) return line;
    const key = match[1];
    if (!key || !remaining.has(key)) return line;
    const value = remaining.get(key) ?? "";
    remaining.delete(key);
    return `${key}=${value}`;
  });
  if (remaining.size > 0) {
    if (output.length > 0 && output[output.length - 1] !== "") output.push("");
    output.push("# Managed by npm run ai:bootstrap");
    for (const [key, value] of remaining) output.push(`${key}=${value}`);
  }
  return `${output.join("\n").replace(/\n+$/, "")}\n`;
}

function persistModels(updates: Record<string, string>, envPath = resolve(".env")): void {
  let original = "";
  if (existsSync(envPath)) original = readFileSync(envPath, "utf8");
  writeFileSync(envPath, mergeEnvText(original, updates), { encoding: "utf8", mode: 0o600 });
  try {
    chmodSync(envPath, 0o600);
  } catch {
    // best effort
  }
  for (const [key, value] of Object.entries(updates)) process.env[key] = value;
}

function printRows(rows: AiBootstrapRow[]): void {
  const width = Math.max(...rows.map(row => row.key.length), 8);
  console.log("\nAI startup routes");
  for (const row of rows) {
    console.log(`${row.key.padEnd(width)}  ${row.status.padEnd(7)}  ${(row.model ?? "-").padEnd(34)} ${row.detail}`);
  }
}

/**
 * Non-interactive by design. Application startup must never open OAuth pages or
 * require provider logins. It discovers routes already persisted in OmniRoute,
 * imports an existing local Codex session when available, probes real inference,
 * and skips everything else.
 */
export async function bootstrapAi(_options: AiBootstrapOptions = {}): Promise<AiBootstrapRow[]> {
  const endpoint = process.env.OMNIROUTE_ENDPOINT?.trim() || "http://127.0.0.1:20128/v1";
  const root = endpointRoot(endpoint);
  await ensureServer(root);
  const key = gatewayKey();
  if (!key) throw new Error("OMNIROUTE_GATEWAY_KEY_MISSING");
  process.env.OMNIROUTE_API_KEY = key;
  const apiFetch = await managementApiFetch();

  let models = await fetchModels(endpoint, key);
  const rows: AiBootstrapRow[] = [];
  const updates: Record<string, string> = {};

  for (const target of AI_TARGETS) {
    let candidates = modelsFor(target, models);

    // Safe local reuse only. No browser/device OAuth is ever started here.
    if (candidates.length === 0 && target.localImport === "codex") {
      const imported = await importCodex(apiFetch);
      if (imported) {
        await sleep(500);
        models = await fetchModels(endpoint, key);
        candidates = modelsFor(target, models);
      }
    }

    if (candidates.length === 0) {
      rows.push({
        key: target.key,
        model: null,
        status: "SKIP",
        detail: "not connected in OmniRoute; skipped without login"
      });
      continue;
    }

    let selected: string | null = null;
    let lastDetail = "not probed";
    for (const model of candidates.slice(0, 8)) {
      const probe = await probeModel(endpoint, key, model);
      lastDetail = probe.detail;
      if (probe.ok) {
        selected = model;
        break;
      }
    }

    if (!selected) {
      rows.push({
        key: target.key,
        model: candidates[0] ?? null,
        status: "FAILED",
        detail: lastDetail
      });
      continue;
    }

    updates[target.envName] = selected;
    rows.push({
      key: target.key,
      model: selected,
      status: "PASS",
      detail: "live inference probe passed"
    });
  }

  const selected = selectChatModels(updates);
  if (!selected.primary) {
    printRows(rows);
    throw new Error("NO_WORKING_OMNIROUTE_AI_ROUTE");
  }
  updates.KOORDYNATOR_CHAT_MODEL = selected.primary;
  if (selected.fallbacks.length > 0) updates.KOORDYNATOR_FALLBACK_MODELS = selected.fallbacks.join(",");
  persistModels(updates);
  printRows(rows);
  if (selected.primary) {
    console.log(`\nPrimary chat model: ${selected.primary}`);
    if (selected.fallbacks.length > 0) console.log(`Fallbacks: ${selected.fallbacks.join(" -> ")}`);
  }
  return rows;
}
