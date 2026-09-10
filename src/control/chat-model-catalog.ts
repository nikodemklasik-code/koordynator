export type ChatModelBillingSource =
  | "FREE_REQUESTED"
  | "FREE_CONFIRMED"
  | "FREE_OAUTH"
  | "SUBSCRIPTION_HARNESS"
  | "PAID_API"
  | "UNKNOWN";

export type ChatModelRouteTransport = "OMNIROUTE_API" | "OMNIROUTE_OAUTH";

export type ChatModelRoute = {
  provider: string;
  family: string;
  transport: ChatModelRouteTransport;
  subscriptionHarnessUsed: boolean;
  billingSource: ChatModelBillingSource;
};

export type ChatModelEntry = ChatModelRoute & {
  id: string;
  name: string;
  inputTokenLimit?: number;
  supportsVision?: boolean;
};

export type ChatModelCatalog = {
  models: string[];
  entries?: ChatModelEntry[];
  source: "OMNIROUTE";
  checkedAt: string;
  billing?: {
    liveChatTransport: "OMNIROUTE_API";
    subscriptionHarnessUsed: boolean;
    subscriptionHarnessPath: "OMNIROUTE_OAUTH_MODEL_ROUTES" | "NOT_AVAILABLE" | "NOT_WIRED_TO_LIVE_CHAT";
    modelSources: Record<string, ChatModelBillingSource>;
    modelRoutes?: Record<string, ChatModelRoute>;
    budget?: { exhausted: boolean; remaining?: number; limit?: number; used?: number };
  };
};

export type ChatModelCatalogOptions = {
  endpoint?: string;
  apiKey?: string;
  apiKeyEnv?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: () => string;
};

export interface ChatModelCatalogPort {
  list(): Promise<ChatModelCatalog>;
}

export class ChatModelCatalogError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
  }
}

const MODEL_RE = /^[A-Za-z0-9._:/-]{1,160}$/;
const PROVIDER_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const PROTECTED_ROUTE_SOURCES = new Set<ChatModelBillingSource>(["SUBSCRIPTION_HARNESS", "FREE_OAUTH"]);

const ROUTE_PREFIXES: Record<string, { provider: string; family: string; source: ChatModelBillingSource }> = {
  cc: { provider: "claude-code", family: "ANTHROPIC", source: "SUBSCRIPTION_HARNESS" },
  "claude-code": { provider: "claude-code", family: "ANTHROPIC", source: "SUBSCRIPTION_HARNESS" },
  cx: { provider: "codex", family: "OPENAI", source: "SUBSCRIPTION_HARNESS" },
  codex: { provider: "codex", family: "OPENAI", source: "SUBSCRIPTION_HARNESS" },
  gh: { provider: "github-copilot", family: "GITHUB COPILOT", source: "SUBSCRIPTION_HARNESS" },
  github: { provider: "github-copilot", family: "GITHUB COPILOT", source: "SUBSCRIPTION_HARNESS" },
  "github-copilot": { provider: "github-copilot", family: "GITHUB COPILOT", source: "SUBSCRIPTION_HARNESS" },
  gc: { provider: "grok-cli", family: "XAI / GROK", source: "SUBSCRIPTION_HARNESS" },
  "grok-cli": { provider: "grok-cli", family: "XAI / GROK", source: "SUBSCRIPTION_HARNESS" },
  xao: { provider: "xai-oauth", family: "XAI / GROK", source: "SUBSCRIPTION_HARNESS" },
  "xai-oauth": { provider: "xai-oauth", family: "XAI / GROK", source: "SUBSCRIPTION_HARNESS" },
  "gemini-cli": { provider: "gemini-cli", family: "GOOGLE / GEMINI", source: "FREE_OAUTH" },
  kr: { provider: "kiro", family: "KIRO", source: "FREE_OAUTH" },
  kiro: { provider: "kiro", family: "KIRO", source: "FREE_OAUTH" },
  if: { provider: "qoder", family: "QODER", source: "FREE_OAUTH" },
  qoder: { provider: "qoder", family: "QODER", source: "FREE_OAUTH" },
  qw: { provider: "qwen-oauth", family: "QWEN", source: "FREE_OAUTH" },
  "qwen-oauth": { provider: "qwen-oauth", family: "QWEN", source: "FREE_OAUTH" }
};

