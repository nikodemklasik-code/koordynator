import type { ProviderHealth } from "../api/provider-contract.js";

export type OmniRouteFamily =
  | "opencode-free"
  | "claude"
  | "grok"
  | "codex"
  | "github"
  | "gemini"
  | "kimi"
  | "qoder"
  | "cursor"
  | "kilocode"
  | "cline"
  | "duckduckgo"
  | "uncloseai"
  | "aihorde"
  | "amazonq"
  | "antigravity"
  | "kiro"
  | "qwen";

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

type RouteTarget = {
  family: OmniRouteFamily;
  label: string;
  prefixes: string[];
  preferred: string[];
  connectCommand: string;
  noAuth?: boolean;
};

const TARGETS: RouteTarget[] = [
  {
    family: "opencode-free",
    label: "OpenCode Free",
    prefixes: ["oc/"],
    preferred: ["oc/big-pickle"],
    connectCommand: "No upstream login required; refresh the OmniRoute catalog.",
    noAuth: true
  },
  {
    family: "claude",
    label: "Claude (OmniRoute)",
    prefixes: ["cc/", "claude-code/"],
    preferred: ["cc/claude-opus-5", "cc/claude-sonnet-5", "cc/claude-opus-4-8"],
    connectCommand: "omniroute providers auth claude-code"
  },
  {
    family: "grok",
    label: "Grok (OmniRoute)",
    prefixes: ["gc/", "xao/"],
    preferred: ["gc/grok-4.6", "gc/grok-4.5"],
    connectCommand: "omniroute providers auth grok-cli"
  },
  {
    family: "codex",
    label: "Codex (OmniRoute)",
    prefixes: ["cx/", "codex/"],
    preferred: ["cx/gpt-5.5", "cx/gpt-5.6-sol"],
    connectCommand: "node scripts/ai-connect-existing.mjs"
  },
  {
    family: "github",
    label: "GitHub Copilot",
    prefixes: ["gh/", "github/", "github-copilot/"],
    preferred: [],
    connectCommand: "omniroute providers auth github"
  },
  {
    family: "gemini",
    label: "Gemini CLI",
    prefixes: ["gemini-cli/"],
    preferred: [],
    connectCommand: "omniroute providers auth gemini-cli"
  },
  {
    family: "kimi",
    label: "Kimi Coding",
    prefixes: ["kmc/"],
    preferred: ["kmc/kimi-k2.6"],
    connectCommand: "omniroute providers auth kimi-coding"
  },
  {
    family: "qoder",
    label: "Qoder",
    prefixes: ["if/", "qoder/"],
    preferred: [],
    connectCommand: "omniroute providers auth qoder"
  },
  {
    family: "cursor",
    label: "Cursor",
    prefixes: ["cu/"],
    preferred: [],
    connectCommand: "omniroute oauth start --provider cursor --import-from-system"
  },
  {
    family: "kilocode",
    label: "KiloCode",
    prefixes: ["kc/"],
    preferred: [],
    connectCommand: "omniroute providers auth kilocode"
  },
  {
    family: "cline",
    label: "Cline",
    prefixes: ["cl/"],
    preferred: [],
    connectCommand: "omniroute providers auth cline"
  },
  {
    family: "duckduckgo",
    label: "DuckDuckGo AI",
    prefixes: ["ddgw/"],
    preferred: ["ddgw/gpt-5.4-mini"],
    connectCommand: "No upstream login required; refresh the OmniRoute catalog.",
    noAuth: true
  },
  {
    family: "uncloseai",
    label: "UncloseAI",
    prefixes: ["unc/"],
    preferred: [],
    connectCommand: "No upstream login required; refresh the OmniRoute catalog.",
    noAuth: true
  },
  {
    family: "aihorde",
    label: "AI Horde",
    prefixes: ["horde/"],
    preferred: [],
    connectCommand: "No upstream login required; refresh the OmniRoute catalog.",
    noAuth: true
  },
  {
    family: "amazonq",
    label: "Amazon Q",
    prefixes: ["aq/"],
    preferred: [],
    connectCommand: "omniroute providers auth amazonq"
  },
  {
    family: "antigravity",
    label: "Antigravity",
    prefixes: ["agy/"],
    preferred: [],
    connectCommand: "omniroute providers auth antigravity"
  },
  {
    family: "kiro",
    label: "Kiro",
    prefixes: ["kr/"],
    preferred: [],
    connectCommand: "omniroute providers auth kiro"
  },
  {
    family: "qwen",
    label: "Qwen OAuth",
    prefixes: ["qw/", "qwen-oauth/"],
    preferred: [],
    connectCommand: "omniroute providers auth qwen-oauth"
  }
];

function normalizeEndpoint(value: string): string {
  return value.replace(/\/+$/, "");
}

