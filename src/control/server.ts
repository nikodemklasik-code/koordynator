import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Digest, TaskId } from "../domain/ids.js";
import { TaskReadModel, controlRoots, type TaskFilter } from "./task-read-model.js";
import { ProviderReadModel, providerReceiptRoot } from "./provider-read-model.js";
import { ReleaseReadModel } from "./release-read-model.js";
import { ChatService, ChatServiceError, type ChatEvent } from "./chat-service.js";
import { GitHubConnectionError, GitHubConnectionService, type GitHubConnectionPort } from "./github-connection-service.js";
import { ChatModelCatalogError, ChatModelCatalogService, type ChatModelCatalogPort } from "./chat-model-catalog.js";
import { GitHubRepositoryContextError, GitHubRepositoryContextService, type GitHubRepositoryContextPort } from "./github-repository-context.js";

export type ControlServerOptions = {
  stateDir: string;
  webRoot?: string;
  environment?: string;
  region?: string;
  zone?: string;
  operator?: string;
  ciVerify?: "PASS" | "FAIL" | "UNKNOWN";
  version?: string;
  chatEndpoint?: string;
  chatApiKey?: string;
  chatApiKeyEnv?: string;
  chatDefaultModel?: string;
  chatFetchImpl?: typeof fetch;
  githubConnection?: GitHubConnectionPort;
  githubRepositoryContext?: GitHubRepositoryContextPort;
  chatModelCatalog?: ChatModelCatalogPort;
};

const FILTERS = new Set<TaskFilter>(["all", "building", "frozen", "validating", "awaiting-approval", "released", "returned"]);
const CHAT_SESSION_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
  response.end(JSON.stringify(payload));
}

function sendText(response: ServerResponse, status: number, contentType: string, body: string): void {
  response.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-cache",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "content-security-policy": "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
  });
  response.end(body);
}

function safeTaskId(value: string): TaskId | null { return /^TASK-[A-Za-z0-9._-]+$/.test(value) ? value as TaskId : null; }
function safeProviderId(value: string): string | null { return /^[a-z0-9][a-z0-9._-]+$/i.test(value) ? value : null; }
function safeDigest(value: string): Digest | null { return /^sha256:[a-f0-9]{64}$/i.test(value) ? value as Digest : null; }
function parseUrl(request: IncomingMessage): URL { return new URL(request.url ?? "/", "http://127.0.0.1"); }
function isClientInputError(message: string): boolean {
  return ["TASK_NOT_RETURNED", "CURRENT_POLICY_FP_REQUIRED", "CURRENT_POLICY_FP_INVALID", "SIGNED_WORK_ORDER_NOT_FOUND"].includes(message);
}

function isControlPost(pathname: string): boolean {
  return pathname === "/api/chat/sessions" ||
    pathname === "/api/integrations/github/connect" ||
    /^\/api\/chat\/sessions\/[0-9a-f-]+\/messages$/i.test(pathname) ||
    /^\/api\/chat\/sessions\/[0-9a-f-]+\/stop$/i.test(pathname);
}

async function readJsonBody(request: IncomingMessage, maxBytes = 40 * 1024): Promise<Record<string, unknown>> {
  const type = String(request.headers["content-type"] ?? "").split(";", 1)[0]?.trim().toLowerCase();
  if (type !== "application/json") throw new ChatServiceError("CHAT_CONTENT_TYPE_REQUIRED", 415);
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) throw new ChatServiceError("CHAT_BODY_TOO_LARGE", 413);
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  let parsed: unknown;
  try { parsed = raw ? JSON.parse(raw) : {}; } catch { throw new ChatServiceError("CHAT_JSON_INVALID", 400); }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new ChatServiceError("CHAT_JSON_OBJECT_REQUIRED", 400);
  return parsed as Record<string, unknown>;
}

function assertExactKeys(payload: Record<string, unknown>, allowed: string[]): void {
  const allowedSet = new Set(allowed);
  if (Object.keys(payload).some((key) => !allowedSet.has(key))) throw new ChatServiceError("CHAT_UNKNOWN_FIELD", 400);
}