const KNOWN_PROVIDER_ALIASES: Record<string, string[]> = {
  openai: ["openai", "codex"],
  anthropic: ["anthropic", "claude", "claude-code"],
  google: ["google", "gemini", "gemini-cli"],
  xai: ["xai", "xai-oauth", "grok", "grok-cli"],
  cohere: ["cohere"],
  groq: ["groq"],
  github: ["github-copilot", "github"],
  openrouter: ["openrouter"],
  qwen: ["qwen", "qwen-oauth"],
  moonshot: ["moonshot", "kimi"],
  minimax: ["minimax"],
  glm: ["glm", "zhipu"],
  kiro: ["kiro"],
  qoder: ["qoder"]
};

function normalizeEndpoint(value: string): string {
  const endpoint = value.trim().replace(/\/+$/, "");
  return endpoint || "http://127.0.0.1:20128/v1";
}

function gatewayRoot(endpoint: string): string {
  if (endpoint.endsWith("/api/v1")) return endpoint.slice(0, -7).replace(/\/+$/, "");
  if (endpoint.endsWith("/v1")) return endpoint.slice(0, -3).replace(/\/+$/, "");
  return endpoint.replace(/\/+$/, "");
}

function catalogUrls(endpoint: string): string[] {
  const normalized = normalizeEndpoint(endpoint);
  const urls = [`${normalized}/models`];
  if (normalized.endsWith("/v1") && !normalized.endsWith("/api/v1")) urls.push(`${normalized.slice(0, -3)}/api/v1/models`);
  else if (normalized.endsWith("/api/v1")) urls.push(`${normalized.slice(0, -7)}/v1/models`);
  return [...new Set(urls)];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function modelId(value: unknown): string | null {
  if (typeof value === "string") {
    const id = value.trim();
    return MODEL_RE.test(id) && !id.toLowerCase().includes("deepseek") ? id : null;
  }
  if (!isObject(value)) return null;
  for (const key of ["id", "modelId", "model"]) {
    const id = modelId(value[key]);
    if (id) return id;
  }
  return null;
}

function catalogItems(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!isObject(payload)) return [];
  for (const key of ["data", "models", "items"]) {
    if (Array.isArray(payload[key])) return payload[key] as unknown[];
  }
  return [];
}

function walk(value: unknown, visit: (record: Record<string, unknown>) => void, depth = 0): void {
  if (depth > 8) return;
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit, depth + 1);
    return;
  }
  if (!isObject(value)) return;
  visit(value);
  for (const nested of Object.values(value)) walk(nested, visit, depth + 1);
}

function modelRecordMap(payload: unknown): Map<string, Record<string, unknown>> {
  const records = new Map<string, Record<string, unknown>>();
  walk(payload, (record) => {
    const id = modelId(record);
    if (id && !records.has(id)) records.set(id, record);
  });
  for (const item of catalogItems(payload)) {
    const id = modelId(item);
    if (id && !records.has(id)) records.set(id, isObject(item) ? item : { id });
  }
  return records;
}

function uniqueModels(payload: unknown): string[] {
  return [...modelRecordMap(payload).keys()];
}

function numberValue(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  }
  return undefined;
}