function firstModel(target: RouteTarget, preferred: Partial<Record<OmniRouteFamily, string[]>>, available: string[]): string | null {
  const preferredModels = preferred[target.family]?.length ? preferred[target.family]! : target.preferred;
  for (const model of preferredModels) if (available.includes(model)) return model;
  return available.find((model) => target.prefixes.some((prefix) => model.startsWith(prefix))) ?? null;
}

function targetByProviderId(providerId: string): RouteTarget | undefined {
  return TARGETS.find((target) => `omni-${target.family}` === providerId);
}

export class OmniRouteLiveStatusService {
  private readonly endpoint: string;
  private readonly apiKey: string | undefined;
  private readonly apiKeyEnv: string;
  private readonly fetchImpl: typeof fetch;
  private readonly preferredModels: Partial<Record<OmniRouteFamily, string[]>>;
  private cache: { value: OmniRouteLiveStatus[]; expiresAt: number } | null = null;

  constructor(options: OmniRouteLiveOptions = {}) {
    this.endpoint = normalizeEndpoint(options.endpoint ?? "http://127.0.0.1:20128/v1");
    this.apiKey = options.apiKey;
    this.apiKeyEnv = options.apiKeyEnv ?? "OMNIROUTE_API_KEY";
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.preferredModels = options.preferredModels ?? {};
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
      if (response.status === 401 || response.status === 403) return { health: "AUTH_REQUIRED", detail: `HTTP ${response.status}` };
      if (response.status === 429) return { health: "RATE_LIMITED", detail: "Upstream quota/rate limit" };
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
      const missing = TARGETS.map((target) => ({
        providerId: `omni-${target.family}`,
        family: target.family,
        label: target.label,
        model: this.preferredModels[target.family]?.[0] ?? target.preferred[0] ?? "-",
        health: "AUTH_REQUIRED" as ProviderHealth,
        transport: "OMNIROUTE" as const,
        connectAction: "GATEWAY KEY",
        doctorCommand: `curl -sS ${this.endpoint}/models`,
        connectCommand: "omniroute serve --daemon --no-open",
        detail: "OMNIROUTE_API_KEY missing (Keychain/env)",
        checkedAt
      }));
      this.cache = { value: missing, expiresAt: now + 5_000 };
      return missing;
    }

    const available = await this.listModels(key);
    const out = await Promise.all(TARGETS.map(async (target): Promise<OmniRouteLiveStatus> => {
      const model = firstModel(target, this.preferredModels, available);
      if (!model) {
        return {
          providerId: `omni-${target.family}`,
          family: target.family,
          label: target.label,
          model: "-",
          health: "UNAVAILABLE",
          transport: "OMNIROUTE",
          connectAction: target.noAuth ? "CATALOG" : "CONNECT",
          doctorCommand: `curl -sS -H "authorization: Bearer $OMNIROUTE_API_KEY" ${this.endpoint}/models`,
          connectCommand: target.connectCommand,
          detail: target.noAuth ? "No matching no-auth model in live OmniRoute catalog" : "No matching authenticated route in live OmniRoute catalog",
          checkedAt
        };
      }
      const probe = await this.probe(model, key);
      return {
        providerId: `omni-${target.family}`,
        family: target.family,
        label: target.label,
        model,
        health: probe.health,
        transport: "OMNIROUTE",
        connectAction: probe.health === "HEALTHY"
          ? "READY"
          : probe.health === "RATE_LIMITED"
            ? "QUOTA"
            : probe.health === "AUTH_REQUIRED"
              ? "AUTH"
              : target.noAuth
                ? "RETRY"
                : "CONNECT",
        doctorCommand: `curl -sS -H "authorization: Bearer $OMNIROUTE_API_KEY" ${this.endpoint}/models`,
        connectCommand: target.connectCommand,
        detail: probe.detail,
        checkedAt
      };
    }));

    this.cache = { value: out, expiresAt: now + 10_000 };
    return out;
  }

  async doctor(providerId: string, force = false): Promise<OmniRouteLiveStatus | null> {
    const routes = await this.list(force);
    return routes.find((item) => item.providerId === providerId) ?? null;
  }

  async connect(providerId: string): Promise<{ ok: true; action: string; command: string; status: OmniRouteLiveStatus }> {
    const target = targetByProviderId(providerId);
    if (!target) throw Object.assign(new Error("PROVIDER_NOT_FOUND"), { code: "PROVIDER_NOT_FOUND", status: 404 });
    const status = await this.doctor(providerId, true);
    if (!status) throw Object.assign(new Error("PROVIDER_NOT_FOUND"), { code: "PROVIDER_NOT_FOUND", status: 404 });
    if (status.health === "HEALTHY") return { ok: true, action: "READY", command: `Ready · ${status.model}`, status };
    if (status.health === "RATE_LIMITED") return { ok: true, action: "STATUS", command: `Model ${status.model} is rate-limited. Another healthy route should be used until quota resets.`, status };
    return { ok: true, action: target.noAuth ? "RETRY" : "OPEN", command: target.connectCommand, status };
  }
}
