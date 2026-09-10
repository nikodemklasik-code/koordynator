import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { ProviderReportedUsage } from "../api/provider-usage.js";
import type { ChatModelBillingSource } from "./chat-model-catalog.js";

export type ChatUsageRecord = {
  sessionId: string;
  messageId: string;
  model: string;
  source: ChatModelBillingSource;
  transport: "OMNIROUTE_API";
  subscriptionHarnessUsed: false;
  billingDecision: string;
  startedAt: string;
  completedAt: string;
  state: "complete" | "stopped" | "error";
  providerRequestId?: string;
  usage?: ProviderReportedUsage;
};

export type ChatUsageBucket = {
  requests: number;
  tokenTelemetryReported: number;
  tokenTelemetryUnreported: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costs: Record<string, number>;
};

export type ChatUsageSummary = ChatUsageBucket & {
  windowHours: number;
  generatedAt: string;
  bySource: Record<ChatModelBillingSource, ChatUsageBucket>;
};

function emptyBucket(): ChatUsageBucket {
  return {
    requests: 0,
    tokenTelemetryReported: 0,
    tokenTelemetryUnreported: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    costs: {}
  };
}

function source(value: unknown): ChatModelBillingSource {
  return value === "FREE_REQUESTED" || value === "FREE_CONFIRMED" || value === "PAID_API" ? value : "UNKNOWN";
}

function safeRecord(value: unknown): ChatUsageRecord | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (typeof item.sessionId !== "string" || typeof item.messageId !== "string" || typeof item.model !== "string") return null;
  if (typeof item.startedAt !== "string" || typeof item.completedAt !== "string") return null;
  if (item.state !== "complete" && item.state !== "stopped" && item.state !== "error") return null;
  const usage = typeof item.usage === "object" && item.usage !== null ? item.usage as ProviderReportedUsage : undefined;
  return {
    sessionId: item.sessionId,
    messageId: item.messageId,
    model: item.model,
    source: source(item.source),
    transport: "OMNIROUTE_API",
    subscriptionHarnessUsed: false,
    billingDecision: typeof item.billingDecision === "string" ? item.billingDecision : "UNKNOWN",
    startedAt: item.startedAt,
    completedAt: item.completedAt,
    state: item.state,
    ...(typeof item.providerRequestId === "string" ? { providerRequestId: item.providerRequestId } : {}),
    ...(usage === undefined ? {} : { usage })
  };
}

function add(bucket: ChatUsageBucket, record: ChatUsageRecord): void {
  bucket.requests += 1;
  if (record.usage === undefined) {
    bucket.tokenTelemetryUnreported += 1;
    return;
  }
  bucket.tokenTelemetryReported += 1;
  bucket.inputTokens += record.usage.inputTokens ?? 0;
  bucket.outputTokens += record.usage.outputTokens ?? 0;
  bucket.totalTokens += record.usage.totalTokens ?? ((record.usage.inputTokens ?? 0) + (record.usage.outputTokens ?? 0));
  if (record.usage.cost !== undefined) {
    const currency = record.usage.currency ?? "UNSPECIFIED";
    bucket.costs[currency] = (bucket.costs[currency] ?? 0) + record.usage.cost;
  }
}

export class ChatUsageLedger {
  private readonly path: string;

  constructor(stateDir: string) {
    this.path = resolve(stateDir, "chat-usage.jsonl");
  }

  async ensureWritable(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, "", { encoding: "utf8", mode: 0o600 });
  }

  async append(record: ChatUsageRecord): Promise<void> {
    await this.ensureWritable();
    await appendFile(this.path, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
  }

  async records(): Promise<ChatUsageRecord[]> {
    let raw: string;
    try {
      raw = await readFile(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const records: ChatUsageRecord[] = [];
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const parsed = safeRecord(JSON.parse(line));
        if (parsed) records.push(parsed);
      } catch {
        // A malformed historical line is ignored instead of corrupting the entire usage view.
      }
    }
    return records;
  }

  async summary(windowHours = 24): Promise<ChatUsageSummary> {
    const hours = Number.isFinite(windowHours) ? Math.min(Math.max(windowHours, 1), 24 * 365) : 24;
    const generatedAt = new Date().toISOString();
    const cutoff = Date.parse(generatedAt) - hours * 60 * 60 * 1000;
    const bySource: ChatUsageSummary["bySource"] = {
      FREE_REQUESTED: emptyBucket(),
      FREE_CONFIRMED: emptyBucket(),
      PAID_API: emptyBucket(),
      UNKNOWN: emptyBucket()
    };
    const total = emptyBucket();
    for (const record of await this.records()) {
      const timestamp = Date.parse(record.completedAt);
      if (!Number.isFinite(timestamp) || timestamp < cutoff) continue;
      add(total, record);
      add(bySource[record.source], record);
    }
    return { windowHours: hours, generatedAt, ...total, bySource };
  }
}
