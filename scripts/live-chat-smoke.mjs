import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { createControlServer } from "../dist/control/server.js";

import { loadLocalConfig, omniRouteSettings } from "../dist/runtime/local-config.js";

loadLocalConfig();
const route = omniRouteSettings();

if (!route.apiKey) {
  console.error("OMNIROUTE_KEY = BRAK");
  process.exit(10);
}

const root = await mkdtemp(join(tmpdir(), "koord-live-chat-"));
const server = createControlServer({
  stateDir: root,
  webRoot: resolve("web/control"),
  chatApiKeyEnv: "OMNIROUTE_API_KEY",
  chatEndpoint: route.endpoint,
  chatDefaultModel: route.model
});

try {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("LIVE_CHAT_ADDRESS_INVALID");
  const base = `http://127.0.0.1:${address.port}`;

  const created = await fetch(`${base}/api/chat/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: route.model })
  });
  if (created.status !== 201) throw new Error(`LIVE_CHAT_SESSION_HTTP_${created.status}`);
  const session = await created.json();

  const streamAbort = new AbortController();
  const streamResponse = await fetch(`${base}/api/chat/sessions/${session.sessionId}/events`, { signal: streamAbort.signal });
  if (!streamResponse.ok || !streamResponse.body) throw new Error(`LIVE_CHAT_SSE_HTTP_${streamResponse.status}`);

  let deltaCount = 0;
  let content = "";
  let doneSeen = false;
  let deltaBeforeDone = false;
  const reader = streamResponse.body.getReader();
  const decoder = new TextDecoder();

  const consume = (async () => {
    let pending = "";
    while (!doneSeen) {
      const part = await reader.read();
      if (part.done) break;
      pending += decoder.decode(part.value, { stream: true });
      const records = pending.split("\n\n");
      pending = records.pop() ?? "";
      for (const record of records) {
        const line = record.split("\n").find((item) => item.startsWith("data:"));
        if (!line) continue;
        const event = JSON.parse(line.slice(5).trim());
        if (event.type === "assistant_delta") {
          deltaCount += 1;
          content += event.delta;
          if (!doneSeen) deltaBeforeDone = true;
        }
        if (event.type === "error") throw new Error(event.code || "LIVE_CHAT_EVENT_ERROR");
        if (event.type === "assistant_done") {
          doneSeen = true;
          break;
        }
      }
    }
  })();

  const sent = await fetch(`${base}/api/chat/sessions/${session.sessionId}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message: "Reply with exactly this text and nothing else: KOORDYNATOR LIVE CHAT OK",
      model: route.model
    })
  });
  if (sent.status !== 202) throw new Error(`LIVE_CHAT_MESSAGE_HTTP_${sent.status}`);

  await consume;
  streamAbort.abort();

  const restored = await fetch(`${base}/api/chat/sessions/${session.sessionId}`).then((response) => response.json());
  const assistant = restored.messages?.findLast?.((message) => message.role === "assistant");
  if (!doneSeen || deltaCount < 1 || !deltaBeforeDone || !assistant?.content) throw new Error("LIVE_CHAT_STREAM_NOT_PROVEN");

  console.log(JSON.stringify({
    ok: true,
    sessionId: `${session.sessionId.slice(0, 8)}…`,
    model: restored.model,
    deltaCount,
    streamedBeforeDone: deltaBeforeDone,
    persisted: assistant.content === content,
    key: "***"
  }, null, 2));
} finally {
  server.close();
  if (server.listening) await once(server, "close");
  await rm(root, { recursive: true, force: true });
}
