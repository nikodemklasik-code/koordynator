import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadLocalConfig, omniRouteSettings, resolveOmniRouteApiKey } from "../src/runtime/local-config.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("OmniRoute keychain hydration", () => {
  it("uses process/env key before keychain", () => {
    expect(resolveOmniRouteApiKey(
      { OMNIROUTE_API_KEY: "from-env" },
      () => "from-keychain"
    )).toBe("from-env");
  });

  it("falls back to keychain when OMNIROUTE_API_KEY is missing or blank", () => {
    expect(resolveOmniRouteApiKey({}, () => "from-keychain")).toBe("from-keychain");
    expect(resolveOmniRouteApiKey({ OMNIROUTE_API_KEY: "   " }, () => "from-keychain")).toBe("from-keychain");
  });

  it("hydrates blank .env key from keychain into omniRouteSettings without printing secrets", async () => {
    const root = await mkdtemp(join(tmpdir(), "koord-keychain-"));
    roots.push(root);
    const path = join(root, ".env");
    await writeFile(path, "OMNIROUTE_API_KEY=\nOMNIROUTE_ENDPOINT=http://127.0.0.1:20128/v1\nKOORDYNATOR_CHAT_MODEL=gc/grok-4.5\n", "utf8");
    const env: NodeJS.ProcessEnv = {};
    loadLocalConfig(path, env, () => "keychain-secret-value");
    expect(env.OMNIROUTE_API_KEY).toBe("keychain-secret-value");
    const settings = omniRouteSettings(env, () => "keychain-secret-value");
    expect(settings.apiKey).toBe("keychain-secret-value");
    expect(settings.model).toBe("gc/grok-4.5");
  });
});
