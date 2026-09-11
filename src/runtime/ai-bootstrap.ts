import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir, platform, userInfo } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { parseEnv } from "node:util";

export type AiBootstrapRow = {
  key: string;
  model: string | null;
  status: "PASS" | "BLOCKED" | "MISSING" | "FAILED";
  detail: string;
};

type Target = {
  key: string;
  prefixes: string[];
  envName: string;
  preferred: string[];
  auth?: { kind: "cli"; provider: string; args?: string[] } | { kind: "device"; provider: string } | { kind: "codex-import" } | { kind: "agy-import" };
};

export const AI_TARGETS: Target[] = [
  { key: "openai", prefixes: ["cx/"], envName: "KOORDYNATOR_OPENAI_MODEL", preferred: ["cx/gpt-5.5"], auth: { kind: "codex-import" } },
  { key: "anthropic", prefixes: ["cc/"], envName: "KOORDYNATOR_ANTHROPIC_MODEL", preferred: ["cc/claude-opus-5", "cc/claude-sonnet-5"], auth: { kind: "cli", provider: "claude-code" } },
  { key: "github", prefixes: ["gh/"], envName: "KOORDYNATOR_GITHUB_COPILOT_MODEL", preferred: [], auth: { kind: "cli", provider: "copilot" } },
  { key: "grok", prefixes: ["gc/", "xao/"], envName: "KOORDYNATOR_GROK_MODEL", preferred: [], auth: { kind: "device", provider: "grok-cli" } },
  { key: "gemini", prefixes: ["gemini-cli/"], envName: "KOORDYNATOR_GEMINI_MODEL", preferred: [], auth: { kind: "cli", provider: "gemini" } },
  { key: "kimi", prefixes: ["kmc/"], envName: "KOORDYNATOR_KIMI_MODEL", preferred: ["kmc/kimi-k2.6"], auth: { kind: "device", provider: "kimi-coding" } },
  { key: "qoder", prefixes: ["if/"], envName: "KOORDYNATOR_QODER_MODEL", preferred: [] },
  { key: "cursor", prefixes: ["cu/"], envName: "KOORDYNATOR_CURSOR_MODEL", preferred: [], auth: { kind: "cli", provider: "cursor", args: ["--import-from-system"] } },
  { key: "kilocode", prefixes: ["kc/"], envName: "KOORDYNATOR_KILOCODE_MODEL", preferred: [], auth: { kind: "device", provider: "kilocode" } },
  { key: "cline", prefixes: ["cl/"], envName: "KOORDYNATOR_CLINE_MODEL", preferred: [] },
  { key: "amazonq", prefixes: ["aq/"], envName: "KOORDYNATOR_AMAZON_Q_MODEL", preferred: [] },
  { key: "antigravity", prefixes: ["agy/"], envName: "KOORDYNATOR_ANTIGRAVITY_MODEL", preferred: [], auth: { kind: "agy-import" } }
];

type ApiFetch = (path: string, opts?: Record<string, unknown>) => Promise<Response>;

function sleep(ms: number): Promise<void> {
  return new Promise(resolveSleep => setTimeout(resolveSleep, ms));
}

function endpointRoot(endpoint: string): string {
  const url = new URL(endpoint);
  url.pathname = url.pathname.replace(/\/+$/, "").replace(/\/v1$/, "") || "/";
  return url.toString().replace(/\/$/, "");
}

function command(name: string, args: string[], inherit = false): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(name, args, {
    encoding: "utf8",
    stdio: inherit ? "inherit" : "pipe",
    env: process.env
  });
  return {
    status: result.status ?? 1,
    stdout: inherit ? "" : String(result.stdout ?? ""),
    stderr: inherit ? "" : String(result.stderr ?? "")
  };
}

