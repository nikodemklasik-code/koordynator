import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  ChatModelCatalogError,
  type ChatModelBillingSource,
  type ChatModelCatalog,
  type ChatModelCatalogOptions,
  type ChatModelCatalogPort,
  type ChatModelEntry,
  type ChatModelRoute
} from "./chat-model-catalog.js";
import {
  LiveChatModelCatalogService,
  type LiveChatModelCatalog
} from "./live-chat-model-catalog.js";

export type WorkingRouteHealth =
  | "HEALTHY"
  | "RATE_LIMITED"
  | "AUTH_REQUIRED"
  | "DEGRADED"
  | "UNAVAILABLE";

export type WorkingRouteProbe = {
  model: string;
  health: WorkingRouteHealth;
  detail: string;
};

export type WorkingChatModelCatalog = ChatModelCatalog & {
  inventory: {
    totalModels: number;
    verifiedFreeModels: number;
    freeCandidates: number;
    executableModels: number;
    activeModels: number;
  };
  workingSet: {
    activeModels: string[];
    freeModels: string[];
    subscriptionModels: string[];
    limitedModels: string[];
    candidatesTested: number;
    checkedAt: string;
    recoveryMode?: "LIVE" | "LAST_KNOWN_GOOD" | "TRUSTED_CONFIG";
    recoveryReason?: string;
  };
};

export type WorkingChatModelCatalogOptions = ChatModelCatalogOptions & {
  catalog?: ChatModelCatalogPort;
  preferredModels?: string[];
  maxCandidates?: number;
  targetActive?: number;
  probeConcurrency?: number;
  cacheTtlMs?: number;
  snapshotPath?: string;
  snapshotMaxAgeMs?: number;
};

const ACTIVE_SOURCES = new Set<ChatModelBillingSource>([
  "FREE_CONFIRMED",
  "FREE_OAUTH",
  "SUBSCRIPTION_HARNESS"
]);

const FREE_SOURCES = new Set<ChatModelBillingSource>([
  "FREE_CONFIRMED",
  "FREE_OAUTH"
]);

const MODEL_RE = /^[A-Za-z0-9._:/-]{1,200}$/;

const TARGET_PATTERNS: Array<{ pattern: RegExp; score: number }> = [
  { pattern: /(?:^|\/)gpt-6-astra(?:$|[-/])/i, score: 20_000 },
  { pattern: /claude-fable-5[.-]1(?:$|[-/])/i, score: 19_000 },
  { pattern: /claude-fable-5(?:$|[-/])/i, score: 18_500 },
  { pattern: /claude-sonnet-5(?:$|[-/])/i, score: 18_000 },
  { pattern: /claude-opus-4[.-]8-fast(?:$|[-/])/i, score: 17_500 },
  { pattern: /claude-opus-4[.-]8(?:$|[-/])/i, score: 17_000 },
  { pattern: /gpt-5[.-]6-sol(?:$|[-/])/i, score: 16_000 },
  { pattern: /grok-4[.-]6(?:$|[-/])/i, score: 15_000 },
  { pattern: /(?:^|\/)kiro\/auto$/i, score: 14_000 }
];

const PREFIX_SCORE: Record<string, number> = {
  gh: 900,
  github: 890,
  "github-copilot": 880,
  cx: 850,
  codex: 840,
  cc: 820,
  "claude-code": 810,
  cu: 780,
  cursor: 770,
  cl: 740,
  gc: 720,
  "grok-cli": 710,
  xao: 700,
  kiro: 680,
  kr: 670,
  "gemini-cli": 660,
  oc: 640,
  ddgw: 630,
  unc: 620,
  horde: 610
};

function normalizeEndpoint(value: string): string {
  const endpoint = value.trim().replace(/\/+$/, "");
  return endpoint || "http://127.0.0.1:20128/v1";
}

function safeModel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const model = value.trim();
  return MODEL_RE.test(model) && !model.toLowerCase().includes("deepseek") ? model : null;
}

function prefix(model: string): string {
  const slash = model.indexOf("/");
  return (slash > 0 ? model.slice(0, slash) : model).toLowerCase();
}

function routeKey(model: string): string {
  const slash = model.indexOf("/");
  let key = (slash > 0 ? model.slice(slash + 1) : model).toLowerCase();
  key = key
    .replace(/(claude-(?:fable|opus)-\d+)-(\d+)/, "$1.$2")
    .replace(/-(?:thinking-)?(?:none|low|medium|high|xhigh|max|extra-high)(?:-fast)?$/, "");
  return key;
}

