import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Koordynator Ustrój shell", () => {
  it("loads the two-row shell after the existing chat runtime", async () => {
    const [html, css, shell] = await Promise.all([
      readFile(new URL("../web/control/chat.html", import.meta.url), "utf8"),
      readFile(new URL("../web/control/chat-shell.css", import.meta.url), "utf8"),
      readFile(new URL("../web/control/chat-shell.js", import.meta.url), "utf8")
    ]);

    expect(html).toContain('/chat-shell.css?v=1');
    expect(html).toContain('/chat-shell.js?v=1');
    expect(html.indexOf('/chat-shell.js?v=1')).toBeGreaterThan(html.indexOf('/chat-v5.js?v=5'));
    expect(css).toContain("grid-template-rows: var(--shell-row-height) var(--shell-row-height)");
    expect(css).toContain("max-height: calc(var(--shell-row-height) * 2)");
    expect(css).toContain(".importance-1");
    expect(css).toContain(".importance-2");
    expect(css).toContain(".importance-3");
    expect(shell).toContain('["tasks", "Tasks", "/"]');
    expect(shell).toContain('["providers", "Providers", "/providers"]');
    expect(shell).toContain('["releases", "Releases", "/releases"]');
    expect(shell).toContain('["ustroj", "Ustrój", "/ustroj"]');
    expect(shell).toContain('for (const key of ["conversations", "new-conversation"])');
    expect(shell).toContain("shellDuplicate");
    expect(shell).toContain('for (const key of ["export-md", "export-pdf", "export-zip"])');
  });

  it("serves a governance screen with main-as-core and ephemeral component branches", async () => {
    const [html, server] = await Promise.all([
      readFile(new URL("../web/control/ustroj.html", import.meta.url), "utf8"),
      readFile(new URL("../src/control/server.ts", import.meta.url), "utf8")
    ]);

    expect(html).toContain("nikodemklasik-code/Korporacja");
    expect(html).toContain("component/&lt;element&gt;");
    expect(html).toContain("merge/push main");
    expect(html).toContain("delete branch");
    expect(html).toContain("Koordynator / Brain");
    expect(html).toContain("Harmonia Legal + Job App");
    expect(server).toContain('"/ustroj": { name: "ustroj.html"');
    expect(server).toContain('"/chat-shell.css": { name: "chat-shell.css"');
    expect(server).toContain('"/chat-shell.js": { name: "chat-shell.js"');
  });

  it("keeps runtime controls compact and the chat composer inside the viewport", async () => {
    const [css, localAccess, usage] = await Promise.all([
      readFile(new URL("../web/control/chat-shell.css", import.meta.url), "utf8"),
      readFile(new URL("../web/control/chat-local-access.js", import.meta.url), "utf8"),
      readFile(new URL("../web/control/chat-usage.js", import.meta.url), "utf8")
    ]);
    expect(css).toContain("margin: 0 !important");
    expect(css).toContain("border-radius: 0 !important");
    expect(css).toContain("background: #08131c !important");
    expect(css).toContain(".koord-local-access");
    expect(css).toContain("max-height:176px!important");
    expect(css).toContain("grid-template-columns:auto auto minmax(0,1fr) auto auto!important");
    expect(localAccess).toContain('id="localTerminalAccess"');
    expect(localAccess).toContain('id="localDiskAccess"');
    expect(localAccess).toContain('grant: "local-files"');
    expect(localAccess).toContain('wrap.id = "sessionFooter"');
    expect(usage).toContain('document.querySelector(".runtime-terminal-toolbar")');
  });
});
