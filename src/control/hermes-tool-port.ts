import { spawn } from "node:child_process";
import { access, readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve, delimiter, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareHermes } from "../runtime/hermes-launch.js";
import { loadHermesGrants } from "./hermes-grant-store.js";
import type { ToolPort, ToolDefinition } from "./chat-tool-loop.js";

async function installedPython(): Promise<string> {
  const candidates = [process.env.KOORDYNATOR_HERMES_PYTHON,
    join(homedir(), ".hermes", "hermes-agent", ".venv", "bin", "python"),
    join(homedir(), "hermes-agent", ".venv", "bin", "python")];
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    try {
      const launcher = await realpath(join(dir, "hermes"));
      const first = (await readFile(launcher, "utf8")).split("\n")[0] ?? "";
      const match = /^#!(\/[^\s]*python[^\s]*)\s*$/.exec(first);
      if (match?.[1]) candidates.push(match[1]);
      candidates.push(join(dirname(launcher), "python"));
    } catch { /* try next installed path */ }
  }
  for (const path of candidates) if (path) { try { await access(path); return path; } catch { /* next */ } }
  throw new Error("HERMES_TOOLS_PYTHON_NOT_FOUND: set KOORDYNATOR_HERMES_PYTHON to Hermes venv/bin/python");
}

export async function openHermesToolPort(o: {
  root: string; stateDir: string; endpoint: string; apiKey: string; model: string;
  sessionId: string; userTask: string; readOnly: boolean; signal: AbortSignal;
}): Promise<ToolPort> {
  const python = await installedPython();
  const grants = await loadHermesGrants(o.stateDir);
  const allowed = ["skills_list", "skill_view"];
  // The terminal grant also authorizes general file tools. Scoped local-file grants
  // alone are not upgraded to unrestricted terminal/file access.
  if (grants.terminal) {
    allowed.push("read_file", "search_files");
    if (!o.readOnly) allowed.push("terminal", "process", "write_file", "patch");
  }
  const launch = await prepareHermes({ endpoint: o.endpoint, apiKey: o.apiKey, model: o.model }, o.root);
  const script = fileURLToPath(new URL("../../scripts/hermes-tools-bridge.py", import.meta.url));
  // dist/control -> repository/scripts
  const scriptPath = script.includes(sep + "dist" + sep) ? resolve(dirname(script), "..", "..", "scripts", "hermes-tools-bridge.py") : script;
  const child = spawn(python, ["-u", scriptPath], {
    cwd: o.root, detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"],
    env: { ...launch.env, PYTHONUNBUFFERED: "1", TERMINAL_CWD: o.root,
      KOORDYNATOR_BRIDGE_ALLOWED: JSON.stringify(allowed),
      KOORDYNATOR_BRIDGE_TOOLSETS: JSON.stringify(["skills", "file", ...(grants.terminal && !o.readOnly ? ["terminal"] : [])]) }
  });
  let closed = false, buffer = "", bytes = 0;
  let waiter: { id: string; resolve(value: string): void; reject(e: Error): void } | undefined;
  let readyResolve!: (tools: ToolDefinition[]) => void, readyReject!: (error: Error) => void;
  const ready = new Promise<ToolDefinition[]>((res, rej) => { readyResolve=res; readyReject=rej; });
  const redact = (s: string) => [o.apiKey, launch.env.OPENAI_API_KEY, launch.env.OMNIROUTE_TASK_TICKET]
    .filter((v): v is string => Boolean(v)).reduce((v,k) => v.split(k).join("[REDACTED]"), s)
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)\b/g, "[REDACTED]");
  function fail(e: Error) { readyReject(e); waiter?.reject(e); waiter=undefined; }
  async function close() {
    if (closed) return; closed = true;
    o.signal.removeEventListener("abort", abort);
    if (child.pid) { try { process.kill(process.platform === "win32" ? child.pid : -child.pid, "SIGTERM"); } catch { /* exited */ } }
    child.stdin.destroy(); await launch.close();
  }
  function abort() { fail(new Error("CHAT_STOPPED")); void close(); }
  child.on("error", () => { fail(new Error("HERMES_TOOLS_START_FAILED")); void close(); });
  child.on("exit", () => { fail(new Error("HERMES_TOOLS_EXITED")); void close(); });
  child.stderr.on("data", () => { /* never copy environment/log secrets into conversation */ });
  child.stdin.on("error", () => fail(new Error("HERMES_TOOLS_PIPE_FAILED")));
  child.stdout.on("data", chunk => {
    bytes += chunk.length;
    if (bytes > 8_000_000) { fail(new Error("HERMES_TOOLS_OUTPUT_LIMIT")); void close(); return; }
    buffer += chunk.toString("utf8");
    for (;;) {
      const newline = buffer.indexOf("\n"); if (newline < 0) break;
      const line = buffer.slice(0,newline); buffer = buffer.slice(newline+1);
      try {
        const reply = JSON.parse(line);
        if (reply.ready === true && Array.isArray(reply.tools)) readyResolve(reply.tools.filter((t: ToolDefinition) => allowed.includes(t.function?.name)));
        else if (waiter && reply.id === waiter.id) {
          const current=waiter; waiter=undefined;
          if (reply.error) current.reject(new Error(redact(String(reply.error))));
          else current.resolve(redact(typeof reply.result === "string" ? reply.result : JSON.stringify(reply.result)));
        }
      } catch { fail(new Error("HERMES_TOOLS_PROTOCOL_INVALID")); void close(); }
    }
  });
  o.signal.addEventListener("abort", abort, { once: true });
  if (o.signal.aborted) abort();
  const timer = setTimeout(() => { fail(new Error("HERMES_TOOLS_START_TIMEOUT")); void close(); }, 20_000);
  let definitions: ToolDefinition[];
  try { definitions = await ready; } catch(e) { await close(); throw e; } finally { clearTimeout(timer); }
  return {
    tools: definitions,
    call: async (name,args,id) => {
      if (closed || o.signal.aborted) throw new Error("CHAT_STOPPED");
      if (waiter) throw new Error("HERMES_TOOLS_BUSY");
      if (!allowed.includes(name)) throw new Error("TOOL_NOT_ALLOWED");
      // Re-check revocable grants immediately before an effect.
      if (!["skills_list","skill_view"].includes(name) && !(await loadHermesGrants(o.stateDir)).terminal) throw new Error("HERMES_TERMINAL_GRANT_REQUIRED");
      return new Promise<string>((res,rej) => {
        const timeout = setTimeout(() => { fail(new Error("TOOL_TIMEOUT_RESULT_UNCERTAIN")); void close(); }, 120_000);
        waiter={id,resolve: v=>{clearTimeout(timeout);res(v);},reject:e=>{clearTimeout(timeout);rej(e);}};
        child.stdin.write(JSON.stringify({ name, arguments: args, id, sessionId: o.sessionId, userTask: o.userTask })+"\n");
      });
    },
    close
  };
}