function gatewayKey(): string {
  const fromEnv = process.env.OMNIROUTE_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  if (platform() !== "darwin") return "";
  const account = process.env.USER?.trim() || userInfo().username;
  const result = command("security", ["find-generic-password", "-a", account, "-s", "hermes-omniroute-api-key", "-w"]);
  return result.status === 0 ? result.stdout.trim() : "";
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
  const response = await fetch(`${endpoint.replace(/\/+$/, "")}/models`, { headers, signal: AbortSignal.timeout(10000) });
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
  const response = await fetch(`${endpoint.replace(/\/+$/, "")}/chat/completions`, {
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
  if (response.ok) return { ok: true, detail: `HTTP ${response.status}` };
  let detail = `HTTP ${response.status}`;
  try {
    const body = await response.json() as { detail?: unknown; error?: { message?: unknown } };
    const text = typeof body.detail === "string" ? body.detail : typeof body.error?.message === "string" ? body.error.message : "";
    if (/not supported|not entitled|model/i.test(text)) detail = `${detail} model unavailable`;
  } catch {
    // Deliberately do not print upstream bodies: they may contain credentials or internal metadata.
  }
  return { ok: false, detail };
}

function openUrl(url: string): void {
  if (!url) return;
  const opener = platform() === "darwin" ? ["open", [url]] as const : platform() === "win32" ? ["cmd", ["/c", "start", "", url]] as const : ["xdg-open", [url]] as const;
  const child = spawn(opener[0], opener[1], { detached: true, stdio: "ignore", env: process.env });
  child.unref();
}

async function importCodex(apiFetch: ApiFetch): Promise<boolean> {
  const authPath = join(homedir(), ".codex", "auth.json");
  if (!existsSync(authPath)) return false;
  let auth: unknown;
  try { auth = JSON.parse(readFileSync(authPath, "utf8")); }
  catch { return false; }
  const response = await apiFetch("/api/providers/codex-auth/import", {
    method: "POST",
    body: { source: { kind: "json", json: auth }, name: "OpenAI Codex", overwriteExisting: true },
    acceptNotOk: true,
    retry: false
  });
  return response.ok;
}

async function importAgy(apiFetch: ApiFetch): Promise<boolean> {
  const response = await apiFetch("/api/providers/agy-auth/apply-local", {
    method: "POST",
    body: {},
    acceptNotOk: true,
    retry: false
  });
  return response.ok;
}

async function deviceFlow(apiFetch: ApiFetch, provider: string): Promise<boolean> {
  const start = await apiFetch(`/api/oauth/${provider}/device-code`, { acceptNotOk: true, retry: false });
  if (!start.ok) return false;
  const data = await start.json() as Record<string, unknown>;
  const deviceCode = typeof data.device_code === "string" ? data.device_code : typeof data.deviceCode === "string" ? data.deviceCode : "";
  const userCode = typeof data.user_code === "string" ? data.user_code : typeof data.userCode === "string" ? data.userCode : "";
  const verificationUri = typeof data.verification_uri_complete === "string" ? data.verification_uri_complete : typeof data.verificationUriComplete === "string" ? data.verificationUriComplete : typeof data.verification_uri === "string" ? data.verification_uri : typeof data.verificationUri === "string" ? data.verificationUri : "";
  const codeVerifier = typeof data.codeVerifier === "string" ? data.codeVerifier : undefined;
  const extraData = data.extraData;
  if (!deviceCode || !verificationUri) return false;
  console.log(`${provider}: authorize${userCode ? ` with code ${userCode}` : ""} at ${verificationUri}`);
  openUrl(verificationUri);
  const intervalSeconds = typeof data.interval === "number" && Number.isFinite(data.interval) ? Math.max(2, data.interval) : 5;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    await sleep(intervalSeconds * 1000);
    const body: Record<string, unknown> = { deviceCode };
    if (codeVerifier) body.codeVerifier = codeVerifier;
    if (extraData !== undefined) body.extraData = extraData;
    const poll = await apiFetch(`/api/oauth/${provider}/poll`, { method: "POST", body, acceptNotOk: true, retry: false });
    if (!poll.ok) return false;
    const result = await poll.json() as { success?: unknown; pending?: unknown; error?: unknown };
    if (result.success === true) return true;
    if (result.pending !== true && result.error && result.error !== "authorization_pending" && result.error !== "slow_down") return false;
  }
  return false;
}

function cliOAuth(provider: string, args: string[] = []): boolean {
  if (!process.stdin.isTTY) return false;
  const result = command("omniroute", ["oauth", "start", "--provider", provider, "--timeout", "600000", ...args], true);
  return result.status === 0;
}

async function tryAuth(target: Target, apiFetch: ApiFetch): Promise<boolean> {
  if (!target.auth) return false;
  if (target.auth.kind === "codex-import") return importCodex(apiFetch);
  if (target.auth.kind === "agy-import") return importAgy(apiFetch);
  if (target.auth.kind === "device") {
    if (!process.stdin.isTTY) return false;
    return deviceFlow(apiFetch, target.auth.provider);
  }
  return cliOAuth(target.auth.provider, target.auth.args ?? []);
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
  try { chmodSync(envPath, 0o600); } catch { /* best effort */ }
  for (const [key, value] of Object.entries(updates)) process.env[key] = value;
}

function printRows(rows: AiBootstrapRow[]): void {
  const width = Math.max(...rows.map(row => row.key.length), 8);
  console.log("\nAI bootstrap result");
  for (const row of rows) {
    console.log(`${row.key.padEnd(width)}  ${row.status.padEnd(7)}  ${(row.model ?? "-").padEnd(34)} ${row.detail}`);
  }
}

export async function bootstrapAi(): Promise<AiBootstrapRow[]> {
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
    if (candidates.length === 0 && target.auth) {
      const authorized = await tryAuth(target, apiFetch);
      if (authorized) {
        await sleep(500);
        models = await fetchModels(endpoint, key);
        candidates = modelsFor(target, models);
      }
    }

    if (candidates.length === 0) {
      const detail = target.key === "qoder"
        ? "OAuth browser flow is disabled by OmniRoute 3.8.50 unless QODER_OAUTH_* is configured"
        : "no live protected model route";
      rows.push({ key: target.key, model: null, status: target.auth ? "BLOCKED" : "MISSING", detail });
      continue;
    }

    let selected: string | null = null;
    let lastDetail = "not probed";
    for (const model of candidates.slice(0, 8)) {
      const probe = await probeModel(endpoint, key, model);
      lastDetail = probe.detail;
      if (probe.ok) { selected = model; break; }
    }

    if (!selected) {
      rows.push({ key: target.key, model: candidates[0] ?? null, status: "FAILED", detail: lastDetail });
      continue;
    }

    updates[target.envName] = selected;
    rows.push({ key: target.key, model: selected, status: "PASS", detail: "live inference probe passed" });
  }

  const primary = updates.KOORDYNATOR_OPENAI_MODEL || updates.KOORDYNATOR_ANTHROPIC_MODEL || Object.values(updates)[0];
  if (primary) updates.KOORDYNATOR_CHAT_MODEL = primary;
  persistModels(updates);
  printRows(rows);
  return rows;
}
