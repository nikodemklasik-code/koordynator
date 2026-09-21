import {
  ChatModelCatalogError,
  ChatModelCatalogService,
  type ChatModelBillingSource,
  type ChatModelCatalog,
  type ChatModelCatalogOptions,
  type ChatModelCatalogPort,
  type ChatModelRoute
} from "./chat-model-catalog.js";

export type LiveChatModelCatalog = ChatModelCatalog & {
  inventory: {
    totalModels: number;
    verifiedFreeModels: number;
    freeCandidates: number;
    executableModels: number;
  };
};

const MODEL_RE = /^[A-Za-z0-9._:/-]{1,160}$/;
const VERIFIED_FREE = new Set<ChatModelBillingSource>(["FREE_CONFIRMED", "FREE_OAUTH"]);
const FREE_CANDIDATE = new Set<ChatModelBillingSource>(["FREE_CONFIRMED", "FREE_OAUTH", "FREE_REQUESTED"]);

function normalizeEndpoint(value: string): string {
  const endpoint = value.trim().replace(/\/+$/, "");
  return endpoint || "http://127.0.0.1:20128/v1";
}

function isLoopbackEndpoint(endpoint: string): boolean {
  try {
    const host = new URL(endpoint).hostname.toLowerCase();
    return host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]";
  } catch {
    return false;
  }
}

function modelId(value: unknown): string | null {
  if (typeof value === "string") {
    const id = value.trim();
    return MODEL_RE.test(id) && !id.toLowerCase().includes("deepseek") ? id : null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  for (const key of ["id", "modelId", "model"]) {
    const id = modelId(record[key]);
    if (id) return id;
  }
  return null;
}

function directModelIds(payload: unknown): string[] {
  if (Array.isArray(payload)) {
    return [...new Set(payload.map(modelId).filter((id): id is string => Boolean(id)))];
  }
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  for (const key of ["data", "models", "items"]) {
    const items = record[key];
    if (!Array.isArray(items)) continue;
    return [...new Set(items.map(modelId).filter((id): id is string => Boolean(id)))];
  }
  return [];
}

function pick<T>(record: Record<string, T> | undefined, ids: Set<string>): Record<string, T> | undefined {
  if (!record) return undefined;
  return Object.fromEntries(Object.entries(record).filter(([id]) => ids.has(id)));
}

export class LiveChatModelCatalogService implements ChatModelCatalogPort {
  private readonly inner: ChatModelCatalogService;
  private readonly endpoint: string;
  private readonly apiKey: string | undefined;
  private readonly apiKeyEnv: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: ChatModelCatalogOptions = {}) {
    this.inner = new ChatModelCatalogService(options);
    this.endpoint = normalizeEndpoint(options.endpoint ?? "http://127.0.0.1:20128/v1");
    this.apiKey = options.apiKey;
    this.apiKeyEnv = options.apiKeyEnv ?? "OMNIROUTE_API_KEY";
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 5000;
  }

  private credential(): string | undefined {
    const value = this.apiKey ?? process.env[this.apiKeyEnv];
    return value?.trim() || undefined;
  }

  private async executableIds(): Promise<string[]> {
    const key = this.credential();
    if (!key && !isLoopbackEndpoint(this.endpoint)) throw new ChatModelCatalogError("CHAT_MODEL_CATALOG_AUTH_REQUIRED", 503);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.endpoint}/models`, {
        method: "GET",
        headers: {
          accept: "application/json",
          ...(key ? { authorization: `Bearer ${key}`, "x-api-key": key } : {})
        },
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch {
      throw new ChatModelCatalogError("CHAT_MODEL_CATALOG_UNAVAILABLE", 503);
    }
    if (response.status === 401 || response.status === 403) throw new ChatModelCatalogError("CHAT_MODEL_CATALOG_AUTH_REQUIRED", 503);
    if (!response.ok) throw new ChatModelCatalogError(`CHAT_MODEL_CATALOG_UPSTREAM_${response.status}`, 502);
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new ChatModelCatalogError("CHAT_MODEL_CATALOG_INVALID", 502);
    }
    const ids = directModelIds(payload);
    if (!ids.length) throw new ChatModelCatalogError("CHAT_MODEL_CATALOG_EMPTY", 502);
    return ids;
  }

  async list(): Promise<LiveChatModelCatalog> {
    const [catalog, executableIds] = await Promise.all([
      this.inner.list(),
      this.executableIds()
    ]);

    const executable = new Set(executableIds);
    const models = catalog.models.filter((id) => executable.has(id));
    if (!models.length) throw new ChatModelCatalogError("CHAT_MODEL_CATALOG_NO_CHAT_MODELS", 502);
    const modelSet = new Set(models);
    const modelSources = pick(catalog.billing?.modelSources, modelSet) ?? {};
    const modelRoutes = pick<ChatModelRoute>(catalog.billing?.modelRoutes, modelSet);
    const entries = catalog.entries?.filter((entry) => modelSet.has(entry.id));

    const allSources = catalog.billing?.modelSources ?? {};
    const freeCandidates = Object.values(allSources).filter((source) => FREE_CANDIDATE.has(source)).length;
    const verifiedFreeModels = models.filter((id) => VERIFIED_FREE.has(modelSources[id] ?? "UNKNOWN")).length;

    return {
      ...catalog,
      models,
      ...(entries === undefined ? {} : { entries }),
      ...(catalog.billing === undefined ? {} : {
        billing: {
          ...catalog.billing,
          modelSources,
          ...(modelRoutes === undefined ? {} : { modelRoutes })
        }
      }),
      inventory: {
        totalModels: catalog.models.length,
        verifiedFreeModels,
        freeCandidates,
        executableModels: models.length
      }
    };
  }
}
