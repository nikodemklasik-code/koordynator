import { readAttachment } from "./attachment-reader.js";
import { detectProjectConsensus, type ProjectConsensus } from "./chat-consensus.js";
import { canonicalDigest } from "../crypto/canonical-digest.js";
import { repositoryTask, type RepositoryExecutor } from "./hermes-repository-runner.js";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { extractProviderReportedUsage, type ProviderReportedUsage } from "../api/provider-usage.js";
import type { ChatBillingDecision } from "./chat-billing-policy.js";
import { extractChatAttachmentText } from "./chat-attachment-text.js";
import { ChatUsageLedger, type ChatUsageSummary } from "./chat-usage-ledger.js";

export type ChatRole = "user" | "assistant";
export type ChatMessageState = "complete" | "streaming" | "stopped" | "error";

export type ChatAttachment = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  dataUrl: string;
  extractedText?: string;
  extractionStatus?: string;
};

export type ChatAttachmentInput = Omit<ChatAttachment, "id">;

export type ChatMessage = {
  id: string;
  sessionId: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  completedAt?: string;
  state: ChatMessageState;
  model?: string;
  providerRequestId?: string;
  attachments?: ChatAttachment[];
  billing?: ChatBillingDecision;
  usage?: ProviderReportedUsage;
  usageAudit?: "PERSISTED" | "WRITE_FAILED";
  /** Set when this turn shipped an agreed plan into Tasks. */
  materialisedTaskId?: string;
  /** Identity of the shipped plan, so repeating the request cannot duplicate it. */
  materialisationFingerprint?: string;
  materialisationError?: string;
};

export type ChatSession = {
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  model: string;
  messages: ChatMessage[];
};

export type ChatSessionSummary = {
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  model: string;
  title: string;
  messageCount: number;
};

export type ChatEvent =
  | { type: "task_materialised"; sessionId: string; taskId: string }
  | { type: "connected"; sessionId: string }
  | { type: "user_message"; message: ChatMessage }
  | { type: "assistant_start"; message: ChatMessage }
  | { type: "assistant_delta"; sessionId: string; messageId: string; delta: string }
  | { type: "assistant_done"; message: ChatMessage }
  | { type: "stopped"; message: ChatMessage }
  | { type: "error"; sessionId: string; code: string; message: string };

export class ChatServiceError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
  }
}

export type ChatServiceOptions = {
  stateDir: string;
  repositoryExecutor?: RepositoryExecutor;
  /** Ships an agreed plan into Tasks; omitted when no signing key is configured. */
  materialiser?: (consensus: ProjectConsensus) => Promise<{ taskId: string }>;
  endpoint?: string;
  apiKey?: string;
  apiKeyEnv?: string;
  defaultModel?: string;
  fallbackModels?: string[];
  fetchImpl?: typeof fetch;
  maxMessageBytes?: number;
  maxHistoryMessages?: number;
  maxHistoryChars?: number;
  maxAttachments?: number;
  maxAttachmentBytes?: number;
  maxAttachmentTotalBytes?: number;
  maxHistoryAttachmentBytes?: number;
  timeoutMs?: number;
  projectContextProvider?: () => Promise<string | null | undefined>;
};

type Subscriber = (event: ChatEvent) => void;
type ActiveGeneration = { controller: AbortController; messageId: string };
type UpstreamTextPart = { type: "text"; text: string };
type UpstreamImagePart = { type: "image_url"; image_url: { url: string } };
type UpstreamFilePart = { type: "file"; file: { filename: string; file_data: string } };
type UpstreamContentPart = UpstreamTextPart | UpstreamImagePart | UpstreamFilePart;
type UpstreamMessage = { role: "system" | ChatRole; content: string | UpstreamContentPart[] };

const SESSION_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MODEL_RE = /^[A-Za-z0-9._:/-]{1,160}$/;
const MIME_RE = /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/;
const DATA_URL_RE = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/;


function now(): string { return new Date().toISOString(); }
function normalizeEndpoint(value: string): string { return value.replace(/\/+$/, ""); }
function sessionFile(root: string, sessionId: string): string { return join(root, `${sessionId}.json`); }

function safeModel(value: string): string {
  const model = value.trim();
  if (!MODEL_RE.test(model)) throw new ChatServiceError("CHAT_MODEL_INVALID", 400);
  if (model.toLowerCase().includes("deepseek")) throw new ChatServiceError("CHAT_MODEL_FORBIDDEN", 400);
  return model;
}

