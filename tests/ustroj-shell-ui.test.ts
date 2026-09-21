import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Koordynator Ustrój shell", () => {
  it("loads the two-row shell after the existing chat runtime", async () => {
    const [html, css, shell] = await Promise.all([
      readFile(new URL("../web/control/chat.html", import.meta.url), "utf8"),
      readFile(new URL("../web/control/chat-shell.css", import.meta.url), "utf8"),
      readFile(new URL("../web/control/chat-shell.js", import.meta.url), "utf8")
    ]);

    expect(html).toContain('/chat-shell.css?v=4');
    expect(html).toContain('/chat-shell.js?v=2');
    expect(html).toContain('/chat-v5.js?v=7');
    expect(html.indexOf('/chat-shell.js?v=2')).toBeGreaterThan(html.indexOf('/chat-v5.js?v=7'));
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
    expect(css).toContain("--chat-composer-height:176px");
    expect(css).toContain("grid-template-columns:auto auto minmax(0,1fr) auto auto!important");
    expect(css).toContain("grid-template-rows:46px minmax(0,1fr) var(--chat-composer-height)!important");
    expect(css).toContain("position:relative!important");
    expect(css).toContain("grid-template-columns:minmax(0,1fr) 46px!important");
    expect(css).toContain("height:72px!important");
    expect(localAccess).toContain('id="localTerminalAccess"');
    expect(localAccess).toContain('id="localDiskAccess"');
    expect(localAccess).toContain('grant: "local-files"');
    expect(localAccess).toContain('wrap.id = "sessionFooter"');
    expect(usage).toContain('document.querySelector(".runtime-terminal-toolbar")');
    expect(css).toContain("--workspace-control-height:40px");
    expect(css).toContain("--hermes-input-height:58px");
    expect(css).toContain("height:58px!important");
    expect(css).toContain("font-size:14px!important");
  });

  it("enforces one unified model control row with role, attach, stop and send", async () => {
    const [script, css, manifest] = await Promise.all([
      readFile(new URL("../web/control/chat-v5.js", import.meta.url), "utf8"),
      readFile(new URL("../web/control/chat-shell.css", import.meta.url), "utf8"),
      readFile(new URL("../docs/UI_MANIFEST.md", import.meta.url), "utf8")
    ]);

    expect(script).toContain('actions.querySelector(".v5-control-row")');
    expect(script).toContain('document.getElementById("unifiedModelSelector")');
    expect(script).toContain('document.getElementById("modelMenuButton")');
    expect(script).toContain("row.append(unified, role)");
    expect(script).toContain("row.appendChild(attach)");
    expect(script).toContain("row.appendChild(stop)");
    expect(script).toContain("row.appendChild(send)");
    expect(css).toContain("grid-template-columns:minmax(220px,1fr) minmax(120px,160px) 40px 40px 40px!important");
    expect(css).toContain(".v5-native-model-picker");
    expect(manifest).toContain("WYSZUKIWARKA MODELU I MENU ROZWIJANE MODELI MUSZĄ BYĆ JEDNYM KOMPONENTEM");
    expect(manifest).toContain("HERMES MOŻE MIEĆ MAKSYMALNIE DWA WIERSZE KONTROLEK");
    expect(await readFile(new URL("../web/control/chat.html", import.meta.url), "utf8")).toContain('id="unifiedModelSelector"');
  });
});