function stringValue(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function boolValue(record: Record<string, unknown>, keys: string[]): boolean | undefined {
  for (const key of keys) {
    if (record[key] === true) return true;
    if (record[key] === false) return false;
  }
  return undefined;
}

function providerIds(payload: unknown): string[] {
  const ids = new Set<string>();
  const collect = (value: unknown) => {
    if (typeof value !== "string") return;
    const id = value.trim().toLowerCase();
    if (PROVIDER_RE.test(id)) ids.add(id);
  };
  walk(payload, (record) => {
    for (const key of ["providerId", "provider", "slug", "key"]) collect(record[key]);
    const id = record.id;
    if (typeof id === "string" && /provider|oauth|codex|claude|gemini|grok|xai|openai|anthropic|cohere|groq|copilot|qwen|kiro|qoder|kimi|moonshot|minimax|glm/i.test(id)) collect(id);
  });
  if (isObject(payload)) {
    for (const key of Object.keys(payload)) if (PROVIDER_RE.test(key)) ids.add(key.toLowerCase());
  }
  return [...ids].slice(0, 50);
}

function expandKnownProviderAliases(ids: string[]): string[] {
  const expanded = new Set(ids);
  for (const id of ids) {
    for (const [family, aliases] of Object.entries(KNOWN_PROVIDER_ALIASES)) {
      if (id === family || aliases.includes(id)) for (const alias of aliases) expanded.add(alias);
    }
  }
  return [...expanded].filter((id) => PROVIDER_RE.test(id)).slice(0, 60);
}

function budgetFrom(payload: unknown): { exhausted: boolean; remaining?: number; limit?: number; used?: number } | undefined {
  if (payload === undefined) return undefined;
  let remaining: number | undefined;
  let limit: number | undefined;
  let used: number | undefined;
  walk(payload, (record) => {
    remaining ??= numberValue(record, ["remaining", "remainingBudget", "budgetRemaining"]);
    limit ??= numberValue(record, ["limit", "budget", "budgetLimit"]);
    used ??= numberValue(record, ["used", "spent", "usage"]);
  });
  if (remaining === undefined && limit === undefined && used === undefined) return undefined;
  return {
    exhausted: (remaining !== undefined && remaining <= 0) || (limit !== undefined && used !== undefined && used >= limit),
    ...(remaining === undefined ? {} : { remaining }),
    ...(limit === undefined ? {} : { limit }),
    ...(used === undefined ? {} : { used })
  };
}

function routePrefix(model: string): string | undefined {
  const slash = model.indexOf("/");
  if (slash <= 0) return undefined;
  return model.slice(0, slash).toLowerCase();
}

function inferFamily(model: string, provider?: string): string {
  const value = `${provider ?? ""}/${model}`.toLowerCase();
  if (/\b(?:openai|codex)\b/.test(value) || /(?:^|\/)gpt[-._]/.test(value)) return "OPENAI";
  if (/\b(?:anthropic|claude)\b/.test(value)) return "ANTHROPIC";
  if (/\b(?:google|gemini)\b/.test(value)) return "GOOGLE / GEMINI";
  if (/\b(?:xai|grok)\b/.test(value)) return "XAI / GROK";
  if (/\b(?:cohere|command|c4ai)\b/.test(value)) return "COHERE";
  if (/\bgroq\b/.test(value)) return "GROQ";
  if (/\bqwen\b/.test(value)) return "QWEN";
  if (/\b(?:kimi|moonshot)\b/.test(value)) return "MOONSHOT / KIMI";
  if (/\bminimax\b/.test(value)) return "MINIMAX";
  if (/\bglm\b/.test(value)) return "GLM";
  if (/\b(?:meta|llama)\b/.test(value)) return "META / LLAMA";
  return (provider ?? routePrefix(model) ?? "OMNIROUTE").replace(/[-_]/g, " ").toUpperCase();
}

function routeFor(model: string, record?: Record<string, unknown>): Omit<ChatModelRoute, "billingSource"> & { routeSource?: ChatModelBillingSource } {
  const prefix = routePrefix(model);
  const known = prefix ? ROUTE_PREFIXES[prefix] : undefined;
  const metadataProvider = record ? stringValue(record, ["provider", "providerId", "owned_by", "ownedBy", "owner"]) : undefined;
  const provider = known?.provider ?? metadataProvider ?? prefix ?? inferFamily(model).toLowerCase().replace(/\s+\/\s+|\s+/g, "-");
  return {
    provider,
    family: known?.family ?? inferFamily(model, provider),
    transport: known ? "OMNIROUTE_OAUTH" : "OMNIROUTE_API",
    subscriptionHarnessUsed: known?.source === "SUBSCRIPTION_HARNESS",
    ...(known === undefined ? {} : { routeSource: known.source })
  };
}

function explicitBillingSignal(record: Record<string, unknown>): ChatModelBillingSource | undefined {
  for (const key of ["billing", "billingTier", "tier", "priceTier", "costTier", "billingMode", "accessMode", "authMode", "category"]) {
    const value = record[key];
    if (typeof value !== "string") continue;
    const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
    if (["free_oauth", "oauth_free", "free_tier_oauth"].includes(normalized)) return "FREE_OAUTH";
    if (["subscription", "subscription_included", "subscription_credits", "plan_included", "oauth_subscription"].includes(normalized)) return "SUBSCRIPTION_HARNESS";
    if (["free", "no_cost", "zero_cost"].includes(normalized)) return "FREE_CONFIRMED";
    if (["paid", "payg", "api_payg", "metered"].includes(normalized)) return "PAID_API";
  }
  for (const key of ["free", "isFree", "is_free"]) {
    if (record[key] === true) return "FREE_CONFIRMED";
    if (record[key] === false) return "PAID_API";
  }
  const direct = numberValue(record, ["estimatedCost", "cost", "price"]);
  if (direct !== undefined) return direct === 0 ? "FREE_CONFIRMED" : "PAID_API";
  const input = numberValue(record, ["inputCost", "inputPrice", "promptPrice", "input_cost", "input_price"]);
  const output = numberValue(record, ["outputCost", "outputPrice", "completionPrice", "output_cost", "output_price"]);
  if (input !== undefined && output !== undefined) return input + output === 0 ? "FREE_CONFIRMED" : "PAID_API";
  if ((input ?? 0) > 0 || (output ?? 0) > 0) return "PAID_API";
  return undefined;
}

function applyBillingEvidence(sources: Record<string, ChatModelBillingSource>, models: Set<string>, payload: unknown): void {
  if (payload === undefined) return;
  walk(payload, (record) => {
    const id = modelId(record);
    if (id && models.has(id) && !PROTECTED_ROUTE_SOURCES.has(sources[id] ?? "UNKNOWN")) {
      const signal = explicitBillingSignal(record);
      if (signal) sources[id] = signal;
    }
    for (const [key, nested] of Object.entries(record)) {
      if (!models.has(key) || !isObject(nested) || PROTECTED_ROUTE_SOURCES.has(sources[key] ?? "UNKNOWN")) continue;
      const signal = explicitBillingSignal(nested);
      if (signal) sources[key] = signal;
    }
  });
}

function modelBillingSources(models: string[], records: Map<string, Record<string, unknown>>, catalog: unknown, pricing: unknown): Record<string, ChatModelBillingSource> {
  const sources: Record<string, ChatModelBillingSource> = {};
  for (const model of models) {
    const routeSource = routeFor(model, records.get(model)).routeSource;
    sources[model] = routeSource ?? (/(?:^|[\/:._-])(?:best-)?free(?:$|[\/:._-])/i.test(model) ? "FREE_REQUESTED" : "UNKNOWN");
  }
  const known = new Set(models);
  applyBillingEvidence(sources, known, catalog);
  applyBillingEvidence(sources, known, pricing);
  return sources;
}

function explicitlyUnavailable(payload: unknown): Set<string> {
  const unavailable = new Set<string>();
  if (payload === undefined) return unavailable;
  walk(payload, (record) => {
    const id = modelId(record);
    if (!id) return;
    const active = boolValue(record, ["available", "enabled", "active", "healthy", "routable"]);
    const status = stringValue(record, ["status", "health", "availability"]);
    if (active === false || (status && /^(?:unavailable|disabled|blocked|auth_required|rate_limited|offline|error)$/i.test(status))) unavailable.add(id);
  });
  return unavailable;
}

function typedNonChatModels(payload: unknown): Set<string> {
  const nonChat = new Set<string>();
  if (payload === undefined) return nonChat;
  walk(payload, (record) => {
    const id = modelId(record);
    if (!id) return;
    const type = stringValue(record, ["type", "modelType", "kind", "capability"]);
    if (type && /^(?:embedding|image|video|audio|speech|transcription|rerank|moderation)$/i.test(type)) nonChat.add(id);
  });
  return nonChat;
}

function obviousNonChat(model: string): boolean {
  const id = model.toLowerCase();
  return /(?:^|[\/:._-])(?:embed(?:ding)?|rerank|moderation|transcrib|whisper|speech|tts)(?:$|[\/:._-])/.test(id)
    || /(?:^|[\/:._-])(?:imagine|image)(?:[-_/](?:generation|edit|quality|video)|$)/.test(id)
    || /(?:^|[\/:._-])(?:video|music)(?:[-_/](?:generation|1|2)|$)/.test(id)
    || /(?:^|[\/:._-])(?:prompt-guard|safeguard)(?:$|[\/:._-])/.test(id)
    || /(?:^|[\/:._-])orpheus(?:$|[\/:._-])/.test(id);
}

function endpointModelSet(payload: unknown): Set<string> { return new Set(uniqueModels(payload)); }

function mergeRecords(target: Map<string, Record<string, unknown>>, payload: unknown, provider?: string): void {
  for (const [id, record] of modelRecordMap(payload)) {
    const existing = target.get(id) ?? {};
    target.set(id, { ...existing, ...record, ...(provider && record.provider === undefined && record.providerId === undefined ? { provider } : {}) });
  }
}

function buildEntries(models: string[], records: Map<string, Record<string, unknown>>, sources: Record<string, ChatModelBillingSource>): ChatModelEntry[] {
  return models.map((id) => {
    const record = records.get(id) ?? { id };
    const route = routeFor(id, record);
    const billingSource = sources[id] ?? "UNKNOWN";
    const inputTokenLimit = numberValue(record, ["inputTokenLimit", "contextWindow", "context_window", "maxInputTokens", "max_input_tokens"]);
    const supportsVision = boolValue(record, ["supportsVision", "supports_vision", "vision"]);
    return {
      id,
      name: stringValue(record, ["name", "displayName", "display_name"]) ?? id,
      provider: route.provider,
      family: route.family,
      transport: route.transport,
      subscriptionHarnessUsed: billingSource === "SUBSCRIPTION_HARNESS",
      billingSource,
      ...(inputTokenLimit === undefined ? {} : { inputTokenLimit }),
      ...(supportsVision === undefined ? {} : { supportsVision })
    };
  });
}

export class ChatModelCatalogService implements ChatModelCatalogPort {
  private readonly endpoint: string;
  private readonly apiKey: string | undefined;
  private readonly apiKeyEnv: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly now: () => string;

  constructor(options: ChatModelCatalogOptions = {}) {
    this.endpoint = normalizeEndpoint(options.endpoint ?? "http://127.0.0.1:20128/v1");
    this.apiKey = options.apiKey;
    this.apiKeyEnv = options.apiKeyEnv ?? "OMNIROUTE_API_KEY";
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  private credential(): string | undefined {
    const value = this.apiKey ?? process.env[this.apiKeyEnv];
    return value?.trim() || undefined;
  }

  private headers(key: string): Record<string, string> {
    return { accept: "application/json", authorization: `Bearer ${key}`, "x-api-key": key };
  }

  private async readCatalog(url: string, key: string): Promise<Response> {
    try {
      return await this.fetchImpl(url, { method: "GET", headers: this.headers(key), signal: AbortSignal.timeout(this.timeoutMs) });
    } catch {
      throw new ChatModelCatalogError("CHAT_MODEL_CATALOG_UNAVAILABLE", 503);
    }
  }

  private async optionalJson(url: string, key: string): Promise<unknown | undefined> {
    try {
      const response = await this.fetchImpl(url, { method: "GET", headers: this.headers(key), signal: AbortSignal.timeout(this.timeoutMs) });
      if (!response.ok) return undefined;
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.toLowerCase().includes("json")) return undefined;
      return await response.json();
    } catch {
      return undefined;
    }
  }

  private async syncedProviderCatalogs(root: string, key: string, providersPayload: unknown, managementCatalog: unknown): Promise<Array<{ provider: string; payload: unknown }>> {
    const discovered = expandKnownProviderAliases([
      ...providerIds(providersPayload),
      ...providerIds(managementCatalog)
    ]);
    if (discovered.length === 0) return [];
    const results = await Promise.all(discovered.map(async (provider) => ({
      provider,
      payload: await this.optionalJson(`${root}/api/synced-available-models?provider=${encodeURIComponent(provider)}`, key)
    })));
    return results.filter((item) => item.payload !== undefined);
  }

  async list(): Promise<ChatModelCatalog> {
    const key = this.credential();
    if (!key) throw new ChatModelCatalogError("CHAT_MODEL_CATALOG_AUTH_REQUIRED", 503);

    const urls = catalogUrls(this.endpoint);
    let response = await this.readCatalog(urls[0]!, key);
    if ((response.status === 404 || response.status === 405) && urls[1]) response = await this.readCatalog(urls[1], key);
    if (response.status === 401 || response.status === 403) throw new ChatModelCatalogError("CHAT_MODEL_CATALOG_AUTH_REQUIRED", 503);
    if (response.status === 429) throw new ChatModelCatalogError("CHAT_MODEL_CATALOG_RATE_LIMITED", 429);
    if (!response.ok) throw new ChatModelCatalogError(`CHAT_MODEL_CATALOG_UPSTREAM_${response.status}`, 502);

    let payload: unknown;
    try { payload = await response.json(); } catch { throw new ChatModelCatalogError("CHAT_MODEL_CATALOG_INVALID", 502); }
    const records = modelRecordMap(payload);
    if (records.size === 0) throw new ChatModelCatalogError("CHAT_MODEL_CATALOG_EMPTY", 502);

    const root = gatewayRoot(this.endpoint);
    const [providersPayload, managementCatalog, availability, pricingModels, pricing, budgetPayload, embeddingPayload, imagePayload] = await Promise.all([
      this.optionalJson(`${root}/api/providers`, key),
      this.optionalJson(`${root}/api/models/catalog`, key),
      this.optionalJson(`${root}/api/models/availability`, key),
      this.optionalJson(`${root}/api/pricing/models`, key),
      this.optionalJson(`${root}/api/pricing`, key),
      this.optionalJson(`${root}/api/usage/budget`, key),
      this.optionalJson(`${this.endpoint}/embeddings`, key),
      this.optionalJson(`${this.endpoint}/images/generations`, key)
    ]);

    mergeRecords(records, managementCatalog);
    const synced = await this.syncedProviderCatalogs(root, key, providersPayload, managementCatalog);
    for (const item of synced) mergeRecords(records, item.payload, item.provider);

    const unavailable = explicitlyUnavailable(availability);
    const typedNonChat = typedNonChatModels(managementCatalog);
    const embeddingModels = endpointModelSet(embeddingPayload);
    const imageModels = endpointModelSet(imagePayload);
    const models = [...records.keys()].filter((id) =>
      !unavailable.has(id)
      && !typedNonChat.has(id)
      && !embeddingModels.has(id)
      && !imageModels.has(id)
      && !obviousNonChat(id)
    );
    if (models.length === 0) throw new ChatModelCatalogError("CHAT_MODEL_CATALOG_NO_CHAT_MODELS", 502);

    const pricingEvidence = pricingModels ?? pricing;
    const combinedCatalogEvidence = [payload, managementCatalog, ...synced.map((item) => item.payload)];
    const sources = modelBillingSources(models, records, combinedCatalogEvidence, pricingEvidence);
    const entries = buildEntries(models, records, sources);
    const modelRoutes = Object.fromEntries(entries.map((entry) => [entry.id, {
      provider: entry.provider,
      family: entry.family,
      transport: entry.transport,
      subscriptionHarnessUsed: entry.subscriptionHarnessUsed,
      billingSource: entry.billingSource
    } satisfies ChatModelRoute]));
    const harnessAvailable = entries.some((entry) => entry.billingSource === "SUBSCRIPTION_HARNESS");
    const budget = budgetFrom(budgetPayload);

    return {
      models,
      entries,
      source: "OMNIROUTE",
      checkedAt: this.now(),
      billing: {
        liveChatTransport: "OMNIROUTE_API",
        subscriptionHarnessUsed: harnessAvailable,
        subscriptionHarnessPath: harnessAvailable ? "OMNIROUTE_OAUTH_MODEL_ROUTES" : "NOT_AVAILABLE",
        modelSources: sources,
        modelRoutes,
        ...(budget === undefined ? {} : { budget })
      }
    };
  }
}
