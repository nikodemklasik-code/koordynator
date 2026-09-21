import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

describe("chat runtime monitor", () => {
  it("loads the router/monitor before chat.js so fetch and SSE telemetry observe live sessions", async () => {
    const html = await readFile(new URL("../web/control/chat.html", import.meta.url), "utf8");
    const router = html.indexOf('/chat-router.js?v=2');
    const chat = html.indexOf('/chat.js?v=14');
    expect(router).toBeGreaterThan(-1);
    expect(chat).toBeGreaterThan(router);
    expect(html).toContain('/chat-router.css?v=1');
    expect(html).not.toContain("chat-runtime-monitor.js");
    expect(html).not.toContain("chat-runtime-monitor.css");
  });

  it("parses and exposes live byte, process and stalled-state telemetry", async () => {
    const source = await readFile(new URL("../web/control/chat-router.js", import.meta.url), "utf8");
    expect(() => new vm.Script(source, { filename: "chat-router.js" })).not.toThrow();
    expect(source).toContain("STALLED");
    expect(source).toContain("runtimeBytes");
    expect(source).toContain("runtimeDelta");
    expect(source).toContain("runtimeLastActivity");
    expect(source).toContain("telemetry.hermes.pid");
    expect(source).toContain("MonitoredEventSource");
  });

  it("keeps raw PTY safe during xterm startup then switches to readable output after Hermes starts", async () => {
    const source = await readFile(new URL("../web/control/chat-router.js", import.meta.url), "utf8");
    expect(source).toContain('let currentMode = "raw"');
    expect(source).toContain('setMode("readable")');
    expect(source).toContain('data-runtime-mode="raw"');
    expect(source).toContain('data-runtime-mode="readable"');
  });

  it("visually distinguishes user-directed answers, questions, commands, success and errors", async () => {
    const source = await readFile(new URL("../web/control/chat-router.js", import.meta.url), "utf8");
    const css = await readFile(new URL("../web/control/chat-router.css", import.meta.url), "utf8");
    expect(source).toContain('"PYTANIE"');
    expect(source).toContain('"ODPOWIEDŹ"');
    expect(source).toContain('"BŁĄD"');
    expect(source).toContain('"WYNIK"');
    expect(css).toContain(".runtime-line.question");
    expect(css).toContain(".runtime-line.answer");
    expect(css).toContain(".runtime-line.error");
    expect(css).toContain(".runtime-line.success");
  });

  it("groups consecutive answer/question lines so readable mode is not a wall of tiny labels", async () => {
    const source = await readFile(new URL("../web/control/chat-router.js", import.meta.url), "utf8");
    expect(source).toContain('const mergeable = kind === "answer" || kind === "question" || kind === "meta"');
    expect(source).toContain("lastReadableKind");
    expect(source).toContain("lastReadableRow");
  });

  it("keeps Hermes controls at the same 38px target height as the chat toolbar", async () => {
    const css = await readFile(new URL("../web/control/chat-router.css", import.meta.url), "utf8");
    expect(css).toContain(".v5-mini-button,.runtime-terminal-button");
    expect(css).toContain("height:38px!important");
  });
});
