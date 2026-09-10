import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export type ChatRole = "user" | "assistant";
export type ChatMessageState = "complete" | "streaming" | "stopped" | "error";

export type ChatMessage = {
  id: string;
  sessionId: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  state: ChatMessageState;
  model?: string;
  providerRequestId?: string;
};

export type ChatSession = {
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  model: string;
  messages: ChatMessage[];
};

export type ChatEvent =
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
  endpoint?: string;
  apiKey?: string;
  apiKeyEnv?: string;
  defaultModel?: string;
  fetchImpl?: typeof fetch;
  maxMessageBytes?: number;
  maxHistoryMessages?: number;
  maxHistoryChars?: number;
  timeoutMs?: number;
};

type Subscriber = (event: ChatEvent) => void;
type ActiveGeneration = { controller: AbortController; messageId: string };

const SESSION_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MODEL_RE = /^[A-Za-z0-9._:/-]{1,160}$/;

function now(): string { return new Date().toISOString(); }
function normalizeEndpoint(value: string): string { return value.replace(/\/+$/, ""); }
function sessionFile(root: string, sessionId: string): string { return join(root, `${sessionId}.json`); }

function safeModel(value: string): string {
  const model = value.trim();
  if (!MODEL_RE.test(model)) throw new ChatServiceError("CHAT_MODEL_INVALID", 400);
  if (model.toLowerCase().includes("deepseek")) throw new ChatServiceError("CHAT_MODEL_FORBIDDEN", 400);
  return model;
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

export class ChatService {
  private readonly root: string;
  private readonly endpoint: string;
  private readonly apiKey: string | undefined;
  private readonly apiKeyEnv: string;
  private readonly defaultModel: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxMessageBytes: number;
  private readonly maxHistoryMessages: number;
  private readonly maxHistoryChars: number;
  private readonly timeoutMs: number;
  private readonly subscribers = new Map<string, Set<Subscriber>>();
  private readonly active = new Map<string, ActiveGeneration>();

  constructor(options: ChatServiceOptions) {
    this.root = resolve(options.stateDir, "chat");
    this.endpoint = normalizeEndpoint(options.endpoint ?? "http://127.0.0.1:20128/v1");
    this.apiKey = options.apiKey;
    this.apiKeyEnv = options.apiKeyEnv ?? "OMNIROUTE_API_KEY";
    this.defaultModel = safeModel(options.defaultModel ?? "openai/gpt-5.6-sol");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.maxMessageBytes = options.maxMessageBytes ?? 32 * 1024;
    this.maxHistoryMessages = options.maxHistoryMessages ?? 24;
    this.maxHistoryChars = options.maxHistoryChars ?? 64 * 1024;
    this.timeoutMs = options.timeoutMs ?? 120_000;
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

  private boundedHistory(messages: ChatMessage[]): Array<{ role: ChatRole; content: string }> {
    const selected: ChatMessage[] = [];
    let chars = 0;
    for (const message of messages.slice().reverse()) {
      if (message.state === "error") continue;
      const next = chars + message.content.length;
      if (selected.length >= this.maxHistoryMessages || next > this.maxHistoryChars) break;
      selected.push(message);
      chars = next;
    }
    return selected.reverse().map(({ role, content }) => ({ role, content }));
  }

  async startMessage(sessionId: string, messageText: string, requestedModel?: string): Promise<{ accepted: true; messageId: string; model: string }> {
    const text = messageText.trim();
    if (!text) throw new ChatServiceError("CHAT_MESSAGE_EMPTY", 400);
    if (Buffer.byteLength(text, "utf8") > this.maxMessageBytes) throw new ChatServiceError("CHAT_MESSAGE_TOO_LARGE", 413);
    if (this.active.has(sessionId)) throw new ChatServiceError("CHAT_GENERATION_IN_PROGRESS", 409);
    const session = await this.getSession(sessionId);
    if (!session) throw new ChatServiceError("CHAT_SESSION_NOT_FOUND", 404);
    const key = this.credential();
    if (!key) throw new ChatServiceError("CHAT_AUTH_REQUIRED", 503);
    const model = requestedModel === undefined ? session.model : safeModel(requestedModel);
    session.model = model;

    const user: ChatMessage = { id: randomUUID(), sessionId, role: "user", content: text, createdAt: now(), state: "complete" };
    const assistant: ChatMessage = { id: randomUUID(), sessionId, role: "assistant", content: "", createdAt: now(), state: "streaming", model };
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
    return { accepted: true, messageId: assistant.id, model };
  }

  private async generate(session: ChatSession, assistant: ChatMessage, controller: AbortController, key: string): Promise<void> {
    const sessionId = session.sessionId;
    const timeout = setTimeout(() => controller.abort(new Error("CHAT_TIMEOUT")), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.endpoint}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: session.model, messages: this.boundedHistory(session.messages.filter((item) => item.id !== assistant.id)), stream: true }),
        signal: controller.signal
      });
      if (response.status === 401 || response.status === 403) throw new ChatServiceError("CHAT_AUTH_REQUIRED", 503);
      if (response.status === 429) throw new ChatServiceError("CHAT_RATE_LIMITED", 429);
      if (!response.ok) throw new ChatServiceError(`CHAT_UPSTREAM_${response.status}`, 502);
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
          const delta = extractDelta(parsed);
          if (!delta) continue;
          assistant.content += delta;
          session.updatedAt = now();
          this.emit(sessionId, { type: "assistant_delta", sessionId, messageId: assistant.id, delta });
        }
      }
      assistant.state = "complete";
      session.updatedAt = now();
      await this.persist(session);
      this.emit(sessionId, { type: "assistant_done", message: assistant });
    } catch (error) {
      if (controller.signal.aborted) {
        assistant.state = "stopped";
        session.updatedAt = now();
        await this.persist(session);
        this.emit(sessionId, { type: "stopped", message: assistant });
        return;
      }
      const code = error instanceof ChatServiceError ? error.code : error instanceof Error ? error.message : "CHAT_UNAVAILABLE";
      assistant.state = "error";
      session.updatedAt = now();
      await this.persist(session);
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
