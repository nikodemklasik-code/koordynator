export type ChatModelBillingSource = "FREE_REQUESTED" | "FREE_CONFIRMED" | "PAID_API" | "UNKNOWN";

export type ChatModelCatalog = {
  models: string[];
  source: "OMNIROUTE";
  checkedAt: string;
  billing?: {
    liveChatTransport: "OMNIROUTE_API";
    subscriptionHarnessUsed: false;
    subscriptionHarnessPath: "NOT_WIRED_TO_LIVE_CHAT";
    modelSources: Record<string, ChatModelBillingSource>;
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
  if (normalized.endsWith("/v1") && !normalized.endsWith("/api/v1")) {
    urls.push(`${normalized.slice(0, -3)}/api/v1/models`);
  } else if (normalized.endsWith("/api/v1")) {
    urls.push(`${normalized.slice(0, -7)}/v1/models`);
  }
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

function uniqueModels(payload: unknown): string[] {
  const seen = new Set<string>();
  const models: string[] = [];
  for (const item of catalogItems(payload)) {
    const id = modelId(item);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    models.push(id);
  }
  return models;
}

function walk(value: unknown, visit: (record: Record<string, unknown>) => void, depth = 0): void {
  if (depth > 7) return;
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit, depth + 1);
    return;
  }
  if (!isObject(value)) return;
  visit(value);
  for (const nested of Object.values(value)) walk(nested, visit, depth + 1);
}

function numberValue(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  }
  return undefined;
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

function explicitBillingSignal(record: Record<string, unknown>): ChatModelBillingSource | undefined {
  for (const key of ["billing", "billingTier", "tier", "priceTier", "costTier"]) {
    const value = record[key];
    if (typeof value !== "string") continue;
    const normalized = value.trim().toLowerCase();
    if (["free", "no-cost", "no_cost", "zero-cost", "zero_cost"].includes(normalized)) return "FREE_CONFIRMED";
    if (["paid", "payg", "api_payg", "metered"].includes(normalized)) return "PAID_API";
  }
  for (const key of ["free", "isFree", "is_free"]) {
    if (record[key] === true) return "FREE_CONFIRMED";
    if (record[key] === false) return "PAID_API";
  }

  const direct = numberValue(record, ["estimatedCost", "cost", "price", "costScore"]);
  if (direct !== undefined) return direct === 0 ? "FREE_CONFIRMED" : "PAID_API";
  const input = numberValue(record, ["inputCost", "inputPrice", "promptPrice", "input_cost", "input_price"]);
  const output = numberValue(record, ["outputCost", "outputPrice", "completionPrice", "output_cost", "output_price"]);
  if (input !== undefined && output !== undefined) return input + output === 0 ? "FREE_CONFIRMED" : "PAID_API";
  if ((input ?? 0) > 0 || (output ?? 0) > 0) return "PAID_API";
  return undefined;
}

function applyBillingEvidence(
  sources: Record<string, ChatModelBillingSource>,
  models: Set<string>,
  payload: unknown
): void {
  if (payload === undefined) return;
  walk(payload, (record) => {
    const id = modelId(record);
    if (id && models.has(id)) {
      const signal = explicitBillingSignal(record);
      if (signal) sources[id] = signal;
    }
    for (const [key, nested] of Object.entries(record)) {
      if (!models.has(key) || !isObject(nested)) continue;
      const signal = explicitBillingSignal(nested);
      if (signal) sources[key] = signal;
    }
  });
}

function modelBillingSources(models: string[], catalog: unknown, pricing: unknown): Record<string, ChatModelBillingSource> {
  const sources: Record<string, ChatModelBillingSource> = {};
  for (const model of models) {
    sources[model] = /(?:^|[\/:._-])(?:best-)?free(?:$|[\/:._-])/i.test(model) ? "FREE_REQUESTED" : "UNKNOWN";
  }
  const known = new Set(models);
  applyBillingEvidence(sources, known, catalog);
  applyBillingEvidence(sources, known, pricing);
  return sources;
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

  private async readCatalog(url: string, key: string): Promise<Response> {
    try {
      return await this.fetchImpl(url, {
        method: "GET",
        headers: { accept: "application/json", authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch {
      throw new ChatModelCatalogError("CHAT_MODEL_CATALOG_UNAVAILABLE", 503);
    }
  }

  private async optionalJson(url: string, key: string): Promise<unknown | undefined> {
    try {
      const response = await this.fetchImpl(url, {
        method: "GET",
        headers: { accept: "application/json", authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(this.timeoutMs)
      });
      if (!response.ok) return undefined;
      return await response.json();
    } catch {
      return undefined;
    }
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
    const models = uniqueModels(payload);
    if (models.length === 0) throw new ChatModelCatalogError("CHAT_MODEL_CATALOG_EMPTY", 502);

    const root = gatewayRoot(this.endpoint);
    const [pricing, budgetPayload] = await Promise.all([
      this.optionalJson(`${root}/api/pricing/models`, key),
      this.optionalJson(`${root}/api/usage/budget`, key)
    ]);
    const budget = budgetFrom(budgetPayload);
    return {
      models,
      source: "OMNIROUTE",
      checkedAt: this.now(),
      billing: {
        liveChatTransport: "OMNIROUTE_API",
        subscriptionHarnessUsed: false,
        subscriptionHarnessPath: "NOT_WIRED_TO_LIVE_CHAT",
        modelSources: modelBillingSources(models, payload, pricing),
        ...(budget === undefined ? {} : { budget })
      }
    };
  }
}
