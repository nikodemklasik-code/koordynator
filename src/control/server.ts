import { createRepositoryExecutor } from "./hermes-repository-runner.js";
import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Digest, TaskId } from "../domain/ids.js";
import { TaskReadModel, controlRoots, type TaskFilter } from "./task-read-model.js";
import { ProviderReadModel, providerReceiptRoot } from "./provider-read-model.js";
import { ReleaseReadModel } from "./release-read-model.js";
import { ChatService, ChatServiceError, type ChatEvent } from "./chat-service.js";
import { loadChatProjectContext } from "./chat-project-context.js";
import { GitHubConnectionError, GitHubConnectionService, type GitHubConnectionPort } from "./github-connection-service.js";
import { ChatModelCatalogError, ChatModelCatalogService, type ChatModelCatalogPort } from "./chat-model-catalog.js";
import { GitHubRepositoryContextError, GitHubRepositoryContextService, type GitHubRepositoryContextPort } from "./github-repository-context.js";
import { WorkspaceRepositoryContextService, type WorkspaceRepositoryContextPort } from "./workspace-repository-context.js";
import { chatBillingErrorCode, evaluateChatBilling, type ChatBillingPolicyOptions } from "./chat-billing-policy.js";
import { OmniRouteLiveStatusService } from "./omniroute-live-status.js";
import { ProjectPackService } from "./project-pack-service.js";
import { HermesGrantError, HermesGrantStore } from "./hermes-grant-store.js";
import { RepositoryRegistry, RepositoryRegistryError } from "./repository-registry.js";
import { MaterialisationError, MaterialisationService } from "./materialisation-service.js";
import { TaskExecutionRunner, TaskExecutionError, type IndependentVerifier as TaskRunnerVerifier } from "./task-execution-runner.js";
import { parseAgreedPlan } from "./chat-consensus.js";
import { BrainError } from "./brain-roadmap.js";
import { HarmoniaError } from "./harmonia-cognition.js";
import { asStageZeroHttpError, StageZeroService } from "./stage-zero-service.js";
import { HermesPtyError, HermesPtySession, type HermesLaunchSpec, type HermesPtyHooks } from "./hermes-pty.js";
import { prepareHermes } from "../runtime/hermes-launch.js";
import { omniRouteSettings } from "../runtime/local-config.js";
import { VERSION } from "../version.js";

export type ControlServerOptions = {
  stateDir: string;
  webRoot?: string;
  projectRoot?: string;
  environment?: string;
  region?: string;
  zone?: string;
  operator?: string;
  ciVerify?: "PASS" | "FAIL" | "UNKNOWN";
  version?: string;
  controlToken?: string;
  chatAllowGithubContext?: boolean;
  chatAllowWorkspaceContext?: boolean;
  chatAllowRepositoryExecution?: boolean;
  chatHermesSkillsEveryTurn?: boolean;
  chatEndpoint?: string;
  chatApiKey?: string;
  chatApiKeyEnv?: string;
  chatDefaultModel?: string;
  /** Pin modelu Harmonii (Etap 0). Pusty / brak = model sesji. */
  chatHarmoniaModel?: string;
  chatFallbackModels?: string[];
  chatFetchImpl?: typeof fetch;
  chatBillingPolicy?: ChatBillingPolicyOptions;
  githubConnection?: GitHubConnectionPort;
  githubRepositoryContext?: GitHubRepositoryContextPort;
  workspaceRepositoryContext?: WorkspaceRepositoryContextPort;
  chatModelCatalog?: ChatModelCatalogPort;
  omniRouteLive?: OmniRouteLiveStatusService;
  projectPack?: ProjectPackService;
  /** PKCS#8 PEM. When absent, chat→Tasks materialisation is disabled (503). */
  materialisationPrivateKeyPem?: string;
  materialisationKeyId?: string;
  /** Injected in tests. Production uses macOS `script` PTY + prepareHermes. */
  hermesPty?: HermesPtyHooks;
  /** Test hook: PATH prefix so a fixture worker binary (opencode) is found first. */
  taskRunnerPathPrefix?: string;
  /** Test hook: replace the independent verifier (production runs vitest). */
  taskRunnerVerifier?: TaskRunnerVerifier;
};

export class ControlAuthError extends Error {
  readonly code = "CONTROL_UNAUTHORIZED";
  readonly status = 401;
  constructor() {
    super("CONTROL_UNAUTHORIZED");
    this.name = "ControlAuthError";
  }
}