function safeAttachmentName(value: unknown): string {
  if (typeof value !== "string") throw new ChatServiceError("CHAT_ATTACHMENTS_INVALID", 400);
  const name = value.trim();
  if (!name || name.length > 180 || /[\\/\u0000-\u001f\u007f]/.test(name)) throw new ChatServiceError("CHAT_ATTACHMENTS_INVALID", 400);
  return name;
}

function safeAttachmentMime(value: unknown): string {
  if (typeof value !== "string") throw new ChatServiceError("CHAT_ATTACHMENTS_INVALID", 400);
  const mimeType = value.trim().toLowerCase();
  if (!MIME_RE.test(mimeType)) throw new ChatServiceError("CHAT_ATTACHMENTS_INVALID", 400);

  return mimeType;
}

function parseAttachmentDataUrl(value: unknown, mimeType: string): { dataUrl: string; base64: string; bytes: number } {
  if (typeof value !== "string") throw new ChatServiceError("CHAT_ATTACHMENTS_INVALID", 400);
  const match = DATA_URL_RE.exec(value);
  if (!match?.[1] || match[2] === undefined) throw new ChatServiceError("CHAT_ATTACHMENTS_INVALID", 400);
  if (match[1].toLowerCase() !== mimeType) throw new ChatServiceError("CHAT_ATTACHMENTS_INVALID", 400);
  let decoded: Buffer;
  try { decoded = Buffer.from(match[2], "base64"); } catch { throw new ChatServiceError("CHAT_ATTACHMENTS_INVALID", 400); }
  return { dataUrl: value, base64: match[2], bytes: decoded.length };
}

function sessionTitle(session: ChatSession): string {
  const firstUser = session.messages.find((message) => message.role === "user");
  const fromText = firstUser?.content.trim().replace(/\s+/g, " ");
  if (fromText) return fromText.length > 80 ? `${fromText.slice(0, 77)}…` : fromText;
  const firstAttachment = firstUser?.attachments?.[0]?.name;
  if (firstAttachment) return firstAttachment.length > 80 ? `${firstAttachment.slice(0, 77)}…` : firstAttachment;
  return "New chat";
}

function extractDelta(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) return "";
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return "";
  const first = choices[0];
  if (typeof first !== "object" || first === null) return "";
  const delta = (first as { delta?: unknown }).delta;
  if (typeof delta !== "object" || delta === null) return "";
  const content = (delta as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((item) => {
      if (typeof item === "string") return item;
      if (typeof item === "object" && item !== null && typeof (item as { text?: unknown }).text === "string") return (item as { text: string }).text;
      return "";
    }).join("");
  }
  return "";
}

function mergeUsage(current: ProviderReportedUsage | undefined, next: ProviderReportedUsage): ProviderReportedUsage {
  return {
    reportedBy: "PROVIDER",
    ...((next.inputTokens ?? current?.inputTokens) === undefined ? {} : { inputTokens: next.inputTokens ?? current?.inputTokens }),
    ...((next.outputTokens ?? current?.outputTokens) === undefined ? {} : { outputTokens: next.outputTokens ?? current?.outputTokens }),
    ...((next.totalTokens ?? current?.totalTokens) === undefined ? {} : { totalTokens: next.totalTokens ?? current?.totalTokens }),
    ...((next.cost ?? current?.cost) === undefined ? {} : { cost: next.cost ?? current?.cost }),
    ...((next.currency ?? current?.currency) === undefined ? {} : { currency: next.currency ?? current?.currency })
  };
}

export function materialisationFingerprint(consensus: ProjectConsensus): string {
  return canonicalDigest({
    objective: consensus.objective.trim().toLowerCase(),
    modules: [...consensus.modules].map((item) => item.trim().toLowerCase()).sort(),
    allowedPaths: [...consensus.allowedPaths].map((item) => item.trim().toLowerCase()).sort()
  });
}

