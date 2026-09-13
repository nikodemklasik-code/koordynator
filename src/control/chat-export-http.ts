import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { ChatContextSelectionError } from "./chat-context-selection.js";
import { ChatExportError, ChatExportService, parseChatExportRequest } from "./chat-export-service.js";

const SESSION_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
  response.end(JSON.stringify(payload));
}

function presentedControlToken(request: IncomingMessage): string {
  const header = String(request.headers["x-control-token"] ?? "").trim();
  if (header) return header;
  const authorization = String(request.headers.authorization ?? "");
  return /^Bearer\s+(\S+)$/i.exec(authorization)?.[1] ?? "";
}

function tokenMatches(expected: string, presented: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(presented);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function readJson(request: IncomingMessage, maxBytes = 64 * 1024): Promise<Record<string, unknown>> {
  const type = String(request.headers["content-type"] ?? "").split(";", 1)[0]?.trim().toLowerCase();
  if (type !== "application/json") throw new ChatExportError("CHAT_EXPORT_CONTENT_TYPE_REQUIRED", 415);
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) throw new ChatExportError("CHAT_EXPORT_BODY_TOO_LARGE", 413);
    chunks.push(buffer);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new ChatExportError("CHAT_EXPORT_JSON_INVALID", 400);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ChatExportError("CHAT_EXPORT_JSON_OBJECT_REQUIRED", 400);
  }
  return parsed as Record<string, unknown>;
}

function exactKeys(payload: Record<string, unknown>, allowed: string[]): void {
  const keys = new Set(allowed);
  if (Object.keys(payload).some((key) => !keys.has(key))) throw new ChatExportError("CHAT_EXPORT_UNKNOWN_FIELD", 400);
}

export class ChatExportHttp {
  constructor(private readonly exports: ChatExportService, private readonly controlToken?: string) {}

  async handle(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const method = request.method ?? "GET";
    const sessionExport = /^\/api\/chat\/sessions\/([0-9a-f-]+)\/exports$/i.exec(url.pathname);
    const isExportRoute = url.pathname === "/api/chat/exports" || url.pathname === "/api/chat/exports/actions" || Boolean(sessionExport);
    if (!isExportRoute) return false;

    try {
      if (this.controlToken && !tokenMatches(this.controlToken, presentedControlToken(request))) {
        return sendJson(response, 401, { error: "CONTROL_UNAUTHORIZED" }), true;
      }

      if (url.pathname === "/api/chat/exports" && (method === "GET" || method === "HEAD")) {
        const requested = Number(url.searchParams.get("limit") ?? "500");
        const limit = Number.isInteger(requested) ? Math.min(Math.max(requested, 1), 1000) : 500;
        return sendJson(response, 200, { exports: await this.exports.listReceipts(limit) }), true;
      }

      if (url.pathname === "/api/chat/exports/actions" && method === "POST") {
        const payload = await readJson(request, 8 * 1024);
        exactKeys(payload, ["sessionId", "exportId", "fileId", "action"]);
        if (
          typeof payload.sessionId !== "string" || !SESSION_RE.test(payload.sessionId) ||
          typeof payload.exportId !== "string" ||
          typeof payload.fileId !== "string" ||
          (payload.action !== "open" && payload.action !== "reveal")
        ) {
          throw new ChatExportError("CHAT_EXPORT_ACTION_INVALID", 400);
        }
        return sendJson(response, 200, await this.exports.action(payload.sessionId, payload.exportId, payload.fileId, payload.action)), true;
      }

      if (sessionExport?.[1] && method === "POST") {
        if (!SESSION_RE.test(sessionExport[1])) throw new ChatExportError("CHAT_SESSION_INVALID", 400);
        const payload = await readJson(request);
        exactKeys(payload, ["responseIds", "attachmentIds", "output"]);
        const parsed = parseChatExportRequest(payload);
        return sendJson(response, 201, await this.exports.create(sessionExport[1], parsed)), true;
      }

      response.setHeader("allow", url.pathname === "/api/chat/exports" ? "GET, HEAD" : "POST");
      sendJson(response, 405, { error: "METHOD_NOT_ALLOWED" });
      return true;
    } catch (error) {
      if (error instanceof ChatExportError || error instanceof ChatContextSelectionError) {
        sendJson(response, error.status, { error: error.code });
        return true;
      }
      sendJson(response, 500, { error: "CHAT_EXPORT_ERROR" });
      return true;
    }
  }
}

export function installChatExportHttp(server: Server, exports: ChatExportService, controlToken?: string): ChatExportHttp {
  const http = new ChatExportHttp(exports, controlToken);
  const coreListeners = server.listeners("request");
  server.removeAllListeners("request");
  server.on("request", async (request: IncomingMessage, response: ServerResponse) => {
    if (await http.handle(request, response)) return;
    for (const listener of coreListeners) {
      await (listener as (request: IncomingMessage, response: ServerResponse) => unknown).call(server, request, response);
    }
  });
  return http;
}