const FILTERS = new Set<TaskFilter>(["all", "building", "frozen", "validating", "awaiting-approval", "released", "returned"]);
const CHAT_SESSION_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CHAT_MODEL_RE = /^[A-Za-z0-9._:/-]{1,160}$/;
const SSE_HEARTBEAT_MS = 15_000;
const CHAT_MESSAGE_MAX_BYTES = 21 * 1024 * 1024;

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

function safeChatModel(value: string): string {
  const model = value.trim();
  if (!CHAT_MODEL_RE.test(model)) throw new ChatServiceError("CHAT_MODEL_INVALID", 400);
  if (model.toLowerCase().includes("deepseek")) throw new ChatServiceError("CHAT_MODEL_FORBIDDEN", 400);
  return model;
}

function isControlPost(pathname: string): boolean {
  return pathname === "/api/chat/sessions" ||
    pathname === "/api/integrations/github/connect" ||
    pathname === "/api/integrations/hermes-grants" ||
    pathname === "/api/tasks/project-pack" ||
    pathname === "/api/repositories" ||
    pathname === "/api/repositories/remove" ||
    pathname === "/api/tasks/materialise" ||
    pathname === "/api/tasks/materialise-plan" ||
    /^\/api\/tasks\/TASK-[A-Za-z0-9._-]+\/run$/.test(pathname) ||
    /^\/api\/providers\/[A-Za-z0-9._-]+\/connect$/i.test(pathname) ||
    /^\/api\/chat\/sessions\/[0-9a-f-]+\/messages$/i.test(pathname) ||
    /^\/api\/chat\/sessions\/[0-9a-f-]+\/stop$/i.test(pathname) ||
    /^\/api\/chat\/sessions\/[0-9a-f-]+\/stage-zero$/i.test(pathname) ||
    pathname === "/api/hermes/pty" ||
    /^\/api\/hermes\/pty\/[0-9a-f-]+\/(?:input|resize|stop)$/i.test(pathname);
}

function presentedControlToken(request: IncomingMessage): string {
  const header = String(request.headers["x-control-token"] ?? "").trim();
  if (header) return header;
  const authorization = String(request.headers.authorization ?? "");
  const match = /^Bearer\s+(\S+)$/i.exec(authorization);
  return match?.[1] ?? "";
}

function tokensEqual(expected: string, presented: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(presented);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function assertControlAuth(request: IncomingMessage, token: string | undefined, pathname: string): void {
  if (!token) return;
  if (pathname === "/api/health") return;
  if (!tokensEqual(token, presentedControlToken(request))) throw new ControlAuthError();
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
    name: `Repo-${safeRepo}-${commit.slice(0, 12)}.txt`,
    mimeType: "text/plain",
    size: data.length,
    dataUrl: `data:text/plain;base64,${data.toString("base64")}`
  };
}

function wantsGithubContext(options: ControlServerOptions): boolean {
  return options.chatAllowGithubContext === true;
}

function wantsWorkspaceContext(options: ControlServerOptions): boolean {
  return options.chatAllowWorkspaceContext !== false;
}

