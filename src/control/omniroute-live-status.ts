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
  deprecated?: boolean;
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
    connectCommand: "omniroute oauth start --provider claude-code"
  },
  {
    family: "grok",
    label: "Grok (OmniRoute)",
    prefixes: ["gc/", "xao/"],
    preferred: ["gc/grok-4.6", "gc/grok-4.5"],
    connectCommand: "omniroute oauth start --provider grok-cli"
  },
  {
    family: "codex",
    label: "Codex (OmniRoute)",
    prefixes: ["cx/", "codex/"],
    preferred: ["cx/gpt-5.6-sol", "cx/gpt-5.5"],
    connectCommand: "node scripts/ai-connect-existing.mjs"
  },
  {
    family: "github",
    label: "GitHub Copilot",
    prefixes: ["gh/", "github/", "github-copilot/"],
    preferred: [],
    connectCommand: "omniroute oauth start --provider github"
  },
  {
    family: "gemini",
    label: "Gemini CLI",
    prefixes: ["gemini-cli/"],
    preferred: [],
    connectCommand: "omniroute oauth start --provider gemini-cli"
  },
  {
    family: "kimi",
    label: "Kimi Coding",
    prefixes: ["kmc/"],
    preferred: ["kmc/kimi-k2.6"],
    connectCommand: "omniroute oauth start --provider kimi-coding"
  },
  {
    family: "qoder",
    label: "Qoder",
    prefixes: ["if/", "qoder/"],
    preferred: [],
    connectCommand: "Use a Qoder PAT, or configure QODER_OAUTH_* before using the experimental browser OAuth flow."
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
    connectCommand: "omniroute oauth start --provider kilocode"
  },
  {
    family: "cline",
    label: "Cline",
    prefixes: ["cl/"],
    preferred: [],
    connectCommand: "omniroute oauth start --provider cline"
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
    connectCommand: "omniroute oauth start --provider amazon-q"
  },
  {
    family: "antigravity",
    label: "Antigravity",
    prefixes: ["agy/"],
    preferred: [],
    connectCommand: "omniroute oauth start --provider antigravity"
  },
  {
    family: "kiro",
    label: "Kiro",
    prefixes: ["kr/"],
    preferred: [],
    connectCommand: "omniroute oauth start --provider kiro"
  },
  {
    family: "qwen",
    label: "Qwen OAuth (deprecated)",
    prefixes: ["qw/", "qwen-oauth/"],
    preferred: [],
    connectCommand: "Qwen OAuth free tier is deprecated/discontinued upstream; migrate to Alibaba/Bailian/OpenRouter.",
    deprecated: true
  }
];

function normalizeEndpoint(value: string): string {
  return value.replace(/\/+$/, "");
}

function modelsFor(target: RouteTarget, preferred: Partial<Record<OmniRouteFamily, string[]>>, available: string[]): string[] {
  const preferredModels = preferred[target.family]?.length ? preferred[target.family]! : target.preferred;
  const matches = available.filter((model) => target.prefixes.some((prefix) => model.startsWith(prefix)));
  const rank = new Map(preferredModels.map((model, index) => [model, index]));
  return matches.sort((left, right) => (rank.get(left) ?? 999) - (rank.get(right) ?? 999) || left.localeCompare(right));
}

function targetByProviderId(providerId: string): RouteTarget | undefined {
  return TARGETS.find((target) => `omni-${target.family}` === providerId);
}

function healthRank(health: ProviderHealth): number {
  if (health === "HEALTHY") return 100;
  if (health === "RATE_LIMITED") return 80;
  if (health === "AUTH_REQUIRED") return 70;
  if (health === "DEGRADED") return 60;
  if (health === "BLOCKED") return 30;
  if (health === "QUARANTINED") return 20;
  return 10;
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

  private async bestProbe(target: RouteTarget, available: string[], key: string): Promise<{ model: string | null; health: ProviderHealth; detail: string }> {
    const candidates = modelsFor(target, this.preferredModels, available).slice(0, 8);
    if (!candidates.length) {
      return {
        model: null,
        health: "UNAVAILABLE",
        detail: target.deprecated
          ? "Deprecated route has no live model; migrate to a current provider"
          : target.noAuth
            ? "No matching no-auth model in live OmniRoute catalog"
            : "No matching authenticated route in live OmniRoute catalog"
      };
    }

    let best = { model: candidates[0]!, health: "UNAVAILABLE" as ProviderHealth, detail: "Not probed" };
    for (const model of candidates) {
      const probe = await this.probe(model, key);
      const current = { model, ...probe };
      if (probe.health === "HEALTHY") return current;
      if (healthRank(probe.health) > healthRank(best.health)) best = current;
    }
    return best;
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
      const probe = await this.bestProbe(target, available, key);
      const model = probe.model ?? "-";
      return {
        providerId: `omni-${target.family}`,
        family: target.family,
        label: target.label,
        model,
        health: probe.health,
        transport: "OMNIROUTE",
        connectAction: target.deprecated
          ? "MIGRATE"
          : probe.health === "HEALTHY"
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
    if (target.deprecated) return { ok: true, action: "MIGRATE", command: target.connectCommand, status };
    if (status.health === "HEALTHY") return { ok: true, action: "READY", command: `Ready · ${status.model}`, status };
    if (status.health === "RATE_LIMITED") return { ok: true, action: "STATUS", command: `Model ${status.model} is rate-limited. Another healthy route should be used until quota resets.`, status };
    return { ok: true, action: target.noAuth ? "RETRY" : "OPEN", command: target.connectCommand, status };
  }
}