export class ChatService {
  private readonly root: string;
  private readonly repositoryExecutor: RepositoryExecutor | undefined;
  private readonly endpoint: string;
  private readonly apiKey: string | undefined;
  private readonly apiKeyEnv: string;
  private readonly defaultModel: string;
  private readonly fallbackModels: string[];
  private readonly fetchImpl: typeof fetch;
  private readonly maxMessageBytes: number;
  private readonly maxHistoryMessages: number;
  private readonly maxHistoryChars: number;
  private readonly maxAttachments: number;
  private readonly maxAttachmentBytes: number;
  private readonly maxAttachmentTotalBytes: number;
  private readonly maxHistoryAttachmentBytes: number;
  private readonly timeoutMs: number;
  private readonly usageLedger: ChatUsageLedger;
  private readonly projectContextProvider?: () => Promise<string | null | undefined>;
  private readonly subscribers = new Map<string, Set<Subscriber>>();
  private readonly starting = new Set<string>();
  private readonly active = new Map<string, ActiveGeneration>();
  private readonly materialiser: ChatServiceOptions["materialiser"];

  constructor(options: ChatServiceOptions) {
    this.root = resolve(options.stateDir, "chat");
    this.repositoryExecutor = options.repositoryExecutor;
    this.materialiser = options.materialiser;
    this.endpoint = normalizeEndpoint(options.endpoint ?? "http://127.0.0.1:20128/v1");
    this.apiKey = options.apiKey;
    this.apiKeyEnv = options.apiKeyEnv ?? "OMNIROUTE_API_KEY";
    this.defaultModel = safeModel(options.defaultModel ?? "auto/best-free");
    this.fallbackModels = [...new Set((options.fallbackModels ?? []).map((model) => model.trim()).filter(Boolean).filter((model) => model !== this.defaultModel))].slice(0, 6);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.maxMessageBytes = options.maxMessageBytes ?? 32 * 1024;
    this.maxHistoryMessages = options.maxHistoryMessages ?? 24;
    this.maxHistoryChars = options.maxHistoryChars ?? 64 * 1024;
    this.maxAttachments = options.maxAttachments ?? 5;
    this.maxAttachmentBytes = options.maxAttachmentBytes ?? 10 * 1024 * 1024;
    this.maxAttachmentTotalBytes = options.maxAttachmentTotalBytes ?? 20 * 1024 * 1024;
    this.maxHistoryAttachmentBytes = options.maxHistoryAttachmentBytes ?? 24 * 1024 * 1024;
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.usageLedger = new ChatUsageLedger(options.stateDir);
    if (options.projectContextProvider) this.projectContextProvider = options.projectContextProvider;
  }

  private credential(): string | undefined {
    const value = this.apiKey ?? process.env[this.apiKeyEnv];
    return value?.trim() || undefined;
  }

  private emit(sessionId: string, event: ChatEvent): void {
    for (const subscriber of this.subscribers.get(sessionId) ?? []) subscriber(event);
  }

