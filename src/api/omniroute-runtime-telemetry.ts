export type OmniRouteTelemetrySource =
  | "models"
  | "tokenHealth"
  | "rateLimits"
  | "budget"
  | "latency"
  | "pricing";

export type OmniRouteTelemetrySourceState = {
  available: boolean;
  status?: number;
};

export type OmniRouteModelRuntimeTelemetry = {
  modelId: string;
  latencyMs?: number;
  estimatedCost?: number;
  rateLimited?: boolean;
  tokenHealthy?: boolean;
};

export type OmniRouteBudgetTelemetry = {
  exhausted: boolean;
  remaining?: number;
  limit?: number;
  used?: number;
};

export type OmniRouteRuntimeSnapshot = {
  takenAt: string;
  models: OmniRouteModelRuntimeTelemetry[];
  budget: OmniRouteBudgetTelemetry;
  sources: Record<OmniRouteTelemetrySource, OmniRouteTelemetrySourceState>;
};

export type OmniRouteRuntimeTelemetryConfig = {
  endpoint?: string;
  apiKey?: string;
  apiKeyEnv?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => string;
};

type JsonProbe = {
  state: OmniRouteTelemetrySourceState;
  payload?: unknown;
};

type MutableModel = {
  modelId: string;
  latencyMs?: number;
  estimatedCost?: number;
  rateLimited?: boolean;
  tokenHealthy?: boolean;
};

