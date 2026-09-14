import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { bearerTicket, verifyTaskTicket, type TicketAudience } from "./task-ticket.js";

export type TicketProxy = {
  url: string;
  close: () => Promise<void>;
};

export type TicketProxyOptions = {
  upstream: string;
  apiKey: string;
  secret: string;
  audience?: TicketAudience;
  fetchImpl?: typeof fetch;
  authorizeModel?: (model: string) => Promise<boolean>;
};

const HOP = new Set(["authorization", "host", "connection", "content-length", "transfer-encoding", "content-encoding"]);

function collect(request: IncomingMessage): Promise<Buffer> {
  return new Promise((accept, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 2 * 1024 * 1024) {
        reject(new Error("TICKET_PROXY_BODY_TOO_LARGE"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => accept(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function send(response: ServerResponse, status: number, code: string): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: code }));
}

export async function startTicketProxy(options: TicketProxyOptions): Promise<TicketProxy> {
  if (!options.apiKey.trim()) throw new Error("OMNIROUTE_API_KEY_REQUIRED");
  if (!options.secret.trim()) throw new Error("TICKET_SECRET_REQUIRED");
  const upstream = options.upstream.replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;
  const audience = options.audience ?? "hermes";

  const server: Server = createServer((request, response) => {
    void (async () => {
      try {
        let token: string;
        try {
          token = bearerTicket(request.headers.authorization);
        } catch {
          send(response, 401, "TICKET_REQUIRED");
          return;
        }
        let claims;
        try {
          claims = verifyTaskTicket(options.secret, token);
        } catch (error) {
          const code = error instanceof Error ? error.message : "TICKET_INVALID";
          send(response, 401, code === "TICKET_EXPIRED" ? "TICKET_EXPIRED" : "TICKET_INVALID");
          return;
        }
        if (claims.aud !== audience) {
          send(response, 403, "TICKET_AUDIENCE_DENIED");
          return;
        }

        const incoming = new URL(request.url ?? "/", "http://127.0.0.1");
        const rest = incoming.pathname.startsWith("/v1") ? incoming.pathname.slice(3) : incoming.pathname;
        const target = `${upstream}${rest}${incoming.search}`;
        const headers: Record<string, string> = { authorization: `Bearer ${options.apiKey}` };
        for (const [key, value] of Object.entries(request.headers)) {
          if (typeof value !== "string" || HOP.has(key)) continue;
          headers[key] = value;
        }
        const method = request.method ?? "GET";
        const body = method === "GET" || method === "HEAD" ? undefined : await collect(request);
        if (options.authorizeModel) {
          if (method === "GET" && rest === "/models") {
            // Catalog lookup carries no inference cost.
          } else if (method === "POST" && ["/chat/completions", "/responses"].includes(rest)) {
            let model: unknown;
            try { model = JSON.parse(body?.toString("utf8") ?? "{}").model; }
            catch { send(response, 400, "TICKET_PROXY_INVALID_BODY"); return; }
            if (typeof model !== "string" || !await options.authorizeModel(model)) {
              send(response, 403, "TICKET_MODEL_DENIED");
              return;
            }
          } else {
            send(response, 403, "TICKET_ENDPOINT_DENIED");
            return;
          }
        }
        const upstreamResponse = await fetchImpl(target, {
          method,
          headers,
          ...(body && body.length > 0 ? { body } : {})
        });
        const outHeaders: Record<string, string> = {};
        upstreamResponse.headers.forEach((value, key) => {
          if (!HOP.has(key)) outHeaders[key] = value;
        });
        response.writeHead(upstreamResponse.status, outHeaders);
        if (!upstreamResponse.body) {
          response.end();
          return;
        }
        Readable.fromWeb(upstreamResponse.body as import("node:stream/web").ReadableStream).pipe(response);
      } catch {
        if (!response.headersSent) send(response, 502, "TICKET_PROXY_UPSTREAM");
        else response.end();
      }
    })();
  });

  await new Promise<void>((accept, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => accept());
  });
  server.unref();
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("TICKET_PROXY_BIND_FAILED");
  }
  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    close: () => new Promise((accept, reject) => {
      server.close((error) => error ? reject(error) : accept());
    })
  };
}