function sourceOf(catalog: ChatModelCatalog, model: string): ChatModelBillingSource {
  return catalog.billing?.modelSources?.[model] ?? "UNKNOWN";
}

function targetScore(model: string): number {
  for (const target of TARGET_PATTERNS) {
    if (target.pattern.test(model)) return target.score;
  }
  return 0;
}

function sourceScore(source: ChatModelBillingSource): number {
  if (source === "FREE_CONFIRMED") return 3_000;
  if (source === "FREE_OAUTH") return 2_800;
  if (source === "SUBSCRIPTION_HARNESS") return 2_000;
  return 0;
}

function candidateScore(model: string, source: ChatModelBillingSource, preferred: string[]): number {
  const preferredIndex = preferred.indexOf(model);
  const preferredScore = preferredIndex >= 0 ? 50_000 - preferredIndex * 100 : 0;
  return preferredScore
    + targetScore(model)
    + sourceScore(source)
    + (PREFIX_SCORE[prefix(model)] ?? 0);
}

function chooseAliases(catalog: ChatModelCatalog, preferred: string[]): string[] {
  const sorted = catalog.models
    .map(safeModel)
    .filter((model): model is string => Boolean(model))
    .filter((model) => ACTIVE_SOURCES.has(sourceOf(catalog, model)))
    .sort((a, b) => {
      const score = candidateScore(b, sourceOf(catalog, b), preferred)
        - candidateScore(a, sourceOf(catalog, a), preferred);
      return score || a.localeCompare(b);
    });

  const seen = new Set<string>();
  const out: string[] = [];
  for (const model of sorted) {
    const key = routeKey(model);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(model);
  }
  return out;
}

function pickRecord<T>(record: Record<string, T> | undefined, models: Set<string>): Record<string, T> | undefined {
  if (!record) return undefined;
  return Object.fromEntries(Object.entries(record).filter(([model]) => models.has(model)));
}

function usableChoice(payload: unknown): boolean {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return false;
  const first = choices[0];
  if (!first || typeof first !== "object" || Array.isArray(first)) return false;
  const message = (first as { message?: unknown }).message;
  if (!message || typeof message !== "object" || Array.isArray(message)) return false;
  const record = message as { content?: unknown; reasoning?: unknown; tool_calls?: unknown };
  return (typeof record.content === "string" && record.content.trim().length > 0)
    || (typeof record.reasoning === "string" && record.reasoning.trim().length > 0)
    || (Array.isArray(record.tool_calls) && record.tool_calls.length > 0);
}

function errorDetail(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return fallback;
  const record = payload as Record<string, unknown>;
  const nested = record.error && typeof record.error === "object" && !Array.isArray(record.error)
    ? record.error as Record<string, unknown>
    : undefined;
  for (const value of [nested?.message, record.message, record.detail]) {
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 200);
  }
  return fallback;
}

export class WorkingChatModelCatalogService implements ChatModelCatalogPort {
  private readonly upstream: ChatModelCatalogPort;
  private readonly endpoint: string;
  private readonly apiKey: string | undefined;
  private readonly apiKeyEnv: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly preferredModels: string[];
  private readonly maxCandidates: number;
  private readonly targetActive: number;
  private readonly probeConcurrency: number;
  private readonly cacheTtlMs: number;
  private readonly snapshotPath: string | undefined;
  private readonly snapshotMaxAgeMs: number;
  private cache: { value: WorkingChatModelCatalog; expiresAt: number } | null = null;