function safeSessionId(value: string): string {
  if (!CHAT_SESSION_RE.test(value)) throw new ChatServiceError("CHAT_SESSION_INVALID", 400);
  return value;
}

function sseWrite(response: ServerResponse, event: ChatEvent): void {
  if (response.destroyed || response.writableEnded) return;
  response.write(`data: ${JSON.stringify(event)}\n\n`);
}

function repositoryAttachment(repository: string, commit: string, context: string) {
  const data = Buffer.from(context, "utf8");
  const safeRepo = repository.replace(/[^A-Za-z0-9._-]+/g, "-");
  return {
    name: `GitHub-${safeRepo}-${commit.slice(0, 12)}.txt`,
    mimeType: "text/plain",
    size: data.length,
    dataUrl: `data:text/plain;base64,${data.toString("base64")}`
  };
}

export function createControlServer(options: ControlServerOptions): Server {
  const stateDir = resolve(options.stateDir);
  const roots = controlRoots(stateDir);
  const tasks = new TaskReadModel(roots.stateRoot, roots.workOrderRoot, roots.executionRoot);
  const providers = new ProviderReadModel(providerReceiptRoot(stateDir));
  const releases = new ReleaseReadModel(join(stateDir, "release"));
  const github = options.githubConnection ?? new GitHubConnectionService();
  const githubRepositories = options.githubRepositoryContext ?? new GitHubRepositoryContextService();
  const modelCatalog = options.chatModelCatalog ?? new ChatModelCatalogService({
    ...(options.chatEndpoint === undefined ? {} : { endpoint: options.chatEndpoint }),
    ...(options.chatApiKey === undefined ? {} : { apiKey: options.chatApiKey }),
    ...(options.chatApiKeyEnv === undefined ? {} : { apiKeyEnv: options.chatApiKeyEnv }),
    ...(options.chatFetchImpl === undefined ? {} : { fetchImpl: options.chatFetchImpl })
  });
  const webRoot = resolve(options.webRoot ?? resolve(process.cwd(), "web", "control"));
  const chat = new ChatService({
    stateDir,
    ...(options.chatEndpoint === undefined ? {} : { endpoint: options.chatEndpoint }),
    ...(options.chatApiKey === undefined ? {} : { apiKey: options.chatApiKey }),
    ...(options.chatApiKeyEnv === undefined ? {} : { apiKeyEnv: options.chatApiKeyEnv }),
    ...(options.chatDefaultModel === undefined ? {} : { defaultModel: options.chatDefaultModel }),
    ...(options.chatFetchImpl === undefined ? {} : { fetchImpl: options.chatFetchImpl })
  });

  const server = createServer(async (request, response) => {
    try {
      const url = parseUrl(request);
      const method = request.method ?? "GET";
      if (method !== "GET" && method !== "HEAD" && !(method === "POST" && isControlPost(url.pathname))) {
        response.setHeader("allow", "GET, HEAD");
        return sendJson(response, 405, { error: "METHOD_NOT_ALLOWED" });
      }

      if ((method === "GET" || method === "HEAD") && url.pathname === "/api/chat/models") {
        return sendJson(response, 200, await modelCatalog.list());
      }

      if (method === "GET" && url.pathname === "/api/chat/sessions") {
        const limitRaw = Number(url.searchParams.get("limit") ?? "50");
        const limit = Number.isInteger(limitRaw) && limitRaw > 0 && limitRaw <= 100 ? limitRaw : 50;
        return sendJson(response, 200, { sessions: await chat.listSessions(limit) });
      }

      if (method === "POST" && url.pathname === "/api/chat/sessions") {
        const payload = await readJsonBody(request);
        assertExactKeys(payload, ["model"]);
        if (payload.model !== undefined && typeof payload.model !== "string") throw new ChatServiceError("CHAT_MODEL_INVALID", 400);
        const session = await chat.createSession(typeof payload.model === "string" ? payload.model : undefined);
        return sendJson(response, 201, { sessionId: session.sessionId, model: session.model, createdAt: session.createdAt });
      }

      const chatMessageMatch = /^\/api\/chat\/sessions\/([0-9a-f-]+)\/messages$/i.exec(url.pathname);
      if (method === "POST" && chatMessageMatch?.[1]) {
        const sessionId = safeSessionId(chatMessageMatch[1]);
        const payload = await readJsonBody(request, 30 * 1024 * 1024);
        assertExactKeys(payload, ["message", "model", "attachments"]);
        if (typeof payload.message !== "string") throw new ChatServiceError("CHAT_MESSAGE_REQUIRED", 400);
        if (payload.model !== undefined && typeof payload.model !== "string") throw new ChatServiceError("CHAT_MODEL_INVALID", 400);
        if (payload.attachments !== undefined && !Array.isArray(payload.attachments)) throw new ChatServiceError("CHAT_ATTACHMENTS_INVALID", 400);
        const clientAttachments = payload.attachments ?? [];
        const repoContext = await githubRepositories.fromMessage(payload.message);
        if (repoContext && clientAttachments.length >= 5) throw new ChatServiceError("CHAT_REPOSITORY_CONTEXT_ATTACHMENT_LIMIT", 413);
        const attachments = repoContext
          ? [...clientAttachments, repositoryAttachment(repoContext.repository, repoContext.commit, repoContext.context)]
          : clientAttachments;
        return sendJson(response, 202, await chat.startMessage(
          sessionId,
          payload.message,
          typeof payload.model === "string" ? payload.model : undefined,
          attachments
        ));
      }

      const chatStopMatch = /^\/api\/chat\/sessions\/([0-9a-f-]+)\/stop$/i.exec(url.pathname);
      if (method === "POST" && chatStopMatch?.[1]) {
        const sessionId = safeSessionId(chatStopMatch[1]);
        const payload = await readJsonBody(request, 1024);
        assertExactKeys(payload, []);
        const session = await chat.getSession(sessionId);
        if (!session) return sendJson(response, 404, { error: "CHAT_SESSION_NOT_FOUND" });
        return sendJson(response, 200, { stopped: await chat.stop(sessionId) });
      }

      const chatSessionMatch = /^\/api\/chat\/sessions\/([0-9a-f-]+)$/i.exec(url.pathname);
      if ((method === "GET" || method === "HEAD") && chatSessionMatch?.[1]) {
        const sessionId = safeSessionId(chatSessionMatch[1]);
        const session = await chat.getSession(sessionId);
        return session ? sendJson(response, 200, session) : sendJson(response, 404, { error: "CHAT_SESSION_NOT_FOUND" });
      }

      const chatEventsMatch = /^\/api\/chat\/sessions\/([0-9a-f-]+)\/events$/i.exec(url.pathname);
      if (method === "GET" && chatEventsMatch?.[1]) {
        const sessionId = safeSessionId(chatEventsMatch[1]);
        const session = await chat.getSession(sessionId);
        if (!session) return sendJson(response, 404, { error: "CHAT_SESSION_NOT_FOUND" });
        response.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
          "x-accel-buffering": "no",
          "x-content-type-options": "nosniff"
        });
        response.write(": connected\n\n");
        const unsubscribe = chat.subscribe(sessionId, (event) => sseWrite(response, event));
        request.on("close", unsubscribe);
        return;
      }

      if ((method === "GET" || method === "HEAD") && url.pathname === "/api/integrations/github") {
        return sendJson(response, 200, await github.status(url.searchParams.get("refresh") === "1"));
      }

      if (method === "POST" && url.pathname === "/api/integrations/github/connect") {
        const payload = await readJsonBody(request, 1024);
        assertExactKeys(payload, ["approved"]);
        if (payload.approved !== true) throw new GitHubConnectionError("GITHUB_CONSENT_REQUIRED", 400);
        return sendJson(response, 200, await github.connect(true));
      }

      if (url.pathname === "/api/health") {
        return sendJson(response, 200, {
          ok: true,
          environment: options.environment ?? "LOCAL",
          region: options.region ?? "local",
          zone: options.zone ?? "local",
          operator: options.operator ?? "operator@koordynator.local",
          ciVerify: options.ciVerify ?? "UNKNOWN",
          version: options.version ?? "0.1.0"
        });
      }

      if (url.pathname === "/api/releases") return sendJson(response, 200, await releases.list());
      if (url.pathname === "/api/releases/current") return sendJson(response, 200, { currentProduction: (await releases.list()).currentProduction });
      const releaseMatch = /^\/api\/releases\/(sha256:[a-f0-9]{64})$/i.exec(url.pathname);
      if (releaseMatch?.[1]) {
        const sha = safeDigest(releaseMatch[1]);
        if (!sha) return sendJson(response, 400, { error: "INVALID_RELEASE_SHA" });
        const release = await releases.get(sha);
        return release ? sendJson(response, 200, release) : sendJson(response, 404, { error: "RELEASE_NOT_FOUND" });
      }

      if (url.pathname === "/api/providers") return sendJson(response, 200, await providers.view(url.searchParams.get("refresh") === "1"));
      const doctorMatch = /^\/api\/providers\/([A-Za-z0-9._-]+)\/doctor$/.exec(url.pathname);
      if (doctorMatch?.[1]) {
        const providerId = safeProviderId(doctorMatch[1]);
        if (!providerId) return sendJson(response, 400, { error: "INVALID_PROVIDER_ID" });
        const result = await providers.doctor(providerId, true);
        return result ? sendJson(response, 200, result) : sendJson(response, 404, { error: "PROVIDER_NOT_FOUND" });
      }
      if (url.pathname === "/api/provider-receipts") {
        const limitRaw = Number(url.searchParams.get("limit") ?? "50");
        const limit = Number.isInteger(limitRaw) && limitRaw > 0 && limitRaw <= 200 ? limitRaw : 50;
        return sendJson(response, 200, { receipts: await providers.receipts(limit) });
      }

      if (url.pathname === "/api/tasks") {
        const rawFilter = url.searchParams.get("status") ?? "all";
        if (!FILTERS.has(rawFilter as TaskFilter)) return sendJson(response, 400, { error: "INVALID_TASK_FILTER" });
        return sendJson(response, 200, await tasks.list({ filter: rawFilter as TaskFilter, query: url.searchParams.get("q") ?? "" }));
      }

      const returnMatch = /^\/api\/tasks\/(TASK-[A-Za-z0-9._-]+)\/return$/.exec(url.pathname);
      if (returnMatch?.[1]) {
        const taskId = safeTaskId(returnMatch[1]);
        if (!taskId) return sendJson(response, 400, { error: "INVALID_TASK_ID" });
        try {
          const returned = await tasks.targetedReturn(taskId);
          return returned ? sendJson(response, 200, returned) : sendJson(response, 404, { error: "TASK_NOT_FOUND" });
        } catch (error) {
          const message = error instanceof Error ? error.message : "TARGETED_RETURN_ERROR";
          return isClientInputError(message) ? sendJson(response, 409, { error: message }) : sendJson(response, 500, { error: "CONTROL_SERVER_ERROR", message });
        }
      }

      const nextOrderMatch = /^\/api\/tasks\/(TASK-[A-Za-z0-9._-]+)\/next-work-order$/.exec(url.pathname);
      if (nextOrderMatch?.[1]) {
        const taskId = safeTaskId(nextOrderMatch[1]);
        if (!taskId) return sendJson(response, 400, { error: "INVALID_TASK_ID" });
        try {
          const draft = await tasks.nextWorkOrderDraft(taskId, url.searchParams.get("policyFp") ?? undefined);
          return sendJson(response, 200, { draft, safeToSign: true, persisted: false });
        } catch (error) {
          const message = error instanceof Error ? error.message : "NEXT_WORK_ORDER_ERROR";
          if (message === "TASK_NOT_FOUND") return sendJson(response, 404, { error: message });
          return isClientInputError(message) ? sendJson(response, 400, { error: message }) : sendJson(response, 500, { error: "CONTROL_SERVER_ERROR", message });
        }
      }

      const detailMatch = /^\/api\/tasks\/(TASK-[A-Za-z0-9._-]+)\/detail$/.exec(url.pathname);
      if (detailMatch?.[1]) {
        const taskId = safeTaskId(detailMatch[1]);
        if (!taskId) return sendJson(response, 400, { error: "INVALID_TASK_ID" });
        const detail = await tasks.detail(taskId);
        return detail ? sendJson(response, 200, detail) : sendJson(response, 404, { error: "TASK_NOT_FOUND" });
      }

      const match = /^\/api\/tasks\/(TASK-[A-Za-z0-9._-]+)$/.exec(url.pathname);
      if (match?.[1]) {
        const taskId = safeTaskId(match[1]);
        if (!taskId) return sendJson(response, 400, { error: "INVALID_TASK_ID" });
        const task = await tasks.get(taskId);
        return task ? sendJson(response, 200, task) : sendJson(response, 404, { error: "TASK_NOT_FOUND" });
      }

      const taskPage = /^\/tasks\/(TASK-[A-Za-z0-9._-]+)$/.exec(url.pathname);
      const returnPage = /^\/tasks\/(TASK-[A-Za-z0-9._-]+)\/return$/.exec(url.pathname);
      const staticFiles: Record<string, { name: string; type: string }> = {
        "/": { name: "index.html", type: "text/html; charset=utf-8" },
        "/index.html": { name: "index.html", type: "text/html; charset=utf-8" },
        "/chat": { name: "chat.html", type: "text/html; charset=utf-8" },
        "/providers": { name: "providers.html", type: "text/html; charset=utf-8" },
        "/releases": { name: "releases.html", type: "text/html; charset=utf-8" },
        "/styles.css": { name: "styles.css", type: "text/css; charset=utf-8" },
        "/control-ui.css": { name: "control-ui.css", type: "text/css; charset=utf-8" },
        "/chat.css": { name: "chat.css", type: "text/css; charset=utf-8" },
        "/app.js": { name: "app.js", type: "text/javascript; charset=utf-8" },
        "/chat.js": { name: "chat.js", type: "text/javascript; charset=utf-8" },
        "/chat-history.js": { name: "chat-history.js", type: "text/javascript; charset=utf-8" },
        "/chat-github.js": { name: "chat-github.js", type: "text/javascript; charset=utf-8" },
        "/chat-models.js": { name: "chat-models.js", type: "text/javascript; charset=utf-8" },
        "/task.css": { name: "task.css", type: "text/css; charset=utf-8" },
        "/task.js": { name: "task.js", type: "text/javascript; charset=utf-8" },
        "/return.css": { name: "return.css", type: "text/css; charset=utf-8" },
        "/return.js": { name: "return.js", type: "text/javascript; charset=utf-8" },
        "/providers.css": { name: "providers.css", type: "text/css; charset=utf-8" },
        "/providers.js": { name: "providers.js", type: "text/javascript; charset=utf-8" },
        "/releases.css": { name: "releases.css", type: "text/css; charset=utf-8" },
        "/releases.js": { name: "releases.js", type: "text/javascript; charset=utf-8" }
      };
      const asset = returnPage ? { name: "return.html", type: "text/html; charset=utf-8" } : taskPage ? { name: "task.html", type: "text/html; charset=utf-8" } : staticFiles[url.pathname];
      if (!asset) return sendJson(response, 404, { error: "NOT_FOUND" });
      const body = await readFile(resolve(webRoot, asset.name), "utf8");
      if (method === "HEAD") {
        response.writeHead(200, { "content-type": asset.type, "content-length": Buffer.byteLength(body) });
        return response.end();
      }
      return sendText(response, 200, asset.type, body);
    } catch (error) {
      if (error instanceof ChatServiceError || error instanceof GitHubConnectionError || error instanceof ChatModelCatalogError || error instanceof GitHubRepositoryContextError) {
        return sendJson(response, error.status, { error: error.code });
      }
      const message = error instanceof Error ? error.message : "CONTROL_SERVER_ERROR";
      return sendJson(response, 500, { error: "CONTROL_SERVER_ERROR", message });
    }
  });

  server.on("close", () => chat.close());
  return server;
}
