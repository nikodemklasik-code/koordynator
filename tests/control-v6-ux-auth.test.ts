import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const text = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

describe("Control V6 terminal and startup contracts", () => {
  it("keeps the missing-provider auth wizard syntactically valid and explicitly one-time", async () => {
    execFileSync(process.execPath, ["--check", new URL("../scripts/ai-auth-missing.mjs", import.meta.url).pathname]);
    const script = await text("scripts/ai-auth-missing.mjs");
    const pkg = JSON.parse(await text("package.json"));
    expect(pkg.scripts["ai:auth-missing"]).toContain("ai-auth-missing.mjs");
    expect(script).toContain("one-time provider authentication");
    expect(script).toContain('["oauth", "start", "--provider", providerId]');
    expect(script).not.toContain('key: "qwen"');
    expect(script).toContain("Qoder is intentionally not auto-started");
    expect(script).toContain("Astra is a model slot under the Codex/OpenAI route");
  });

  it("never launches fresh vendor OAuth from normal desktop startup", async () => {
    const start = await text("scripts/start-all.mjs");
    const launcher = await text("scripts/Koordynator-Start.command");
    expect(start).toContain('"ai:connect-existing", "--", "--no-bootstrap"');
    expect(start).toContain('"ai:always-on"');
    expect(start).not.toContain('"ai:auth-missing"');
    expect(start).not.toMatch(/oauth.*start/i);
    expect(launcher).toContain("npm run start:all");
    expect(launcher).toContain("redesign/live-chat-v5");
  });

  it("provides a selectable readable Hermes transcript plus untouched raw PTY", async () => {
    const js = await text("web/control/chat-usage.js");
    const css = await text("web/control/chat-usage.css");
    expect(js).toContain('id = "hermesTranscript"');
    expect(js).toContain("Readable");
    expect(js).toContain("Raw PTY");
    expect(js).toContain("navigator.clipboard.writeText");
    expect(js).toContain("terminal-question");
    expect(js).toContain("terminal-noise");
    expect(css).toContain("user-select:text");
    expect(css).toContain(".terminal-answer-line");
    expect(css).toContain(".terminal-noise");
  });

  it("uses external CSS for a two-row model search hierarchy so CSP cannot leave raw controls", async () => {
    const css = await text("web/control/chat-usage.css");
    expect(css).toContain("grid-template-columns:minmax(0,1fr) 32px 32px 34px!important");
    expect(css).toContain(".v5-model-explorer");
    expect(css).toContain("grid-column:1 / -1!important");
    expect(css).toContain(".v5-model-search");
    expect(css).toContain(".v5-model-role");
  });

  it("renders the creative process as a transient smear, never a progress dot", async () => {
    const css = await text("web/control/chat-usage.css");
    const page = await text("web/control/releases.html");
    expect(page).toContain('/chat-usage.css');
    expect(css).toContain(".creative-card .creative-marker,.creative-card .creative-dot{display:none!important}");
    expect(css).toContain("creative-active-beam");
    expect(css).toContain("width:clamp(110px,15vw,190px)!important");
    expect(css).toContain('[data-state="green"] .creative-glow{opacity:0!important');
  });
});