  private async persist(session: ChatSession): Promise<void> {
    await mkdir(this.root, { recursive: true });
    const target = sessionFile(this.root, session.sessionId);
    const tmp = `${target}.${randomUUID()}.tmp`;
    await writeFile(tmp, `${JSON.stringify(session, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(tmp, target);
  }

  private normalizeAttachments(value: unknown): ChatAttachment[] {
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw new ChatServiceError("CHAT_ATTACHMENTS_INVALID", 400);
    if (value.length > this.maxAttachments) throw new ChatServiceError("CHAT_TOO_MANY_ATTACHMENTS", 413);
    const attachments: ChatAttachment[] = [];
    let totalBytes = 0;
    for (const item of value) {
      if (typeof item !== "object" || item === null || Array.isArray(item)) throw new ChatServiceError("CHAT_ATTACHMENTS_INVALID", 400);
      const record = item as Record<string, unknown>;
      const keys = Object.keys(record);
      if (keys.some((key) => !["name", "mimeType", "size", "dataUrl"].includes(key))) throw new ChatServiceError("CHAT_ATTACHMENTS_INVALID", 400);
      const name = safeAttachmentName(record.name);
      const mimeType = safeAttachmentMime(record.mimeType);
      if (typeof record.size !== "number" || !Number.isSafeInteger(record.size) || record.size < 0) throw new ChatServiceError("CHAT_ATTACHMENTS_INVALID", 400);
      const parsed = parseAttachmentDataUrl(record.dataUrl, mimeType);
      if (parsed.bytes !== record.size) throw new ChatServiceError("CHAT_ATTACHMENTS_INVALID", 400);
      if (parsed.bytes > this.maxAttachmentBytes) throw new ChatServiceError("CHAT_ATTACHMENT_TOO_LARGE", 413);
      totalBytes += parsed.bytes;
      if (totalBytes > this.maxAttachmentTotalBytes) throw new ChatServiceError("CHAT_ATTACHMENTS_TOO_LARGE", 413);
      attachments.push({ id: randomUUID(), name, mimeType, size: parsed.bytes, dataUrl: parsed.dataUrl });
    }
    return attachments;
  }

  async createSession(model?: string): Promise<ChatSession> {
    const timestamp = now();
    const session: ChatSession = {
      sessionId: randomUUID(),
      createdAt: timestamp,
      updatedAt: timestamp,
      model: model === undefined ? this.defaultModel : safeModel(model),
      messages: []
    };
    await this.persist(session);
    return session;
  }

  async listSessions(limit = 50): Promise<ChatSessionSummary[]> {
    const boundedLimit = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 100) : 50;
    let names: string[];
    try {
      names = (await readdir(this.root)).filter((name) => /^[0-9a-f-]+\.json$/i.test(name));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const sessions = await Promise.all(names.map(async (name) => {
      try {
        const raw = await readFile(join(this.root, name), "utf8");
        const session = JSON.parse(raw) as ChatSession;
        if (!SESSION_RE.test(session.sessionId) || !Array.isArray(session.messages)) return null;
        return {
          sessionId: session.sessionId,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          model: session.model,
          title: sessionTitle(session),
          messageCount: session.messages.length
        } satisfies ChatSessionSummary;
      } catch {
        return null;
      }
    }));
    return sessions
      .filter((session): session is ChatSessionSummary => session !== null)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.createdAt.localeCompare(a.createdAt))
      .slice(0, boundedLimit);
  }

  async getSession(sessionId: string): Promise<ChatSession | null> {
    if (!SESSION_RE.test(sessionId)) throw new ChatServiceError("CHAT_SESSION_INVALID", 400);
    try {
      const body = await readFile(sessionFile(this.root, sessionId), "utf8");
      return JSON.parse(body) as ChatSession;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async usageSummary(windowHours = 24): Promise<ChatUsageSummary> {
    return this.usageLedger.summary(windowHours);
  }

  subscribe(sessionId: string, subscriber: Subscriber): () => void {
    if (!SESSION_RE.test(sessionId)) throw new ChatServiceError("CHAT_SESSION_INVALID", 400);
    const set = this.subscribers.get(sessionId) ?? new Set<Subscriber>();
    set.add(subscriber);
    this.subscribers.set(sessionId, set);
    subscriber({ type: "connected", sessionId });
    return () => {
      set.delete(subscriber);
      if (set.size === 0) this.subscribers.delete(sessionId);
    };
  }

  async stop(sessionId: string): Promise<boolean> {
    const active = this.active.get(sessionId);
    if (!active) return false;
    active.controller.abort(new Error("CHAT_STOPPED"));
    return true;
  }

  private async upstreamMessage(message: ChatMessage): Promise<UpstreamMessage> {
    const attachments = message.role === "user" ? message.attachments ?? [] : [];
    if (attachments.length === 0) return { role: message.role, content: message.content };
    const parts: UpstreamContentPart[] = [];
    if (message.content) parts.push({ type: "text", text: message.content });
    for (const attachment of attachments) {
      const match = DATA_URL_RE.exec(attachment.dataUrl);
      if (!match || match[2] === undefined) throw new ChatServiceError("CHAT_ATTACHMENTS_INVALID", 400);
      if (attachment.extractedText !== undefined) {
        parts.push({ type: "text", text: `[Attachment: ${attachment.name}; ${attachment.extractionStatus}]\n${attachment.extractedText}` });
        continue;
      }
      if (attachment.mimeType.startsWith("image/")) {
        parts.push({ type: "image_url", image_url: { url: attachment.dataUrl } });
        continue;
      }
      const bytes = Buffer.from(match[2], "base64");
      const extracted = await extractChatAttachmentText({
        name: attachment.name,
        mimeType: attachment.mimeType,
        bytes
      });
      if (extracted) {
        parts.push({
          type: "text",
          text: `Attached file: ${attachment.name}\n--- BEGIN EXTRACTED TEXT ---\n${extracted}\n--- END EXTRACTED TEXT ---`
        });
        continue;
      }
      parts.push({
        type: "text",
        text: `Attached file: ${attachment.name} (${attachment.mimeType}, ${attachment.size} bytes). Binary content could not be extracted as text.`
      });
    }
    return { role: message.role, content: parts };
  }

  private async boundedHistory(messages: ChatMessage[]): Promise<UpstreamMessage[]> {
    const selected: ChatMessage[] = [];
    let chars = 0;
    let attachmentBytes = 0;
    for (const message of messages.slice().reverse()) {
      if (message.state === "error") continue;
      const nextChars = chars + message.content.length + (message.attachments ?? []).reduce((sum, a) => sum + (a.extractedText?.length ?? 0), 0);
      const messageAttachmentBytes = (message.attachments ?? []).reduce((sum, attachment) => sum + attachment.size, 0);
      const nextAttachmentBytes = attachmentBytes + messageAttachmentBytes;
      if (selected.length && (selected.length >= this.maxHistoryMessages || nextChars > this.maxHistoryChars || nextAttachmentBytes > this.maxHistoryAttachmentBytes)) break;
      selected.push(message);
      chars = nextChars;
      attachmentBytes = nextAttachmentBytes;
    }
    const history = [];
    for (const message of selected.reverse()) history.push(await this.upstreamMessage(message));
    if (!this.projectContextProvider) return history;
    try {
      const context = (await this.projectContextProvider())?.trim();
      if (!context) return history;
      return [{ role: "system", content: context.slice(0, 24_000) }, ...history];
    } catch {
      return history;
    }
  }

  private async recordUsage(assistant: ChatMessage): Promise<boolean> {
    if (!assistant.model) return false;
    try {
      await this.usageLedger.append({
        sessionId: assistant.sessionId,
        messageId: assistant.id,
        model: assistant.model,
        source: assistant.billing?.source ?? "UNKNOWN",
        transport: "OMNIROUTE_API",
        subscriptionHarnessUsed: false,
        billingDecision: assistant.billing?.decision ?? "DIRECT_SERVICE_NO_BILLING_DECISION",
        startedAt: assistant.createdAt,
        completedAt: assistant.completedAt ?? now(),
        state: assistant.state === "streaming" ? "error" : assistant.state,
        ...(assistant.providerRequestId === undefined ? {} : { providerRequestId: assistant.providerRequestId }),
        ...(assistant.usage === undefined ? {} : { usage: assistant.usage })
      });
      assistant.usageAudit = "PERSISTED";
      return true;
    } catch {
      assistant.usageAudit = "WRITE_FAILED";
      return false;
    }
  }

  async startMessage(sessionId: string, messageText: string, requestedModel?: string, rawAttachments?: unknown, billing?: ChatBillingDecision) {
    if (this.starting.has(sessionId) || this.active.has(sessionId)) throw new ChatServiceError("CHAT_GENERATION_IN_PROGRESS", 409);
    this.starting.add(sessionId);
    try { return await this.prepareMessage(sessionId, messageText, requestedModel, rawAttachments, billing); }
    finally { this.starting.delete(sessionId); }
  }

  private async prepareMessage(
    sessionId: string,
    messageText: string,
    requestedModel?: string,
    rawAttachments?: unknown,
    billing?: ChatBillingDecision
  ): Promise<{ accepted: true; messageId: string; model: string; billingSource: string }> {
    const text = messageText.trim();
    const attachments = this.normalizeAttachments(rawAttachments);
    let repoTask;
    try { repoTask = repositoryTask(text); } catch { throw new ChatServiceError("REPO_TASK_INVALID_USE_REPO_URL_TASK", 400); }
    if (repoTask && !this.repositoryExecutor) throw new ChatServiceError("REPO_EXECUTION_DISABLED", 403);

    if (!text && attachments.length === 0) throw new ChatServiceError("CHAT_MESSAGE_EMPTY", 400);
    if (Buffer.byteLength(text, "utf8") > this.maxMessageBytes) throw new ChatServiceError("CHAT_MESSAGE_TOO_LARGE", 413);
    if (this.active.has(sessionId)) throw new ChatServiceError("CHAT_GENERATION_IN_PROGRESS", 409);
    const session = await this.getSession(sessionId);
    if (!session) throw new ChatServiceError("CHAT_SESSION_NOT_FOUND", 404);
    const key = this.credential();
    if (!key) throw new ChatServiceError("CHAT_AUTH_REQUIRED", 503);
    if (billing?.allowed === false) throw new ChatServiceError("CHAT_BILLING_POLICY_DENIED", 403);
    try {
      await this.usageLedger.ensureWritable();
    } catch {
      throw new ChatServiceError("CHAT_USAGE_LEDGER_UNAVAILABLE", 503);
    }
    const model = requestedModel === undefined ? session.model : safeModel(requestedModel);
    session.model = model;
    for (const attachment of attachments) {
      try {
        const bytes = Buffer.from(attachment.dataUrl.split(",")[1]!, "base64");
        const read = await readAttachment(bytes, attachment.name, attachment.mimeType);
        attachment.extractionStatus = read.status;
        attachment.mimeType = read.detected;
        attachment.dataUrl = `data:${read.detected};base64,${bytes.toString("base64")}`;
        if (read.text !== undefined) attachment.extractedText = read.text;
      } catch (error) {
        throw new ChatServiceError(error instanceof Error && /^CHAT_[A-Z_]+$/.test(error.message) ? error.message : "CHAT_ATTACHMENT_PARSE_FAILED", 422);
      }
    }

    const user: ChatMessage = {
      id: randomUUID(),
      sessionId,
      role: "user",
      content: text,
      createdAt: now(),
      state: "complete",
      ...(attachments.length === 0 ? {} : { attachments })
    };
    const assistant: ChatMessage = {
      id: randomUUID(),
      sessionId,
      role: "assistant",
      content: "",
      createdAt: now(),
      state: "streaming",
      model,
      ...(billing === undefined ? {} : { billing })
    };
    session.messages.push(user, assistant);
    session.updatedAt = now();
    await this.persist(session);
    this.emit(sessionId, { type: "user_message", message: user });
    this.emit(sessionId, { type: "assistant_start", message: assistant });

    const controller = new AbortController();
    this.active.set(sessionId, { controller, messageId: assistant.id });
    void this.generate(session, assistant, controller, key).finally(() => {
      const current = this.active.get(sessionId);
      if (current?.messageId === assistant.id) this.active.delete(sessionId);
    });
    return { accepted: true, messageId: assistant.id, model, billingSource: billing?.source ?? "UNKNOWN" };
  }

  private async finalize(session: ChatSession, assistant: ChatMessage, state: "complete" | "stopped" | "error"): Promise<boolean> {
    assistant.state = state;
    assistant.completedAt = now();
    session.updatedAt = assistant.completedAt;
    await this.persist(session);
    const audited = await this.recordUsage(assistant);
    if (state === "complete") await this.maybeMaterialise(session, assistant);
    await this.persist(session);
    return audited;
  }

  /**
   * Materialises a Tasks entry only when the user explicitly asked to ship an agreed plan.
   * Never throws into the chat turn: a materialisation failure must not break the reply.
   *
   * Idempotent per agreed plan: the guard must look at the whole session, because every turn
   * produces a NEW assistant message. A per-message check would let a second "ship it" create
   * a duplicate task for work that is already queued.
   */
  private async maybeMaterialise(session: ChatSession, assistant: ChatMessage): Promise<void> {
    if (!this.materialiser) return;
    if (assistant.materialisedTaskId) return;
    try {
      const consensus = detectProjectConsensus(
        session.messages.map((message) => ({ role: message.role, content: message.content }))
      );
      if (!consensus) return;
      // Same objective + scope already shipped in this session? Re-point, do not re-create.
      const fingerprint = materialisationFingerprint(consensus);
      const previous = session.messages.find(
        (message) => message.materialisedTaskId && message.materialisationFingerprint === fingerprint
      );
      if (previous?.materialisedTaskId) {
        assistant.materialisedTaskId = previous.materialisedTaskId;
        assistant.materialisationFingerprint = fingerprint;
        return;
      }
      const result = await this.materialiser(consensus);
      assistant.materialisedTaskId = result.taskId;
      assistant.materialisationFingerprint = fingerprint;
      this.emit(session.sessionId, { type: "task_materialised", sessionId: session.sessionId, taskId: result.taskId });
    } catch (error) {
      assistant.materialisationError = error instanceof Error ? error.message : "MATERIALISATION_FAILED";
    }
  }

  private async generate(session: ChatSession, assistant: ChatMessage, controller: AbortController, key: string): Promise<void> {
    const sessionId = session.sessionId;
    const timeout = setTimeout(() => controller.abort(new Error("CHAT_TIMEOUT")), repositoryTask(session.messages.at(-2)!.content) ? 30 * 60_000 : this.timeoutMs);
    try {
      const taskText = session.messages.at(-2)!.content;
      if (repositoryTask(taskText) && this.repositoryExecutor) {
        await this.repositoryExecutor({ text: taskText, model: session.model, endpoint: this.endpoint, apiKey: key, attachments: session.messages.at(-2)?.attachments ?? [], signal: controller.signal, emit: delta => {
          assistant.content += delta;
          this.emit(sessionId, { type: "assistant_delta", sessionId, messageId: assistant.id, delta });
        } });
        const audited = await this.finalize(session, assistant, "complete");
        if (!audited) throw new ChatServiceError("CHAT_USAGE_LEDGER_WRITE_FAILED", 503);
        this.emit(sessionId, { type: "assistant_done", message: assistant });
        return;
      }
      const history = await this.boundedHistory(session.messages.filter((item) => item.id !== assistant.id));
      const chain = [session.model, ...this.fallbackModels.filter((model) => model !== session.model)];
      let response: Response | undefined;
      let lastRateLimit: ChatServiceError | undefined;
      for (const model of chain) {
        const attempt = await this.fetchImpl(`${this.endpoint}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
          body: JSON.stringify({ model, messages: history, stream: true, stream_options: { include_usage: true } }),
          signal: controller.signal
        });
        if (attempt.status === 401 || attempt.status === 403) throw new ChatServiceError("CHAT_AUTH_REQUIRED", 503);
        if (attempt.status === 429 || attempt.status === 503) {
          lastRateLimit = new ChatServiceError(
            attempt.status === 429 ? "CHAT_RATE_LIMITED" : "CHAT_UPSTREAM_503",
            attempt.status === 429 ? 429 : 502
          );
          continue;
        }
        if (!attempt.ok) throw new ChatServiceError(`CHAT_UPSTREAM_${attempt.status}`, 502);
        response = attempt;
        assistant.model = model;
        session.model = model;
        break;
      }
      if (!response) throw lastRateLimit ?? new ChatServiceError("CHAT_RATE_LIMITED", 429);
      const providerRequestId = response.headers.get("x-request-id") ?? undefined;
      if (providerRequestId !== undefined) assistant.providerRequestId = providerRequestId;
      if (!response.body) throw new ChatServiceError("CHAT_STREAM_MISSING", 502);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = "";
      let done = false;
      while (!done) {
        const part = await reader.read();
        done = part.done;
        pending += decoder.decode(part.value ?? new Uint8Array(), { stream: !done });
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          let parsed: unknown;
          try { parsed = JSON.parse(data); } catch { continue; }
          const usage = extractProviderReportedUsage(parsed);
          if (usage) assistant.usage = mergeUsage(assistant.usage, usage);
          const delta = extractDelta(parsed);
          if (!delta) continue;
          assistant.content += delta;
          session.updatedAt = now();
          this.emit(sessionId, { type: "assistant_delta", sessionId, messageId: assistant.id, delta });
        }
      }
      const audited = await this.finalize(session, assistant, "complete");
      if (!audited) {
        this.emit(sessionId, { type: "error", sessionId, code: "CHAT_USAGE_LEDGER_WRITE_FAILED", message: "CHAT_USAGE_LEDGER_WRITE_FAILED" });
        return;
      }
      this.emit(sessionId, { type: "assistant_done", message: assistant });
    } catch (error) {
      if (controller.signal.aborted) {
        const audited = await this.finalize(session, assistant, "stopped");
        if (!audited) {
          this.emit(sessionId, { type: "error", sessionId, code: "CHAT_USAGE_LEDGER_WRITE_FAILED", message: "CHAT_USAGE_LEDGER_WRITE_FAILED" });
          return;
        }
        this.emit(sessionId, { type: "stopped", message: assistant });
        return;
      }
      const code = error instanceof ChatServiceError ? error.code : error instanceof Error ? error.message : "CHAT_UNAVAILABLE";
      await this.finalize(session, assistant, "error");
      this.emit(sessionId, { type: "error", sessionId, code, message: code });
    } finally {
      clearTimeout(timeout);
    }
  }

  close(): void {
    for (const active of this.active.values()) active.controller.abort(new Error("CHAT_SERVER_CLOSED"));
    this.active.clear();
    this.subscribers.clear();
  }
}
