import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { TaskId } from "../domain/ids.js";
import { TaskReadModel, controlRoots, type TaskFilter } from "./task-read-model.js";

export type ControlServerOptions = {
  stateDir: string;
  webRoot?: string;
  environment?: string;
  region?: string;
  zone?: string;
  operator?: string;
  ciVerify?: "PASS" | "FAIL" | "UNKNOWN";
  version?: string;
};

const FILTERS = new Set<TaskFilter>(["all", "building", "frozen", "validating", "awaiting-approval", "released", "returned"]);

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
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

function safeTaskId(value: string): TaskId | null {
  return /^TASK-[A-Za-z0-9._-]+$/.test(value) ? value as TaskId : null;
}

function parseUrl(request: IncomingMessage): URL {
  return new URL(request.url ?? "/", "http://127.0.0.1");
}

export function createControlServer(options: ControlServerOptions): Server {
  const roots = controlRoots(resolve(options.stateDir));
  const tasks = new TaskReadModel(roots.stateRoot, roots.workOrderRoot);
  const webRoot = resolve(options.webRoot ?? resolve(process.cwd(), "web", "control"));

  return createServer(async (request, response) => {
    try {
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.setHeader("allow", "GET, HEAD");
        return sendJson(response, 405, { error: "METHOD_NOT_ALLOWED" });
      }

      const url = parseUrl(request);
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

      if (url.pathname === "/api/tasks") {
        const rawFilter = url.searchParams.get("status") ?? "all";
        if (!FILTERS.has(rawFilter as TaskFilter)) return sendJson(response, 400, { error: "INVALID_TASK_FILTER" });
        const result = await tasks.list({
          filter: rawFilter as TaskFilter,
          query: url.searchParams.get("q") ?? ""
        });
        return sendJson(response, 200, result);
      }

      const match = /^\/api\/tasks\/(TASK-[A-Za-z0-9._-]+)$/.exec(url.pathname);
      if (match?.[1]) {
        const taskId = safeTaskId(match[1]);
        if (!taskId) return sendJson(response, 400, { error: "INVALID_TASK_ID" });
        const task = await tasks.get(taskId);
        return task ? sendJson(response, 200, task) : sendJson(response, 404, { error: "TASK_NOT_FOUND" });
      }

      const staticFiles: Record<string, { name: string; type: string }> = {
        "/": { name: "index.html", type: "text/html; charset=utf-8" },
        "/index.html": { name: "index.html", type: "text/html; charset=utf-8" },
        "/styles.css": { name: "styles.css", type: "text/css; charset=utf-8" },
        "/app.js": { name: "app.js", type: "text/javascript; charset=utf-8" }
      };
      const asset = staticFiles[url.pathname];
      if (!asset) return sendJson(response, 404, { error: "NOT_FOUND" });
      const body = await readFile(resolve(webRoot, asset.name), "utf8");
      if (request.method === "HEAD") {
        response.writeHead(200, { "content-type": asset.type, "content-length": Buffer.byteLength(body) });
        return response.end();
      }
      return sendText(response, 200, asset.type, body);
    } catch (error) {
      const message = error instanceof Error ? error.message : "CONTROL_SERVER_ERROR";
      return sendJson(response, 500, { error: "CONTROL_SERVER_ERROR", message });
    }
  });
}
