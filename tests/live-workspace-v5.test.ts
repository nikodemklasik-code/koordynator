import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const requiredIds = [
  "chatWorkspace",
  "chatFrame",
  "chatThread",
  "messageInput",
  "modelSelect",
  "sendButton",
  "stopButton",
  "historyButton",
  "newChatButton",
  "createDocumentButton",
  "stageZeroButton",
  "approveDeliveryButton",
  "runDeliveryButton",
  "muteHermesButton",
  "popoutChatButton",
  "exportMdButton",
  "exportPdfButton",
  "exportZipButton",
  "hermesPane",
  "hermesTerm",
  "startHermesButton",
  "stopHermesButton",
  "hermesInput",
  "sendHermesButton",
  "githubChatButton",
  "githubChatLabel",
  "githubChatConsentDialog",
  "primaryRouteLabel",
  "fallbackRoutesLabel",
  "workspaceSplitter",
  "fileInput",
  "attachButton",
  "attachmentTray",
  "billingBadge",
  "usage24h",
  "sessionLabel"
];

describe("Live Workspace V5", () => {
  it("is a fresh screen with the complete runtime contract", async () => {
    const html = await readFile(new URL("../web/control/chat.html", import.meta.url), "utf8");

    expect(html).toContain("Koordynator · Live Workspace");
    expect(html).toContain("KOORDYNATOR");
    expect(html).toContain("LIVE WORKSPACE");
    expect(html).toContain("Create document");
    expect(html).toContain('/chat-v5.css?v=19');
    expect(html).toContain('/chat-models.js?v=14');
    expect(html).toContain('/chat-v5.js?v=14');
    expect(html).toContain('/chat-router.js?v=4');
    expect(html).toContain('class="workspace-nav"');
    expect(html).toContain('href="/providers"');
    expect(html).toContain('href="/releases"');
    expect(html.indexOf('class="workspace-nav"')).toBeGreaterThan(html.indexOf('class="toolbar"'));
    expect(html.indexOf('class="workspace-nav"')).toBeLessThan(html.indexOf('id="historyButton"'));
    expect(html).toContain('id="executionActivity"');
    expect(html).toContain('class="app-shell"');
    expect(html).toContain('class="composer-note');
    expect(html).not.toContain('href="/styles.css"');
    expect(html).not.toContain('href="/control-ui.css"');
    expect(html).not.toContain("control-workspace-v3");
    expect(html).not.toContain("control-workspace-v4");
    expect(html).not.toContain("v5-rail");
    expect(html).not.toContain("v5-shell");

    for (const id of requiredIds) expect(html).toContain(`id="${id}"`);
    expect(html.indexOf('id="modelSelect"')).toBeGreaterThan(html.indexOf('id="composer"'));
    expect(html.indexOf('id="createDocumentButton"')).toBeGreaterThan(html.indexOf('id="newChatButton"'));
    expect(html.indexOf('id="createDocumentButton"')).toBeLessThan(html.indexOf('id="stageZeroButton"'));
  });

  it("keeps Hermes PTY as a first-class resizable pane on the spec grid", async () => {
    const css = await readFile(new URL("../web/control/chat-v5.css", import.meta.url), "utf8");
    const js = await readFile(new URL("../web/control/chat-v5.js", import.meta.url), "utf8");

    expect(css).toContain("--terminal-width: 34%");
    expect(css).toContain("--splitter-width: 7px");
    expect(css).toContain("--header-height: 64px");
    expect(css).toContain("--toolbar-height: 48px");
    expect(css).toContain("--pane-header-height: 46px");
    expect(css).toContain("--status-height: 28px");
    expect(css).toContain("--composer-input-height: 92px");
    expect(css).toContain("--composer-row-height: 108px");
    expect(css).toContain("--composer-send-size: 44px");
    expect(css).toContain("--composer-pad: 8px 10px 8px");
    expect(css).toContain("pointer-events: none");
    expect(css).toContain("align-items: center");
    expect(css).toContain("#messageInput");
    expect(css).toContain("font-size: 15px");
    expect(css).toContain(".message-copy");
    expect(css).toContain(".message-state");
    expect(css).toContain("justify-content: flex-start");
    expect(css).toContain(".chat-hermes-muted");
    expect(css).toContain(".terminal-pane");
    expect(css).toContain("max-width: 860px");
    expect(css).toContain(".v5-model-explorer");
    expect(css).toContain("#hermesTranscript .terminal-tui-hidden");
    expect(css).toContain("MINIMUM_READABLE_TYPE");
    expect(js).toContain("workspaceSplitter");
    expect(js).toContain("setTerminalWidth");
    expect(js).not.toContain('createElement("style")');
  });

  it("passes the Keychain-hydrated OmniRoute key directly into Control services", async () => {
    const main = await readFile(new URL("../src/control/main.ts", import.meta.url), "utf8");
    expect(main).toContain("...(route.apiKey ? { chatApiKey: route.apiKey } : {})");
  });

  it("surfaces backend primary and fallback routing without blocking the UI", async () => {
    const js = await readFile(new URL("../web/control/chat-v5.js", import.meta.url), "utf8");

    expect(js).toContain("chatDefaultModel");
    expect(js).toContain("chatFallbackModels");
    expect(js).toContain("ensureBackendPrimary");
    expect(js).toContain("void refreshHealth()");
    expect(js).toContain("void ensureBackendPrimary()");
  });

  it("binds Create document even when the toolbar already has the button", async () => {
    const history = await readFile(new URL("../web/control/chat-history.js", import.meta.url), "utf8");
    expect(history).toContain("createDocumentButton");
    expect(history).toContain("openSelector()");
    expect(history).toMatch(/getElementById\("createDocumentButton"\)[\s\S]*addEventListener\("click"/);
  });

  it("wires Etap 0 approval into one signed process then isolated /run", async () => {
    const html = await readFile(new URL("../web/control/chat.html", import.meta.url), "utf8");
    const js = await readFile(new URL("../web/control/chat.js", import.meta.url), "utf8");
    expect(html).toContain('id="approveDeliveryButton"');
    expect(html).toContain('id="runDeliveryButton"');
    expect(js).toContain("/api/delivery/approve");
    expect(js).toContain("/run");
    expect(js).toMatch(/approveDeliveryButton[\s\S]*addEventListener\("click"/);
    expect(js).toMatch(/runDeliveryButton[\s\S]*addEventListener\("click"/);
  });
});
