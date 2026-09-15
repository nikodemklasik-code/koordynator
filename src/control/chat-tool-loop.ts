import type { ChatBillingDecision } from "./chat-billing-policy.js";
import { extractProviderReportedUsage } from "../api/provider-usage.js";
export type ToolDefinition = { type: "function"; function: { name: string; description?: string; parameters: Record<string, unknown> } };
export type ToolPort = { tools: ToolDefinition[]; call(name: string, args: Record<string, unknown>, id: string): Promise<string>; close(): Promise<void> };
export type ToolNotice = { id: string; name: string; state: "running" | "complete" | "error"; output?: string };
export async function runChatToolLoop(o: {
  endpoint: string; key: string; models: string[]; messages: unknown[]; signal: AbortSignal;
  fetchImpl: typeof fetch; port: ToolPort;
  authorize?: (model: string) => Promise<ChatBillingDecision>;
  delta(text: string): void; notice(event: ToolNotice): void;
  selected(model: string, billing?: ChatBillingDecision): void;
  usage(value: ReturnType<typeof extractProviderReportedUsage>): void;
}): Promise<void> {
  const messages = [...o.messages];
  const executed = new Set<string>();
  for (let round = 0; round < 16; round++) {
    if (o.signal.aborted) throw new Error("CHAT_STOPPED");
    let response: Response | undefined;
    for (const model of o.models) {
      const billing = await o.authorize?.(model);
      if (billing && !billing.allowed) continue;
      const r = await o.fetchImpl(o.endpoint + "/chat/completions", {
        method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + o.key },
        body: JSON.stringify({ model, messages, stream: true, stream_options: { include_usage: true },
          ...(o.port.tools.length ? { tools: o.port.tools, tool_choice: "auto" } : {}) }), signal: o.signal
      });
      if ([429,502,503,504].includes(r.status)) { await r.body?.cancel(); continue; }
      if (!r.ok) throw new Error("CHAT_UPSTREAM_" + r.status);
      response = r; o.selected(model, billing); break;
    }
    if (!response?.body) throw new Error("CHAT_ROUTE_UNAVAILABLE");
    const calls = new Map<number, { id: string; type: "function"; function: { name: string; arguments: string } }>();
    let content = "", buffer = "", ended = false;
    let roundUsage: ReturnType<typeof extractProviderReportedUsage>;
    const reader = response.body.getReader(), decoder = new TextDecoder();
    function line(s: string) {
      if (!s.startsWith("data:")) return;
      const raw = s.slice(5).trim();
      if (!raw) return;
      if (raw === "[DONE]") { ended = true; return; }
      const data = JSON.parse(raw);
      if (data.error) throw new Error("CHAT_PROVIDER_STREAM_ERROR");
      const usage = extractProviderReportedUsage(data);
      if (usage) roundUsage = usage;
      const choice = data.choices?.[0];
      if (choice?.finish_reason) ended = true;
      const d = choice?.delta;
      if (typeof d?.content === "string") { content += d.content; o.delta(d.content); }
      for (const part of d?.tool_calls ?? []) {
        if (!Number.isInteger(part.index) || part.index < 0 || part.index > 31) throw new Error("TOOL_CALL_INVALID");
        let call = calls.get(part.index);
        if (!call) { call = { id: "", type: "function", function: { name: "", arguments: "" } }; calls.set(part.index, call); }
        if (part.id) call.id += part.id;
        if (part.function?.name) call.function.name += part.function.name;
        if (part.function?.arguments) call.function.arguments += part.function.arguments;
        if (call.function.arguments.length > 128_000) throw new Error("TOOL_ARGUMENTS_TOO_LARGE");
      }
    }
    try {
      for (;;) {
        const r = await reader.read();
        buffer += decoder.decode(r.value ?? new Uint8Array(), { stream: !r.done });
        const lines = buffer.split(/\r?\n/); buffer = lines.pop() ?? "";
        for (const s of lines) line(s);
        if (buffer.length > 1_000_000) throw new Error("CHAT_STREAM_LINE_TOO_LARGE");
        if (r.done) { if (buffer) line(buffer); break; }
      }
    } finally { reader.releaseLock(); }
    o.usage(roundUsage);
    if (!ended) throw new Error("CHAT_STREAM_INTERRUPTED");
    if (!calls.size) return;
    const ordered = [...calls].sort((a,b) => a[0]-b[0]).map(([,v]) => v);
    messages.push({ role: "assistant", content: content || null, tool_calls: ordered });
    for (const call of ordered) {
      if (o.signal.aborted) throw new Error("CHAT_STOPPED");
      if (!call.id || executed.has(call.id)) throw new Error("TOOL_CALL_ID_DUPLICATE");
      executed.add(call.id);
      o.notice({ id: call.id, name: call.function.name, state: "running" });
      let output: string;
      try {
        if (!o.port.tools.some(t => t.function.name === call.function.name)) throw new Error("TOOL_NOT_ALLOWED");
        const args: unknown = JSON.parse(call.function.arguments);
        if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("TOOL_ARGUMENTS_INVALID");
        output = (await o.port.call(call.function.name, args as Record<string, unknown>, call.id)).slice(0,60_000);
        o.notice({ id: call.id, name: call.function.name, state: "complete", output });
      } catch (e) {
        output = JSON.stringify({ error: e instanceof Error ? e.message : "TOOL_FAILED" });
        o.notice({ id: call.id, name: call.function.name, state: "error", output });
        // An uncertain side effect must never be retried automatically.
        throw e;
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: output });
    }
  }
  throw new Error("CHAT_TOOL_ROUND_LIMIT");
}