function normalizeRoot(value: string): string {
  let endpoint = value.trim().replace(/\/+$/, "");
  if (endpoint.endsWith("/api/v1")) endpoint = endpoint.slice(0, -7);
  else if (endpoint.endsWith("/v1")) endpoint = endpoint.slice(0, -3);
  return endpoint.replace(/\/+$/, "");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function firstNumber(record: Record<string, unknown>, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const value = numberValue(record[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function firstBoolean(record: Record<string, unknown>, keys: readonly string[]): boolean | undefined {
  for (const key of keys) {
    if (typeof record[key] === "boolean") return record[key] as boolean;
  }
  return undefined;
}

function firstString(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
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

function catalogModelIds(payload: unknown): string[] {
  const ids = new Set<string>();
  const add = (value: unknown): void => {
    if (!Array.isArray(value)) return;
    for (const item of value) {
      if (!isObject(item)) continue;
      const id = firstString(item, ["id", "modelId", "model"]);
      if (id !== undefined) ids.add(id);
    }
  };

  if (Array.isArray(payload)) add(payload);
  if (isObject(payload)) {
    add(payload.data);
    add(payload.models);
    add(payload.items);
  }
  return [...ids].sort((a, b) => a.localeCompare(b));
}

function modelMetricIndex(
  payload: unknown,
  modelIds: ReadonlySet<string>,
  metric: "latency" | "cost" | "rate" | "token"
): Map<string, number | boolean> {
  const index = new Map<string, number | boolean>();
  walk(payload, (record) => {
    const modelId = firstString(record, ["modelId", "model", "id"]);
    if (modelId === undefined || !modelIds.has(modelId)) return;

    if (metric === "latency") {
      const value = firstNumber(record, ["latencyMs", "avgLatencyMs", "averageLatencyMs", "p50Ms", "p50", "meanMs"]);
      if (value !== undefined) index.set(modelId, value);
      return;
    }

    if (metric === "cost") {
      const direct = firstNumber(record, ["estimatedCost", "cost", "price", "costScore"]);
      const input = firstNumber(record, ["inputCost", "inputPrice", "promptPrice"]);
      const output = firstNumber(record, ["outputCost", "outputPrice", "completionPrice"]);
      const value = direct ?? (input !== undefined || output !== undefined ? (input ?? 0) + (output ?? 0) : undefined);
      if (value !== undefined) index.set(modelId, value);
      return;
    }

    if (metric === "rate") {
      const limited = firstBoolean(record, ["rateLimited", "limited", "exhausted"]);
      const remaining = firstNumber(record, ["remaining", "remainingRequests", "requestsRemaining"]);
      if (limited !== undefined) index.set(modelId, limited);
      else if (remaining !== undefined) index.set(modelId, remaining <= 0);
      return;
    }

    const healthy = firstBoolean(record, ["healthy", "valid", "available"]);
    const status = firstString(record, ["status", "state"]);
    if (healthy !== undefined) index.set(modelId, healthy);
    else if (status !== undefined) {
      const normalized = status.toLowerCase();
      if (["healthy", "ready", "active", "ok", "valid"].includes(normalized)) index.set(modelId, true);
      if (["invalid", "expired", "missing", "blocked", "unavailable"].includes(normalized)) index.set(modelId, false);
    }
  });
  return index;
}

function budgetTelemetry(payload: unknown): OmniRouteBudgetTelemetry {
  let remaining: number | undefined;
  let limit: number | undefined;
  let used: number | undefined;
  walk(payload, (record) => {
    remaining ??= firstNumber(record, ["remaining", "remainingBudget", "budgetRemaining"]);
    limit ??= firstNumber(record, ["limit", "budget", "budgetLimit"]);
    used ??= firstNumber(record, ["used", "spent", "usage"]);
  });
  const exhausted = (remaining !== undefined && remaining <= 0)
    || (limit !== undefined && used !== undefined && used >= limit);
  return {
    exhausted,
    ...(remaining === undefined ? {} : { remaining }),
    ...(limit === undefined ? {} : { limit }),
    ...(used === undefined ? {} : { used })
  };
}

export class OmniRouteRuntimeTelemetry {
  private readonly root: string;
  private readonly apiKey: string | undefined;
  private readonly apiKeyEnv: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => string;

  constructor(config: OmniRouteRuntimeTelemetryConfig = {}) {
    this.root = normalizeRoot(config.endpoint ?? "http://127.0.0.1:20128");
    this.apiKey = config.apiKey;
    this.apiKeyEnv = config.apiKeyEnv ?? "OMNIROUTE_API_KEY";
    this.timeoutMs = config.timeoutMs ?? 3000;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.now = config.now ?? (() => new Date().toISOString());
  }

  private credential(): string | undefined {
    const value = this.apiKey ?? process.env[this.apiKeyEnv];
    return value?.trim() || undefined;
  }

  private headers(): Record<string, string> {
    const key = this.credential();
    return key === undefined ? {} : { authorization: `Bearer ${key}` };
  }

  private async read(path: string): Promise<JsonProbe> {
    try {
      const response = await this.fetchImpl(`${this.root}${path}`, {
        method: "GET",
        headers: this.headers(),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
      if (!response.ok) return { state: { available: false, status: response.status } };
      try {
        return { state: { available: true, status: response.status }, payload: await response.json() };
      } catch {
        return { state: { available: false, status: response.status } };
      }
    } catch {
      return { state: { available: false } };
    }
  }

  private async readModels(): Promise<JsonProbe> {
    const primary = await this.read("/api/v1/models");
    if (primary.state.available || (primary.state.status !== 404 && primary.state.status !== 405)) return primary;
    return this.read("/v1/models");
  }

  async snapshot(): Promise<OmniRouteRuntimeSnapshot> {
    if (this.credential() === undefined) throw new Error("OMNIROUTE_TELEMETRY_AUTH_REQUIRED");

    const [models, tokenHealth, rateLimits, budget, latency, pricing] = await Promise.all([
      this.readModels(),
      this.read("/api/token-health"),
      this.read("/api/rate-limits"),
      this.read("/api/usage/budget"),
      this.read("/api/usage/model-latency-stats"),
      this.read("/api/pricing/models")
    ]);

    if (!models.state.available) throw new Error(`OMNIROUTE_MODEL_CATALOG_UNAVAILABLE${models.state.status === undefined ? "" : `:${models.state.status}`}`);
    const modelIds = catalogModelIds(models.payload);
    if (modelIds.length === 0) throw new Error("OMNIROUTE_MODEL_CATALOG_EMPTY");

    const modelSet = new Set(modelIds);
    const latencyIndex = modelMetricIndex(latency.payload, modelSet, "latency");
    const costIndex = modelMetricIndex(pricing.payload, modelSet, "cost");
    const rateIndex = modelMetricIndex(rateLimits.payload, modelSet, "rate");
    const tokenIndex = modelMetricIndex(tokenHealth.payload, modelSet, "token");

    const runtimeModels: MutableModel[] = modelIds.map((modelId) => {
      const latencyMs = latencyIndex.get(modelId);
      const estimatedCost = costIndex.get(modelId);
      const rateLimited = rateIndex.get(modelId);
      const tokenHealthy = tokenIndex.get(modelId);
      return {
        modelId,
        ...(typeof latencyMs === "number" ? { latencyMs } : {}),
        ...(typeof estimatedCost === "number" ? { estimatedCost } : {}),
        ...(typeof rateLimited === "boolean" ? { rateLimited } : {}),
        ...(typeof tokenHealthy === "boolean" ? { tokenHealthy } : {})
      };
    });

    return {
      takenAt: this.now(),
      models: runtimeModels,
      budget: budgetTelemetry(budget.payload),
      sources: {
        models: models.state,
        tokenHealth: tokenHealth.state,
        rateLimits: rateLimits.state,
        budget: budget.state,
        latency: latency.state,
        pricing: pricing.state
      }
    };
  }
}
