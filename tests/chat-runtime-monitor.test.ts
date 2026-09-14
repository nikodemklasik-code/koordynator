import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

describe("chat runtime monitor", () => {
  it("loads before chat.js so live fetch and SSE telemetry can observe sessions", async () => {
    const html = await readFile(new URL("../web/control/chat.html", import.meta.url), "utf8");
    const monitor = html.indexOf('/chat-runtime-monitor.js?v=1');
    const chat = html.indexOf('/chat.js?v=5');
    expect(monitor).toBeGreaterThan(-1);
    expect(chat).toBeGreaterThan(monitor);
    expect(html).toContain('/chat-runtime-monitor.css?v=1');
  });

  it("parses and exposes live byte, process and stalled-state telemetry", async () => {
    const source = await readFile(new URL("../web/control/chat-runtime-monitor.js", import.meta.url), "utf8");
    expect(() => new vm.Script(source, { filename: "chat-runtime-monitor.js" })).not.toThrow();
    expect(source).toContain("STALLED");
    expect(source).toContain("runtimeBytes");
    expect(source).toContain("runtimeDelta");
    expect(source).toContain("runtimeLastActivity");
    expect(source).toContain("telemetry.hermes.pid");
    expect(source).toContain("MonitoredEventSource");
  });

  it("keeps raw PTY safe during xterm startup then switches to readable output after Hermes starts", async () => {
    const source = await readFile(new URL("../web/control/chat-runtime-monitor.js", import.meta.url), "utf8");
    expect(source).toContain('let currentMode = "raw"');
    expect(source).toContain('setMode("readable")');
    expect(source).toContain('data-runtime-mode="raw"');
    expect(source).toContain('data-runtime-mode="readable"');
  });

  it("visually distinguishes user-directed answers, questions, commands, success and errors", async () => {
    const source = await readFile(new URL("../web/control/chat-runtime-monitor.js", import.meta.url), "utf8");
    const css = await readFile(new URL("../web/control/chat-runtime-monitor.css", import.meta.url), "utf8");
    expect(source).toContain('"PYTANIE"');
    expect(source).toContain('"ODPOWIEDŹ"');
    expect(source).toContain('"BŁĄD"');
    expect(source).toContain('"WYNIK"');
    expect(css).toContain(".runtime-line.question");
    expect(css).toContain(".runtime-line.answer");
    expect(css).toContain(".runtime-line.error");
    expect(css).toContain(".runtime-line.success");
  });

  it("keeps Hermes controls at the same 38px target height as the chat toolbar", async () => {
    const css = await readFile(new URL("../web/control/chat-runtime-monitor.css", import.meta.url), "utf8");
    expect(css).toContain(".v5-mini-button,.runtime-terminal-button");
    expect(css).toContain("height:38px!important");
  });
});
