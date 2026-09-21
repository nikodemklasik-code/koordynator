import { afterEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { studioProviderCatalog } from "../src/control/studio-provider-catalog.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Studio media workspace", () => {
  it("restores separate Graphics, Video, Voice and Frontend screens", async () => {
    const [html, js, server, shell] = await Promise.all([
      readFile(new URL("../web/control/studio.html", import.meta.url), "utf8"),
      readFile(new URL("../web/control/studio.js", import.meta.url), "utf8"),
      readFile(new URL("../src/control/server.ts", import.meta.url), "utf8"),
      readFile(new URL("../web/control/chat-shell.js", import.meta.url), "utf8")
    ]);

    expect(html).toContain('data-studio-tab="image"');
    expect(html).toContain('data-studio-tab="video"');
    expect(html).toContain('data-studio-tab="voice"');
    expect(html).toContain('data-studio-tab="frontend"');
    expect(html).toContain("OpenAI Image");
    expect(html).toContain("VEED Fabric");
    expect(html).toContain("ElevenLabs");
    expect(html).toContain("OmniRoute model fabric");
    expect(html).toContain('id="studioContextSession"');
    expect(html).toContain('id="studioContextChoose"');
    expect(html).toContain('id="studioContextDialog"');
    expect(html).toContain("Wybierz elementy rozmowy");

    expect(js).toContain('fetch("/api/studio/providers"');
    expect(js).toContain('fetch("/api/studio/image/generate"');
    expect(js).toContain('fetch("/api/studio/video/generate"');
    expect(js).toContain('fetch("/api/studio/voice/voices"');
    expect(js).toContain('fetch("/api/studio/voice/tts"');
    expect(js).toContain('fetch("/api/chat/models"');
    expect(js).toContain('fetch("/api/chat/sessions?limit=100"');
    expect(js).toContain("studioContextSelectedIds");
    expect(js).toContain("promptWithContext");
    expect(js).toContain("WYBRANE ELEMENTY ROZMOWY");

    expect(server).toContain('"/studio": { name: "studio.html"');
    expect(server).toContain('"/studio.css": { name: "studio.css"');
    expect(server).toContain('"/studio.js": { name: "studio.js"');
    expect(server).toContain('url.pathname === "/api/studio/providers"');
    expect(server).toContain('url.pathname === "/api/studio/image/generate"');
    expect(server).toContain('url.pathname === "/api/studio/video/generate"');
    expect(server).toContain('url.pathname === "/api/studio/voice/tts"');
    expect(shell).toContain('["studio", "Studio", "/studio"]');
  });

  it("reports provider bindings truthfully from runtime configuration", () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("FAL_KEY", "");
    vi.stubEnv("VEED_API_KEY", "");
    vi.stubEnv("ELEVENLABS_API_KEY", "");
    vi.stubEnv("HARMONIA_ELEVEN_API_KEY", "");

    vi.stubEnv("KOORDYNATOR_IMAGE_PROVIDER", "placeholder-only");
    vi.stubEnv("KOORDYNATOR_VIDEO_PROVIDER", "placeholder-only");
    const unavailable = studioProviderCatalog([]);
    expect(unavailable.find((item) => item.capability === "image")?.state).toBe("NOT_CONFIGURED");
    expect(unavailable.find((item) => item.capability === "video")?.state).toBe("NOT_CONFIGURED");
    expect(unavailable.find((item) => item.capability === "voice")?.state).toBe("NOT_CONFIGURED");
    expect(unavailable.find((item) => item.capability === "frontend")?.state).toBe("NOT_CONFIGURED");

    vi.stubEnv("KOORDYNATOR_IMAGE_PROVIDER", "");
    vi.stubEnv("KOORDYNATOR_VIDEO_PROVIDER", "");
    vi.stubEnv("OPENAI_API_KEY", "configured");
    vi.stubEnv("FAL_KEY", "configured");
    vi.stubEnv("ELEVENLABS_API_KEY", "configured");
    const ready = studioProviderCatalog(["cx/gpt-5.6-sol"]);
    expect(ready.find((item) => item.capability === "image")?.state).toBe("READY");
    expect(ready.find((item) => item.capability === "video")?.state).toBe("READY");
    expect(ready.find((item) => item.capability === "voice")?.state).toBe("READY");
    expect(ready.find((item) => item.capability === "frontend")?.state).toBe("ROUTED");
  });

  it("keeps media secrets server-side and names current provider models", async () => {
    const [catalog, server] = await Promise.all([
      readFile(new URL("../src/control/studio-provider-catalog.ts", import.meta.url), "utf8"),
      readFile(new URL("../src/control/server.ts", import.meta.url), "utf8")
    ]);
    expect(catalog).toContain('"gpt-image-2.5-sunburst"');
    expect(catalog).toContain('"veed/fabric-1.0/text"');
    expect(catalog).toContain('"eleven_multilingual_v2"');
    expect(server).toContain('"xi-api-key": key');
    expect(server).toContain("authorization:");
    expect(server).toContain('"https://fal.run/veed/fabric-1.0/text"');
    expect(server).toContain('authorization: `Key ${key}`');
    expect(server).not.toContain("OPENAI_API_KEY=");
    expect(server).not.toContain("ELEVENLABS_API_KEY=");
  });
});
