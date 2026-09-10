import type { CapabilityRequest, SecurityClass } from "./capability-api.js";
import type { ProviderAdapter, ProviderDescriptor, ProviderHealth, ProviderResult } from "./provider-contract.js";

export type OmniRouteConfig = {
  endpoint?: string;
  apiKey?: string;
  apiKeyEnv?: string;
  defaultModel?: string;
  allowedSecurityClasses?: SecurityClass[];
  fetchImpl?: typeof fetch;
};

type OmniRouteInput = {
  model?: string;
  messages?: Array<{ role: string; content: unknown }>;
  [key: string]: unknown;
};

function normalizeEndpoint(value: string): string {
  return value.replace(/\/+$/, "");
}

function asInput(value: unknown): OmniRouteInput {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) return value as OmniRouteInput;
  return { messages: [{ role: "user", content: typeof value === "string" ? value : JSON.stringify(value) }] };
}

export class OmniRouteProviderAdapter implements ProviderAdapter {
  readonly descriptor: ProviderDescriptor;
  private readonly endpoint: string;
  private readonly apiKey: string | undefined;
  private readonly apiKeyEnv: string;
  private readonly defaultModel: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: OmniRouteConfig = {}) {
    this.endpoint = normalizeEndpoint(config.endpoint ?? "http://127.0.0.1:20128/v1");
    this.apiKey = config.apiKey;
    this.apiKeyEnv = config.apiKeyEnv ?? "OMNIROUTE_API_KEY";
    this.defaultModel = config.defaultModel ?? "auto/best-free";
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.descriptor = {
      providerId: "omniroute",
      displayName: "OmniRoute",
      accessMode: "API",
      capabilities: ["ai.chat", "ai.code", "ai.reasoning", "ai.research"],
      allowedSecurityClasses: config.allowedSecurityClasses ?? ["S0", "S1", "S2"],
      external: true,
      priority: 0,
      enabled: true,
      transport: "RAW_API",
      authMode: "API_KEY",
      billingMode: "API_PAYG",
      supportsHeadless: true,
      supportsStructuredOutput: true
    };
  }

  private credential(): string | undefined {
    const value = this.apiKey ?? process.env[this.apiKeyEnv];
    return value?.trim() || undefined;
  }

  private headers(): Record<string, string> {
    const key = this.credential();
    return {
      "content-type": "application/json",
      ...(key === undefined ? {} : { authorization: `Bearer ${key}` })
    };
  }

  async health(): Promise<ProviderHealth> {
    if (this.credential() === undefined) return "AUTH_REQUIRED";
    try {
      const response = await this.fetchImpl(`${this.endpoint}/models`, {
        method: "GET",
        headers: this.headers(),
        signal: AbortSignal.timeout(3000)
      });
      if (response.status === 401 || response.status === 403) return "AUTH_REQUIRED";
      if (response.status === 429) return "RATE_LIMITED";
      if (response.status >= 500) return "DEGRADED";
      return response.ok ? "HEALTHY" : "UNAVAILABLE";
    } catch {
      return "UNAVAILABLE";
    }
  }

  async canExecute(request: CapabilityRequest): Promise<boolean> {
    if (!this.descriptor.capabilities.includes(request.capability)) return false;
    const health = await this.health();
    return health === "HEALTHY" || health === "DEGRADED";
  }

  async execute<T>(request: CapabilityRequest): Promise<ProviderResult<T>> {
    const key = this.credential();
    if (key === undefined) throw new Error("OMNIROUTE_AUTH_REQUIRED");

    const input = asInput(request.input);
    const { model: requestedModel, ...rest } = input;
    const payload = {
      ...rest,
      model: typeof requestedModel === "string" && requestedModel.trim() ? requestedModel : this.defaultModel
    };

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.endpoint}/chat/completions`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(request.requirements.maxLatencyMs ?? 120000)
      });
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") throw new Error("OMNIROUTE_TIMEOUT");
      throw new Error("OMNIROUTE_UNAVAILABLE");
    }

    if (response.status === 401 || response.status === 403) throw new Error("OMNIROUTE_AUTH_REQUIRED");
    if (response.status === 429) throw new Error("OMNIROUTE_RATE_LIMITED");
    if (!response.ok) throw new Error(`OMNIROUTE_HTTP_${response.status}`);

    const body = await response.json() as T;
    const providerRequestId = response.headers.get("x-request-id") ?? undefined;
    return {
      output: body,
      ...(providerRequestId === undefined ? {} : { providerRequestId })
    };
  }
}

export function defaultAiProviderOrder(): string[] {
  return ["omniroute", "openai-codex-sub", "claude-code-sub", "gemini-cli-sub", "github-copilot-sub"];
}