  constructor(options: WorkingChatModelCatalogOptions = {}) {
    this.endpoint = normalizeEndpoint(options.endpoint ?? "http://127.0.0.1:20128/v1");
    this.apiKey = options.apiKey;
    this.apiKeyEnv = options.apiKeyEnv ?? "OMNIROUTE_API_KEY";
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = Math.max(1_000, options.timeoutMs ?? 4_000);
    this.preferredModels = [...new Set((options.preferredModels ?? []).map((model) => model.trim()).filter(Boolean))];
    this.maxCandidates = Math.max(4, Math.min(32, options.maxCandidates ?? 16));
    this.targetActive = Math.max(1, Math.min(16, options.targetActive ?? 10));
    this.probeConcurrency = Math.max(1, Math.min(6, options.probeConcurrency ?? 4));
    this.cacheTtlMs = Math.max(5_000, options.cacheTtlMs ?? 20_000);
    this.snapshotPath = options.snapshotPath?.trim() ? resolve(options.snapshotPath) : undefined;
    this.snapshotMaxAgeMs = Math.max(60_000, options.snapshotMaxAgeMs ?? 24 * 60 * 60 * 1000);
    this.upstream = options.catalog ?? new LiveChatModelCatalogService({
      endpoint: this.endpoint,
      ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
      apiKeyEnv: this.apiKeyEnv,
      fetchImpl: this.fetchImpl,
      timeoutMs: this.timeoutMs
    });
  }

  private credential(): string {
    const key = (this.apiKey ?? process.env[this.apiKeyEnv] ?? "").trim();
    if (!key) throw new ChatModelCatalogError("CHAT_MODEL_WORKING_SET_AUTH_REQUIRED", 503);
    return key;
  }