export function createControlServer(options: ControlServerOptions): Server {
  const stateDir = resolve(options.stateDir);
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const roots = controlRoots(stateDir);
  const tasks = new TaskReadModel(roots.stateRoot, roots.workOrderRoot, roots.executionRoot);
  const providers = new ProviderReadModel(providerReceiptRoot(stateDir));
  const releases = new ReleaseReadModel(join(stateDir, "release"));
  const github = options.githubConnection ?? new GitHubConnectionService();
  const githubRepositories = options.githubRepositoryContext ?? new GitHubRepositoryContextService();
  const workspaceRepositories = options.workspaceRepositoryContext ?? new WorkspaceRepositoryContextService(projectRoot);
  const omniLive = options.omniRouteLive ?? new OmniRouteLiveStatusService({
    ...(options.chatEndpoint === undefined ? {} : { endpoint: options.chatEndpoint }),
    ...(options.chatApiKey === undefined ? {} : { apiKey: options.chatApiKey }),
    ...(options.chatApiKeyEnv === undefined ? {} : { apiKeyEnv: options.chatApiKeyEnv }),
    ...(options.chatFetchImpl === undefined ? {} : { fetchImpl: options.chatFetchImpl })
  });
  const projectPacks = options.projectPack ?? new ProjectPackService(stateDir);
  const repositories = new RepositoryRegistry(stateDir);
  const materialisation = options.materialisationPrivateKeyPem
    ? new MaterialisationService(options.materialisationPrivateKeyPem, options.materialisationKeyId ?? "control-plane", stateDir)
    : null;
  // The code role's real hand: chat→Tasks materialises a WorkOrder, /run drives the worker.
  const taskRunner = new TaskExecutionRunner({
    stateDir,
    projectRoot,
    role: "code",
    requireWrite: true,
    ...(options.taskRunnerPathPrefix === undefined ? {} : { workerPathPrefix: options.taskRunnerPathPrefix }),
    ...(options.taskRunnerVerifier === undefined ? {} : { verifier: options.taskRunnerVerifier })
  });
  const hermesGrants = new HermesGrantStore(stateDir);
  const modelCatalog = options.chatModelCatalog ?? new ChatModelCatalogService({
    ...(options.chatEndpoint === undefined ? {} : { endpoint: options.chatEndpoint }),
    ...(options.chatApiKey === undefined ? {} : { apiKey: options.chatApiKey }),
    ...(options.chatApiKeyEnv === undefined ? {} : { apiKeyEnv: options.chatApiKeyEnv }),
    ...(options.chatFetchImpl === undefined ? {} : { fetchImpl: options.chatFetchImpl })
  });
  const webRoot = resolve(options.webRoot ?? resolve(process.cwd(), "web", "control"));
  const chat = new ChatService({
    stateDir,
    ...(options.chatAllowRepositoryExecution ? { repositoryExecutor: createRepositoryExecutor(stateDir) } : {}),
    ...(materialisation ? { materialiser: (consensus) => materialisation.materialise(consensus) } : {}),
    ...(options.chatEndpoint === undefined ? {} : { endpoint: options.chatEndpoint }),
    ...(options.chatApiKey === undefined ? {} : { apiKey: options.chatApiKey }),
    ...(options.chatApiKeyEnv === undefined ? {} : { apiKeyEnv: options.chatApiKeyEnv }),
    ...(options.chatDefaultModel === undefined ? {} : { defaultModel: options.chatDefaultModel }),
    ...(options.chatFallbackModels === undefined ? {} : { fallbackModels: options.chatFallbackModels }),
    ...(options.chatHermesSkillsEveryTurn === undefined ? {} : { hermesSkillsEveryTurn: options.chatHermesSkillsEveryTurn }),
    ...(options.chatFetchImpl === undefined ? {} : { fetchImpl: options.chatFetchImpl }),
    projectContextProvider: () => loadChatProjectContext(projectRoot)
  });
  const stageZero = new StageZeroService({
    stateDir,
    chat,
    ...(options.chatEndpoint === undefined ? {} : { endpoint: options.chatEndpoint }),
    ...(options.chatApiKey === undefined ? {} : { apiKey: options.chatApiKey }),
    ...(options.chatApiKeyEnv === undefined ? {} : { apiKeyEnv: options.chatApiKeyEnv }),
    ...(options.chatFetchImpl === undefined ? {} : { fetchImpl: options.chatFetchImpl }),
    ...(options.chatHarmoniaModel === undefined ? {} : { harmoniaModel: options.chatHarmoniaModel })
  });
  const hermesPty = new HermesPtySession({
    stateDir,
    ...(options.hermesPty?.spawn === undefined ? {} : { spawn: options.hermesPty.spawn }),
    prepare: options.hermesPty?.prepare ?? (async (): Promise<HermesLaunchSpec> => {
      const settings = omniRouteSettings();
      const launch = await prepareHermes({
        endpoint: options.chatEndpoint ?? settings.endpoint,
        apiKey: options.chatApiKey ?? settings.apiKey,
        model: options.chatDefaultModel ?? settings.model
      }, projectRoot);
      return { command: launch.command, args: launch.args, cwd: launch.cwd, env: launch.env, close: launch.close };
    })
  });

  const server = createServer(async (request, response) => {
    try {
      const url = parseUrl(request);
      const method = request.method ?? "GET";
      assertControlAuth(request, options.controlToken, url.pathname);
      if (method !== "GET" && method !== "HEAD" && !(method === "POST" && isControlPost(url.pathname))) {
        response.setHeader("allow", "GET, HEAD");
        return sendJson(response, 405, { error: "METHOD_NOT_ALLOWED" });
      }

      if ((method === "GET" || method === "HEAD") && url.pathname === "/api/chat/models") {
        return sendJson(response, 200, await modelCatalog.list());
      }

      if (method === "GET" && url.pathname === "/api/chat/usage") {
        const hoursRaw = Number(url.searchParams.get("hours") ?? "24");
        const hours = Number.isFinite(hoursRaw) ? Math.min(Math.max(hoursRaw, 1), 24 * 365) : 24;
        return sendJson(response, 200, await chat.usageSummary(hours));
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
        const session = await chat.createSession(typeof payload.model === "string" ? safeChatModel(payload.model) : undefined);
        return sendJson(response, 201, { sessionId: session.sessionId, model: session.model, createdAt: session.createdAt });
      }

      const chatMessageMatch = /^\/api\/chat\/sessions\/([0-9a-f-]+)\/messages$/i.exec(url.pathname);
      if (method === "POST" && chatMessageMatch?.[1]) {
        const sessionId = safeSessionId(chatMessageMatch[1]);
        const payload = await readJsonBody(request, CHAT_MESSAGE_MAX_BYTES);
        assertExactKeys(payload, ["message", "model", "attachments"]);
        if (typeof payload.message !== "string") throw new ChatServiceError("CHAT_MESSAGE_REQUIRED", 400);
        if (payload.model !== undefined && typeof payload.model !== "string") throw new ChatServiceError("CHAT_MODEL_INVALID", 400);
        if (payload.attachments !== undefined && !Array.isArray(payload.attachments)) throw new ChatServiceError("CHAT_ATTACHMENTS_INVALID", 400);

        const session = await chat.getSession(sessionId);
        if (!session) throw new ChatServiceError("CHAT_SESSION_NOT_FOUND", 404);
        const model = typeof payload.model === "string" ? safeChatModel(payload.model) : session.model;
        const catalog = await modelCatalog.list();
        const billing = evaluateChatBilling(model, catalog, options.chatBillingPolicy);
        const billingError = chatBillingErrorCode(billing);
        if (billingError) throw new ChatServiceError(billingError, 403);

        const clientAttachments = payload.attachments ?? [];
        const isRepoTask = /^\s*\/repo(?:\s|$)/.test(payload.message);
        let repoContext = !isRepoTask && wantsGithubContext(options) ? await githubRepositories.fromMessage(payload.message) : null;
        if (!repoContext && !isRepoTask && wantsWorkspaceContext(options)) {
          repoContext = await workspaceRepositories.fromMessage(payload.message);
        }
        if (repoContext && clientAttachments.length >= 5) throw new ChatServiceError("CHAT_REPOSITORY_CONTEXT_ATTACHMENT_LIMIT", 413);
        const attachments = repoContext
          ? [...clientAttachments, repositoryAttachment(repoContext.repository, repoContext.commit, repoContext.context)]
          : clientAttachments;
        return sendJson(response, 202, await chat.startMessage(
          sessionId,
          payload.message,
          model,
          attachments,
          billing
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

      const stageZeroMatch = /^\/api\/chat\/sessions\/([0-9a-f-]+)\/stage-zero$/i.exec(url.pathname);
      if (stageZeroMatch?.[1] && (method === "POST" || method === "GET" || method === "HEAD")) {
        const sessionId = safeSessionId(stageZeroMatch[1]);
        if (method === "POST") {
          const payload = await readJsonBody(request, 1024);
          assertExactKeys(payload, []);
          return sendJson(response, 200, await stageZero.run(sessionId));
        }
        const run = await stageZero.get(sessionId);
        return run ? sendJson(response, 200, run) : sendJson(response, 404, { error: "STAGE_ZERO_NOT_RUN" });
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
        const heartbeat = setInterval(() => {
          if (response.destroyed || response.writableEnded) return;
          response.write(": heartbeat\n\n");
        }, SSE_HEARTBEAT_MS);
        heartbeat.unref();
        request.on("close", () => {
          clearInterval(heartbeat);
          unsubscribe();
        });
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

      if ((method === "GET" || method === "HEAD") && url.pathname === "/api/integrations/hermes-grants") {
        return sendJson(response, 200, await hermesGrants.status());
      }
      if (method === "POST" && url.pathname === "/api/integrations/hermes-grants") {
        const payload = await readJsonBody(request, 1024);
        assertExactKeys(payload, ["grant", "approved"]);
        if (payload.grant !== "terminal") throw new HermesGrantError("HERMES_GRANT_UNKNOWN", 400);
        if (payload.approved !== true) throw new HermesGrantError("HERMES_GRANT_CONSENT_REQUIRED", 400);
        return sendJson(response, 200, await hermesGrants.grant("terminal", true));
      }

      if ((method === "GET" || method === "HEAD") && url.pathname === "/api/hermes/pty") {
        return sendJson(response, 200, hermesPty.status());
      }
      if (method === "POST" && url.pathname === "/api/hermes/pty") {
        const payload = await readJsonBody(request, 1024);
        assertExactKeys(payload, ["cols", "rows"]);
        return sendJson(response, 201, await hermesPty.start(payload));
      }
      const hermesPtyMatch = /^\/api\/hermes\/pty\/([0-9a-f-]+)\/(events|input|resize|stop)$/i.exec(url.pathname);
      if (hermesPtyMatch?.[1] && hermesPtyMatch[2]) {
        const sessionId = hermesPty.assertSession(hermesPtyMatch[1]);
        const action = hermesPtyMatch[2].toLowerCase();
        if (method === "GET" && action === "events") {
          response.writeHead(200, {
            "content-type": "text/event-stream; charset=utf-8",
            "cache-control": "no-cache, no-transform",
            connection: "keep-alive",
            "x-accel-buffering": "no",
            "x-content-type-options": "nosniff"
          });
          response.write(": connected\n\n");
          const unsubscribe = hermesPty.subscribe(sessionId, (event) => {
            if (response.destroyed || response.writableEnded) return;
            response.write(`data: ${JSON.stringify(event)}\n\n`);
          });
          const heartbeat = setInterval(() => {
            if (response.destroyed || response.writableEnded) return;
            response.write(": heartbeat\n\n");
          }, SSE_HEARTBEAT_MS);
          heartbeat.unref();
          request.on("close", () => {
            clearInterval(heartbeat);
            unsubscribe();
          });
          return;
        }
        if (method !== "POST") {
          response.setHeader("allow", "GET, POST");
          return sendJson(response, 405, { error: "METHOD_NOT_ALLOWED" });
        }
        if (action === "input") {
          const payload = await readJsonBody(request, 16 * 1024);
          assertExactKeys(payload, ["data"]);
          if (typeof payload.data !== "string") throw new HermesPtyError("HERMES_PTY_INPUT_INVALID", 400);
          hermesPty.write(sessionId, payload.data);
          return sendJson(response, 200, { ok: true });
        }
        if (action === "resize") {
          const payload = await readJsonBody(request, 1024);
          assertExactKeys(payload, ["cols", "rows"]);
          return sendJson(response, 200, hermesPty.resize(sessionId, payload.cols, payload.rows));
        }
        if (action === "stop") {
          const payload = await readJsonBody(request, 1024);
          assertExactKeys(payload, []);
          return sendJson(response, 200, hermesPty.stop(sessionId));
        }
      }

      if (url.pathname === "/api/health") {
        return sendJson(response, 200, {
          ok: true,
          environment: options.environment ?? "LOCAL",
          region: options.region ?? "local",
          zone: options.zone ?? "local",
          operator: options.operator ?? "operator@koordynator.local",
          ciVerify: options.ciVerify ?? "UNKNOWN",
          version: options.version ?? VERSION,
          chatDefaultModel: options.chatDefaultModel ?? null,
          chatFallbackModels: options.chatFallbackModels ?? [],
          liveChatBillingPolicy: "STRICT_PROVENANCE",
          paidApiAllowedByDefault: options.chatBillingPolicy?.allowPaidApi === true,
          unknownBillingAllowedByDefault: options.chatBillingPolicy?.allowUnknown === true,
          unconfirmedFreeAllowedByDefault: options.chatBillingPolicy?.allowFreeRequested === true
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

      if (url.pathname === "/api/providers") {
        const force = url.searchParams.get("refresh") === "1";
        const omniRoutes = await omniLive.list(force);
        return sendJson(response, 200, await providers.view(force, omniRoutes));
      }
      const doctorMatch = /^\/api\/providers\/([A-Za-z0-9._-]+)\/doctor$/.exec(url.pathname);
      if (doctorMatch?.[1]) {
        const providerId = safeProviderId(doctorMatch[1]);
        if (!providerId) return sendJson(response, 400, { error: "INVALID_PROVIDER_ID" });
        if (providerId.startsWith("omni-")) {
          const result = await omniLive.doctor(providerId, method !== "HEAD");
          return result ? sendJson(response, 200, result) : sendJson(response, 404, { error: "PROVIDER_NOT_FOUND" });
        }
        const result = await providers.doctor(providerId, method !== "HEAD");
        return result ? sendJson(response, 200, result) : sendJson(response, 404, { error: "PROVIDER_NOT_FOUND" });
      }
      const connectMatch = /^\/api\/providers\/([A-Za-z0-9._-]+)\/connect$/.exec(url.pathname);
      if (method === "POST" && connectMatch?.[1]) {
        const providerId = safeProviderId(connectMatch[1]);
        if (!providerId) return sendJson(response, 400, { error: "INVALID_PROVIDER_ID" });
        const payload = await readJsonBody(request, 1024);
        assertExactKeys(payload, ["approved"]);
        if (payload.approved !== true) return sendJson(response, 400, { error: "PROVIDER_CONSENT_REQUIRED" });
        if (providerId.startsWith("omni-")) {
          return sendJson(response, 200, await omniLive.connect(providerId));
        }
        const summary = await providers.doctor(providerId, true);
        if (!summary) return sendJson(response, 404, { error: "PROVIDER_NOT_FOUND" });
        return sendJson(response, 200, {
          ok: true,
          action: "COPY",
          command: summary.connectCommand,
          status: summary
        });
      }
      if (url.pathname === "/api/provider-receipts") {
        const limitRaw = Number(url.searchParams.get("limit") ?? "50");
        const limit = Number.isInteger(limitRaw) && limitRaw > 0 && limitRaw <= 200 ? limitRaw : 50;
        return sendJson(response, 200, { receipts: await providers.receipts(limit) });
      }

      if (method === "POST" && url.pathname === "/api/tasks/project-pack") {
        const payload = await readJsonBody(request, CHAT_MESSAGE_MAX_BYTES);
        assertExactKeys(payload, ["files"]);
        if (!Array.isArray(payload.files)) return sendJson(response, 400, { error: "PROJECT_PACK_INVALID" });
        try {
          return sendJson(response, 200, await projectPacks.ingest(payload.files as any));
        } catch (error) {
          const code = (error as { code?: string }).code || "PROJECT_PACK_ERROR";
          const status = Number((error as { status?: number }).status) || 500;
          return sendJson(response, status, { error: code });
        }
      }

      if (url.pathname === "/api/repositories" && (method === "GET" || method === "HEAD")) {
        return sendJson(response, 200, { repositories: await repositories.list() });
      }

      if (method === "POST" && url.pathname === "/api/repositories") {
        const payload = await readJsonBody(request, 8 * 1024);
        assertExactKeys(payload, ["repository", "defaultBranch", "notes"]);
        if (typeof payload.repository !== "string") throw new RepositoryRegistryError("REPOSITORY_INVALID", 400);
        const registered = await repositories.register({
          repository: payload.repository,
          ...(payload.defaultBranch === undefined ? {} : { defaultBranch: payload.defaultBranch as string }),
          ...(payload.notes === undefined ? {} : { notes: payload.notes as string })
        });
        return sendJson(response, 201, { repository: registered, repositories: await repositories.list() });
      }

      if (method === "POST" && url.pathname === "/api/repositories/remove") {
        const payload = await readJsonBody(request, 8 * 1024);
        assertExactKeys(payload, ["repository"]);
        if (typeof payload.repository !== "string") throw new RepositoryRegistryError("REPOSITORY_INVALID", 400);
        return sendJson(response, 200, { repositories: await repositories.remove(payload.repository) });
      }

      if (method === "POST" && url.pathname === "/api/tasks/materialise") {
        const payload = await readJsonBody(request, 64 * 1024);
        assertExactKeys(payload, ["objective", "modules", "allowedPaths", "acceptanceCriteria"]);
        if (!materialisation) return sendJson(response, 503, { error: "MATERIALISATION_SIGNING_KEY_UNAVAILABLE" });
        const result = await materialisation.materialise({
          objective: payload.objective as string,
          modules: payload.modules as string[],
          allowedPaths: payload.allowedPaths as string[],
          acceptanceCriteria: payload.acceptanceCriteria as string[]
        });
        return sendJson(response, 201, result);
      }

      if (method === "POST" && url.pathname === "/api/tasks/materialise-plan") {
        const payload = await readJsonBody(request, 64 * 1024);
        assertExactKeys(payload, ["plan"]);
        if (!materialisation) return sendJson(response, 503, { error: "MATERIALISATION_SIGNING_KEY_UNAVAILABLE" });
        if (typeof payload.plan !== "string") return sendJson(response, 400, { error: "MATERIALISATION_PLAN_INCOMPLETE" });
        // Clicking the button IS the explicit request, so no agreed-phrase check here — but the
        // plan itself must still be concrete enough to become a signed contract.
        const parsed = parseAgreedPlan(payload.plan);
        if (!parsed) return sendJson(response, 400, { error: "MATERIALISATION_PLAN_INCOMPLETE" });
        return sendJson(response, 201, await materialisation.materialise(parsed));
      }

      if (url.pathname === "/api/tasks") {
        const rawFilter = url.searchParams.get("status") ?? "all";
        if (!FILTERS.has(rawFilter as TaskFilter)) return sendJson(response, 400, { error: "INVALID_TASK_FILTER" });
        return sendJson(response, 200, await tasks.list({ filter: rawFilter as TaskFilter, query: url.searchParams.get("q") ?? "" }));
      }

      const runMatch = /^\/api\/tasks\/(TASK-[A-Za-z0-9._-]+)\/run$/.exec(url.pathname);
      if (method === "POST" && runMatch?.[1]) {
        const taskId = safeTaskId(runMatch[1]);
        if (!taskId) return sendJson(response, 400, { error: "INVALID_TASK_ID" });
        try {
          const receipt = await taskRunner.run(taskId);
          return sendJson(response, 200, receipt);
        } catch (error) {
          if (error instanceof TaskExecutionError) {
            return sendJson(response, error.status, { error: error.message });
          }
          const message = error instanceof Error ? error.message : "TASK_RUN_ERROR";
          return sendJson(response, 500, { error: message });
        }
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
          return isClientInputError(message) ? sendJson(response, 409, { error: message }) : sendJson(response, 500, { error: "CONTROL_SERVER_ERROR" });
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
          return isClientInputError(message) ? sendJson(response, 400, { error: message }) : sendJson(response, 500, { error: "CONTROL_SERVER_ERROR" });
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
        "/xterm.js": { name: "vendor/xterm.js", type: "text/javascript; charset=utf-8" },
        "/xterm.css": { name: "vendor/xterm.css", type: "text/css; charset=utf-8" },
        "/xterm-addon-fit.js": { name: "vendor/xterm-addon-fit.js", type: "text/javascript; charset=utf-8" },
        "/styles.css": { name: "styles.css", type: "text/css; charset=utf-8" },
        "/control-ui.css": { name: "control-ui.css", type: "text/css; charset=utf-8" },
        "/chat.css": { name: "chat.css", type: "text/css; charset=utf-8" },
        "/chat-usage.css": { name: "chat-usage.css", type: "text/css; charset=utf-8" },
        "/app.js": { name: "app.js", type: "text/javascript; charset=utf-8" },
        "/chat.js": { name: "chat.js", type: "text/javascript; charset=utf-8" },
        "/chat-history.js": { name: "chat-history.js", type: "text/javascript; charset=utf-8" },
        "/chat-github.js": { name: "chat-github.js", type: "text/javascript; charset=utf-8" },
        "/chat-models.js": { name: "chat-models.js", type: "text/javascript; charset=utf-8" },
        "/chat-usage.js": { name: "chat-usage.js", type: "text/javascript; charset=utf-8" },
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
      if (error instanceof ControlAuthError) {
        return sendJson(response, error.status, { error: error.code });
      }
      const stageZeroHttp = asStageZeroHttpError(error);
      if (stageZeroHttp) return sendJson(response, stageZeroHttp.status, { error: stageZeroHttp.code });
      if (error instanceof ChatServiceError || error instanceof GitHubConnectionError || error instanceof ChatModelCatalogError || error instanceof GitHubRepositoryContextError || error instanceof HermesGrantError || error instanceof RepositoryRegistryError || error instanceof MaterialisationError || error instanceof HarmoniaError || error instanceof BrainError || error instanceof HermesPtyError) {
        return sendJson(response, error.status, { error: error.code });
      }
      return sendJson(response, 500, { error: "CONTROL_SERVER_ERROR" });
    }
  });

  server.on("close", () => {
    chat.close();
    hermesPty.stop();
  });
  return server;
}
