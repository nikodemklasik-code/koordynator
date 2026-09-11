import type { ProviderHealth } from "../api/provider-contract.js";

export type OmniRouteFamily = "claude" | "grok" | "codex";

export type OmniRouteLiveStatus = {
  providerId: string;
  family: OmniRouteFamily;
  label: string;
  model: string;
  health: ProviderHealth;
  transport: "OMNIROUTE";
  connectAction: string;
  doctorCommand: string;
  connectCommand: string;
  detail: string;
  checkedAt: string;
};

export type OmniRouteLiveOptions = {
  endpoint?: string;
  apiKey?: string;
  apiKeyEnv?: string;
  fetchImpl?: typeof fetch;
  preferredModels?: Partial<Record<OmniRouteFamily, string[]>>;
};

const DEFAULT_MODELS: Record<OmniRouteFamily, string[]> = {
  claude: ["cc/claude-opus-5", "cc/claude-sonnet-5", "cc/claude-opus-4-8"],
  grok: ["gc/grok-4.6", "gc/grok-4.5"],
  codex: ["cx/gpt-5.5", "cx/gpt-5.6-sol"]
};

function normalizeEndpoint(value: string): string {
  return value.replace(/\/+$/, "");
}

export class OmniRouteLiveStatusService {
  private readonly endpoint: string;
  private readonly apiKey: string | undefined;
  private readonly apiKeyEnv: string;
  private readonly fetchImpl: typeof fetch;
  private readonly preferredModels: Record<OmniRouteFamily, string[]>;
  private cache: { value: OmniRouteLiveStatus[]; expiresAt: number } | null = null;

  constructor(options: OmniRouteLiveOptions = {}) {
    this.endpoint = normalizeEndpoint(options.endpoint ?? "http://127.0.0.1:20128/v1");
    this.apiKey = options.apiKey;
    this.apiKeyEnv = options.apiKeyEnv ?? "OMNIROUTE_API_KEY";
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.preferredModels = {
      claude: options.preferredModels?.claude?.length ? options.preferredModels.claude : DEFAULT_MODELS.claude,
      grok: options.preferredModels?.grok?.length ? options.preferredModels.grok : DEFAULT_MODELS.grok,
      codex: options.preferredModels?.codex?.length ? options.preferredModels.codex : DEFAULT_MODELS.codex
    };
  }

  private credential(): string {
    return (this.apiKey ?? process.env[this.apiKeyEnv] ?? "").trim();
  }

