import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("persistent chat dock and priority rows", () => {
  it("keeps compact workspace shortcuts visible after messages arrive", async () => {
    const [html, chat, css] = await Promise.all([
      readFile(new URL("../web/control/chat.html", import.meta.url), "utf8"),
      readFile(new URL("../web/control/chat.js", import.meta.url), "utf8"),
      readFile(new URL("../web/control/chat-shell.css", import.meta.url), "utf8")
    ]);

    expect(html).toContain('class="chat-welcome v5-welcome v5-quick-dock"');
    expect(html).toContain('data-chat-quick="message"');
    expect(html).toContain('data-chat-quick="attach"');
    expect(html).toContain('data-chat-quick="stage-zero"');
    expect(html).toContain('data-chat-quick="terminal"');
    expect(html).toContain('data-chat-quick="github"');
    expect(html).toContain('data-chat-quick="history"');

    expect(chat).not.toContain('welcome.classList.add("hidden")');
    expect(chat).not.toContain('welcome.classList.toggle("hidden", messages.length > 0)');
    expect(chat).toContain('document.querySelectorAll("[data-chat-quick]")');

    expect(css).toContain(".v5-quick-dock.hidden");
    expect(css).toContain("display:grid!important");
    expect(css).toContain("position:sticky!important");
  });

  it("classifies important actions on row one and auxiliary chat/terminal controls on row two", async () => {
    const [shell, css, localAccess] = await Promise.all([
      readFile(new URL("../web/control/chat-shell.js", import.meta.url), "utf8"),
      readFile(new URL("../web/control/chat-shell.css", import.meta.url), "utf8"),
      readFile(new URL("../web/control/chat-local-access.js", import.meta.url), "utf8")
    ]);

    expect(shell).toContain(">IMPORTANT<");
    expect(shell).toContain(">AUX<");
    expect(shell).toContain('["chat-important", "Chat", ["new-conversation", "stage-zero", "create-document"]]');
    expect(shell).toContain('["terminal-important", "Terminal", ["terminal"]]');
    expect(shell).toContain('["chat-aux", "Chat", ["conversations", "routing"]]');
    expect(shell).toContain('["terminal-aux", "Terminal", ["popout", "settings"]]');
    expect(localAccess).toContain('data-tool-group="terminal-aux"');

    expect(css).toContain(".koord-shell-action-group-chat-important");
    expect(css).toContain(".koord-shell-action-group-terminal-important");
    expect(css).toContain(".koord-shell-tool-group-chat-aux");
    expect(css).toContain(".koord-shell-tool-group-terminal-aux");
  });

  it("keeps Terminal visible in narrow split-screen layouts", async () => {
    const css = await readFile(new URL("../web/control/chat-shell.css", import.meta.url), "utf8");
    expect(css).toContain("@media(max-width:760px)");
    expect(css).toContain("body.koord-shell-active .v5-terminal-pane");
    expect(css).toContain("display:grid!important");
    expect(css).toContain("grid-template-rows:minmax(360px,58vh) minmax(300px,48vh)!important");
  });
});
