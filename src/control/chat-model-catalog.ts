export type ChatModelCatalog = {
  models: string[];
  source: "OMNIROUTE";
  checkedAt: string;
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

  async list(): Promise<ChatModelCatalog> {
    const key = this.credential();
    if (!key) throw new ChatModelCatalogError("CHAT_MODEL_CATALOG_AUTH_REQUIRED", 503);

    const urls = catalogUrls(this.endpoint);
    let response = await this.readCatalog(urls[0]!, key);
    if ((response.status === 404 || response.status === 405) && urls[1]) {
      response = await this.readCatalog(urls[1], key);
    }

    if (response.status === 401 || response.status === 403) throw new ChatModelCatalogError("CHAT_MODEL_CATALOG_AUTH_REQUIRED", 503);
    if (response.status === 429) throw new ChatModelCatalogError("CHAT_MODEL_CATALOG_RATE_LIMITED", 429);
    if (!response.ok) throw new ChatModelCatalogError(`CHAT_MODEL_CATALOG_UPSTREAM_${response.status}`, 502);

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new ChatModelCatalogError("CHAT_MODEL_CATALOG_INVALID", 502);
    }
    const models = uniqueModels(payload);
    if (models.length === 0) throw new ChatModelCatalogError("CHAT_MODEL_CATALOG_EMPTY", 502);
    return { models, source: "OMNIROUTE", checkedAt: this.now() };
  }
}