  private async listModels(key: string): Promise<string[]> {
    const response = await this.fetchImpl(`${this.endpoint}/models`, {
      headers: { accept: "application/json", authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(8_000)
    });
    if (!response.ok) return [];
    const payload = await response.json() as { data?: Array<{ id?: string }> };
    return (payload.data ?? []).map((item) => String(item.id || "")).filter(Boolean);
  }

  private pickModel(family: OmniRouteFamily, available: string[]): string {
    const preferred = this.preferredModels[family];
    for (const model of preferred) {
      if (available.includes(model)) return model;
    }
    const prefixes = family === "claude" ? ["cc/"] : family === "grok" ? ["gc/", "xao/"] : ["cx/", "codex/"];
    return available.find((model) => prefixes.some((prefix) => model.startsWith(prefix)))
      || preferred[0]
      || DEFAULT_MODELS[family][0]!;
  }

  private async probe(model: string, key: string): Promise<{ health: ProviderHealth; detail: string }> {
    try {
      const response = await this.fetchImpl(`${this.endpoint}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${key}`
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: "PING" }],
          stream: false,
          max_tokens: 8
        }),
        signal: AbortSignal.timeout(20_000)
      });
      if (response.status === 401 || response.status === 403) {
        return { health: "AUTH_REQUIRED", detail: `HTTP ${response.status}` };
      }
      if (response.status === 429) {
        return { health: "RATE_LIMITED", detail: "Upstream quota/rate limit" };
      }
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        return { health: "DEGRADED", detail: `HTTP ${response.status}${text ? `: ${text.slice(0, 120)}` : ""}` };
      }
      const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      const content = payload.choices?.[0]?.message?.content ?? "";
      if (!String(content).trim()) return { health: "DEGRADED", detail: "Empty model response" };
      return { health: "HEALTHY", detail: "Live inference probe passed" };
    } catch (error) {
      return { health: "UNAVAILABLE", detail: error instanceof Error ? error.message : "Probe failed" };
    }
  }

  async list(force = false): Promise<OmniRouteLiveStatus[]> {
    const now = Date.now();
    if (!force && this.cache && this.cache.expiresAt > now) return this.cache.value;
    const key = this.credential();
    const checkedAt = new Date().toISOString();
    if (!key) {
      const missing = (["claude", "grok", "codex"] as OmniRouteFamily[]).map((family) => ({
        providerId: `omni-${family}`,
        family,
        label: family === "claude" ? "Claude (OmniRoute)" : family === "grok" ? "Grok (OmniRoute)" : "Codex (OmniRoute)",
        model: this.preferredModels[family][0] ?? DEFAULT_MODELS[family][0]!,
        health: "AUTH_REQUIRED" as ProviderHealth,
        transport: "OMNIROUTE" as const,
        connectAction: "Open OmniRoute and ensure gateway key is in Keychain/env",
        doctorCommand: `curl -sS ${this.endpoint}/models`,
        connectCommand: "omniroute serve --daemon --no-open",
        detail: "OMNIROUTE_API_KEY missing (Keychain/env)",
        checkedAt
      }));
      this.cache = { value: missing, expiresAt: now + 5_000 };
      return missing;
    }

    const available = await this.listModels(key);
    const out: OmniRouteLiveStatus[] = [];
    for (const family of ["claude", "grok", "codex"] as OmniRouteFamily[]) {
      const model = this.pickModel(family, available);
      const probe = available.length === 0
        ? { health: "UNAVAILABLE" as ProviderHealth, detail: "Model catalog unavailable" }
        : await this.probe(model, key);
      out.push({
        providerId: `omni-${family}`,
        family,
        label: family === "claude" ? "Claude (OmniRoute)" : family === "grok" ? "Grok (OmniRoute)" : "Codex (OmniRoute)",
        model,
        health: probe.health,
        transport: "OMNIROUTE",
        connectAction: probe.health === "HEALTHY"
          ? "READY"
          : probe.health === "RATE_LIMITED"
            ? "STATUS"
            : "OPEN",
        doctorCommand: `curl -sS -H "authorization: Bearer $OMNIROUTE_API_KEY" ${this.endpoint}/models`,
        connectCommand: probe.health === "HEALTHY"
          ? `Ready · ${model}`
          : "omniroute serve --daemon --no-open && npm run ai:always-on",
        detail: probe.detail,
        checkedAt
      });
    }
    this.cache = { value: out, expiresAt: now + 10_000 };
    return out;
  }

  async doctor(providerId: string, force = false): Promise<OmniRouteLiveStatus | null> {
    const routes = await this.list(force);
    return routes.find((item) => item.providerId === providerId) ?? null;
  }

  async connect(providerId: string): Promise<{ ok: true; action: string; command: string; status: OmniRouteLiveStatus }> {
    const status = await this.doctor(providerId, true);
    if (!status) throw Object.assign(new Error("PROVIDER_NOT_FOUND"), { code: "PROVIDER_NOT_FOUND", status: 404 });
    if (status.health === "HEALTHY") {
      return { ok: true, action: "READY", command: status.connectCommand, status };
    }
    if (status.health === "RATE_LIMITED") {
      return { ok: true, action: "STATUS", command: `Model ${status.model} is rate-limited. Try Claude/Grok or wait for quota reset.`, status };
    }
    return {
      ok: true,
      action: "OPEN",
      command: status.connectCommand,
      status
    };
  }
}