  private async probe(model: string, key: string): Promise<WorkingRouteProbe> {
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
        signal: AbortSignal.timeout(this.timeoutMs)
      });
      let payload: unknown = null;
      try { payload = await response.json(); } catch {}
      if (response.status === 401 || response.status === 403) {
        return { model, health: "AUTH_REQUIRED", detail: `HTTP ${response.status}` };
      }
      if (response.status === 429) {
        return { model, health: "RATE_LIMITED", detail: errorDetail(payload, "Upstream quota/rate limit") };
      }
      if (!response.ok) {
        return { model, health: "DEGRADED", detail: errorDetail(payload, `HTTP ${response.status}`) };
      }
      return usableChoice(payload)
        ? { model, health: "HEALTHY", detail: "Live inference probe passed" }
        : { model, health: "DEGRADED", detail: "HTTP 200 without a usable completion" };
    } catch (error) {
      return {
        model,
        health: "UNAVAILABLE",
        detail: error instanceof Error ? error.message : "Probe failed"
      };
    }
  }

  private async probeCandidates(candidates: string[], key: string): Promise<WorkingRouteProbe[]> {
    const probes: WorkingRouteProbe[] = new Array(candidates.length);
    let next = 0;
    let healthy = 0;

    const worker = async () => {
      while (true) {
        if (healthy >= this.targetActive) return;
        const index = next;
        next += 1;
        if (index >= candidates.length) return;
        const result = await this.probe(candidates[index]!, key);
        probes[index] = result;
        if (result.health === "HEALTHY") healthy += 1;
      }
    };

    await Promise.all(Array.from({ length: Math.min(this.probeConcurrency, candidates.length) }, () => worker()));
    return probes.filter(Boolean);
  }

  private buildCatalog(
    base: ChatModelCatalog,
    models: string[],
    probes: WorkingRouteProbe[],
    recoveryMode: "LIVE" | "TRUSTED_CONFIG" = "LIVE",
    recoveryReason?: string
  ): WorkingChatModelCatalog {
    const modelSet = new Set(models);
    const entries = base.entries?.filter((entry) => modelSet.has(entry.id));
    const modelSources = pickRecord(base.billing?.modelSources, modelSet) ?? {};
    const modelRoutes = pickRecord<ChatModelRoute>(base.billing?.modelRoutes, modelSet);
    const freeModels = models.filter((model) => FREE_SOURCES.has(modelSources[model] ?? sourceOf(base, model)));
    const subscriptionModels = models.filter((model) => (modelSources[model] ?? sourceOf(base, model)) === "SUBSCRIPTION_HARNESS");
    const limitedModels = probes.filter((probe) => probe.health === "RATE_LIMITED").map((probe) => probe.model);
    const baseInventory = (base as Partial<LiveChatModelCatalog>).inventory;
    const checkedAt = new Date().toISOString();

    return {
      ...base,
      models,
      ...(entries === undefined ? {} : { entries: entries as ChatModelEntry[] }),
      ...(base.billing === undefined ? {} : {
        billing: {
          ...base.billing,
          modelSources,
          ...(modelRoutes === undefined ? {} : { modelRoutes })
        }
      }),
      inventory: {
        totalModels: baseInventory?.totalModels ?? base.models.length,
        verifiedFreeModels: baseInventory?.verifiedFreeModels ?? freeModels.length,
        freeCandidates: baseInventory?.freeCandidates ?? freeModels.length,
        executableModels: baseInventory?.executableModels ?? base.models.length,
        activeModels: recoveryMode === "LIVE" ? models.length : 0
      },
      workingSet: {
        activeModels: recoveryMode === "LIVE" ? models : [],
        freeModels,
        subscriptionModels,
        limitedModels,
        candidatesTested: probes.length,
        checkedAt,
        recoveryMode,
        ...(recoveryReason === undefined ? {} : { recoveryReason })
      }
    };
  }

  private async saveSnapshot(value: WorkingChatModelCatalog): Promise<void> {
    if (!this.snapshotPath) return;
    try {
      await mkdir(dirname(this.snapshotPath), { recursive: true, mode: 0o700 });
      const tmp = `${this.snapshotPath}.${process.pid}.tmp`;
      await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(tmp, this.snapshotPath);
    } catch {
      // A snapshot is resilience only; inability to persist it must not break live routing.
    }
  }

  private async loadSnapshot(reason: string): Promise<WorkingChatModelCatalog | null> {
    if (!this.snapshotPath) return null;
    try {
      const parsed = JSON.parse(await readFile(this.snapshotPath, "utf8")) as WorkingChatModelCatalog;
      if (!Array.isArray(parsed.models) || parsed.models.length === 0) return null;
      const checkedAt = Date.parse(parsed.workingSet?.checkedAt ?? parsed.checkedAt);
      if (!Number.isFinite(checkedAt) || Date.now() - checkedAt > this.snapshotMaxAgeMs) return null;
      return {
        ...parsed,
        workingSet: {
          ...parsed.workingSet,
          recoveryMode: "LAST_KNOWN_GOOD",
          recoveryReason: reason
        }
      };
    } catch {
      return null;
    }
  }

  private trustedConfiguredFallback(base: ChatModelCatalog, candidates: string[]): string[] {
    const candidateSet = new Set(candidates);
    return this.preferredModels
      .map(safeModel)
      .filter((model): model is string => Boolean(model))
      .filter((model) => candidateSet.has(model))
      .filter((model, index, all) => all.indexOf(model) === index);
  }

  async list(force = false): Promise<WorkingChatModelCatalog> {
    const now = Date.now();
    if (!force && this.cache && this.cache.expiresAt > now) return this.cache.value;

    let base: ChatModelCatalog;
    try {
      base = await this.upstream.list();
    } catch (error) {
      const snapshot = await this.loadSnapshot(error instanceof Error ? error.message : "CATALOG_REFRESH_FAILED");
      if (snapshot) {
        this.cache = { value: snapshot, expiresAt: now + this.cacheTtlMs };
        return snapshot;
      }
      throw error;
    }

    const candidates = chooseAliases(base, this.preferredModels).slice(0, this.maxCandidates);
    if (!candidates.length) {
      const snapshot = await this.loadSnapshot("CHAT_MODEL_WORKING_SET_NO_CANDIDATES");
      if (snapshot) {
        this.cache = { value: snapshot, expiresAt: now + this.cacheTtlMs };
        return snapshot;
      }
      throw new ChatModelCatalogError("CHAT_MODEL_WORKING_SET_NO_CANDIDATES", 503);
    }

    const probes = await this.probeCandidates(candidates, this.credential());
    const activeModels = probes.filter((probe) => probe.health === "HEALTHY").map((probe) => probe.model);
    if (activeModels.length) {
      const value = this.buildCatalog(base, activeModels, probes, "LIVE");
      this.cache = { value, expiresAt: now + this.cacheTtlMs };
      await this.saveSnapshot(value);
      return value;
    }

    const snapshot = await this.loadSnapshot("CHAT_MODEL_WORKING_SET_EMPTY");
    if (snapshot) {
      this.cache = { value: snapshot, expiresAt: now + this.cacheTtlMs };
      return snapshot;
    }

    const trusted = this.trustedConfiguredFallback(base, candidates);
    if (trusted.length) {
      const value = this.buildCatalog(base, trusted, probes, "TRUSTED_CONFIG", "All live probes failed; using exact configured route only");
      this.cache = { value, expiresAt: now + this.cacheTtlMs };
      return value;
    }

    throw new ChatModelCatalogError("CHAT_MODEL_WORKING_SET_EMPTY", 503);
  }
}
