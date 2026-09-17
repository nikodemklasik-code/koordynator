import { mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadLocalConfig, omniRouteSettings } from "../src/runtime/local-config.js";
import { checkOmniRoute, probeOmniRoute } from "../src/runtime/omniroute-check.js";
import { prepareHermes } from "../src/runtime/hermes-launch.js";

const settings = { endpoint: "http://127.0.0.1:20128/v1", apiKey: "test-gateway-key", model: "cx/gpt-test" };

function gateway(models: unknown[], reply: unknown = { choices: [{ message: { content: "OK" } }] }, status = 200) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = (async (input, init) => {
    const url = String(input);
    calls.push({ url, ...(init === undefined ? {} : { init }) });
    if (url.endsWith("/v1/models")) return Response.json({ data: models });
    if (url.endsWith("/chat/completions")) return Response.json(reply, { status });
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe("Hermes / OmniRoute operator setup", () => {
  it("loads local configuration without executing shell expressions or overriding process values", async () => {
    const root = await mkdtemp(join(tmpdir(), "koord-env-"));
    try {
      const path = join(root, ".env");
      await writeFile(path, 'OMNIROUTE_API_KEY="local-key"\nKOORDYNATOR_CHAT_MODEL=cc/claude-test\nOMNIROUTE_LITERAL=$(touch /tmp/should-not-run)\nNODE_OPTIONS=--inspect\nPATH=bad\n');
      const env = { OMNIROUTE_API_KEY: "process-key" } as NodeJS.ProcessEnv;
      loadLocalConfig(path, env);
      expect(env.OMNIROUTE_API_KEY).toBe("process-key");
      expect(env.KOORDYNATOR_CHAT_MODEL).toBe("cc/claude-test");
      expect(env.OMNIROUTE_LITERAL).toBe("$(touch /tmp/should-not-run)");
      expect(env.NODE_OPTIONS).toBeUndefined();
      expect(env.PATH).toBeUndefined();
      expect(() => loadLocalConfig(join(root, "missing"), env)).not.toThrow();
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("normalizes the API root and rejects dashboard or credential-bearing URLs", () => {
    expect(omniRouteSettings({ OMNIROUTE_ENDPOINT: "http://localhost:20128/" }).endpoint).toBe("http://localhost:20128/v1");
    expect(omniRouteSettings({ OMNIROUTE_ENDPOINT: "http://localhost:20128/api/v1/" }).endpoint).toBe("http://localhost:20128/api/v1");
    for (const endpoint of ["http://localhost:20128/home", "http://user:secret@localhost/v1", "file:///v1", "http://localhost/v1?key=secret"]) {
      expect(() => omniRouteSettings({ OMNIROUTE_ENDPOINT: endpoint })).toThrow(/OMNIROUTE_ENDPOINT/);
    }
  });

  it.each([
    "cx/gpt-test",
    "cc/claude-test",
    "gh/copilot-test",
    "gc/grok-test",
    "gemini-cli/gemini-test",
    "kr/kiro-test",
    "if/qoder-test",
    "qw/qwen-test"
  ])("probes protected route %s without switching to a direct API", async model => {
    const mock = gateway([{ id: model }]);
    expect(await probeOmniRoute({ ...settings, model }, mock.fetchImpl)).toMatchObject({ inference: "PASS", toolCalling: "NOT_TESTED", model });
    const post = mock.calls.find(call => call.init?.method === "POST")!;
    expect(post.url).toBe(`${settings.endpoint}/chat/completions`);
    expect(JSON.parse(String(post.init?.body)).model).toBe(model);
    expect(post.init?.headers).toMatchObject({ authorization: `Bearer ${settings.apiKey}` });
  });

  it("exposes dedicated launch commands and environment slots for every protected provider family", async () => {
    const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    expect(packageJson.scripts).toMatchObject({
      "hermes:openai": expect.stringContaining("hermes openai"),
      "hermes:anthropic": expect.stringContaining("hermes anthropic"),
      "hermes:github": expect.stringContaining("hermes github"),
      "hermes:grok": expect.stringContaining("hermes grok"),
      "hermes:gemini": expect.stringContaining("hermes gemini"),
      "hermes:kiro": expect.stringContaining("hermes kiro"),
      "hermes:qoder": expect.stringContaining("hermes qoder"),
      "hermes:qwen": expect.stringContaining("hermes qwen")
    });
    const envExample = await readFile(new URL("../.env.example", import.meta.url), "utf8");
    for (const name of [
      "KOORDYNATOR_OPENAI_MODEL",
      "KOORDYNATOR_ANTHROPIC_MODEL",
      "KOORDYNATOR_GITHUB_COPILOT_MODEL",
      "KOORDYNATOR_GROK_MODEL",
      "KOORDYNATOR_GEMINI_MODEL",
      "KOORDYNATOR_KIRO_MODEL",
      "KOORDYNATOR_QODER_MODEL",
      "KOORDYNATOR_QWEN_MODEL"
    ]) expect(envExample).toContain(`${name}=`);
  });

  it.each([
    [{ id: "openai/gpt-test", pricing: { input: 2, output: 10 } }, "openai/gpt-test"],
    [{ id: "anthropic/claude-test", source: "imported" }, "anthropic/claude-test"],
    [{ id: "auto/best-free" }, "auto/best-free"],
    [{ id: "cx/gpt-test" }, "cx/not-listed"]
  ])("does not infer free access from an imported catalog or name", async (record, model) => {
    const mock = gateway([record]);
    await expect(probeOmniRoute({ ...settings, model }, mock.fetchImpl)).rejects.toThrow();
    expect(mock.calls.some(call => call.init?.method === "POST")).toBe(false);
  });

  it("does not call a reachable catalog a successful inference", async () => {
    const mock = gateway([{ id: settings.model }], { error: { message: "secret upstream error" } }, 429);
    expect(await checkOmniRoute(settings, mock.fetchImpl)).toMatchObject({ ready: true, listed: true });
    await expect(probeOmniRoute(settings, mock.fetchImpl)).rejects.toThrow("OMNIROUTE_PROBE_HTTP_429");
  });

  it("creates endpoint-bound Hermes config, keeps secrets out of argv and rejects profile symlinks", async () => {
    const root = await mkdtemp(join(tmpdir(), "koord-hermes-"));
    const launches: Array<{ close: () => Promise<void> }> = [];
    try {
      // prepareHermes reads the real process.env by default, so an operator shell with
      // KOORDYNATOR_FALLBACK_MODELS set would leak fallbacks into this assertion.
      const launch = await prepareHermes(settings, root, {
        ...process.env,
        KOORDYNATOR_FALLBACK_MODELS: "",
        OMNIROUTE_API_KEY: settings.apiKey,
        OPENAI_API_KEY: settings.apiKey
      } as NodeJS.ProcessEnv);
      launches.push(launch);
      const path = join(launch.env.HERMES_HOME!, "config.yaml");
      const config = JSON.parse(await readFile(path, "utf8"));
      expect(config.model.provider).toBe("custom");
      expect(config.model.default).toBe(settings.model);
      expect(config.model.api_mode).toBe("chat_completions");
      expect(config.model.key_env).toBe("OPENAI_API_KEY");
      expect(config.model.base_url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/v1$/);
      expect(config.model.base_url).not.toBe(settings.endpoint);
      expect(JSON.stringify(config)).not.toContain(settings.apiKey);
      expect(config.approvals).toEqual({ mode: "smart" });
      expect(config.disabled_toolsets).toEqual(["terminal"]);
      expect(config.fallback_providers).toBeUndefined();
      expect((await stat(path)).mode & 0o777).toBe(0o600);
      expect(launch.args).toEqual(["chat", "--provider", "custom", "--model", settings.model]);
      expect(launch.args.join(" ")).not.toContain(settings.apiKey);
      expect(launch.env.OPENROUTER_API_KEY).toBe("");
      expect(launch.env.OMNIROUTE_API_KEY).toBeUndefined();
      expect(launch.env.OPENAI_API_KEY).toMatch(/^tkt\./);
      expect(launch.env.OPENAI_API_KEY).not.toBe(settings.apiKey);
      expect(launch.env.OMNIROUTE_TASK_TICKET).toBe(launch.env.OPENAI_API_KEY);
      await rm(path);
      const outside = join(root, "untouched");
      await writeFile(outside, "preserve");
      await symlink(outside, path);
      await expect(prepareHermes(settings, root)).rejects.toThrow();
      expect(await readFile(outside, "utf8")).toBe("preserve");
    } finally {
      await Promise.all(launches.map((item) => item.close()));
      await rm(root, { recursive: true, force: true });
    }
  });

  it("writes OmniRoute fallback providers into the managed Hermes profile", async () => {
    const root = await mkdtemp(join(tmpdir(), "koord-hermes-fallback-"));
    let launch: Awaited<ReturnType<typeof prepareHermes>> | undefined;
    try {
      launch = await prepareHermes(settings, root, {
        KOORDYNATOR_FALLBACK_MODELS: "cc/claude-opus-5,gc/grok-4.5,cx/gpt-5.5,cx/gpt-5.5"
      } as NodeJS.ProcessEnv);
      const config = JSON.parse(await readFile(join(launch.env.HERMES_HOME!, "config.yaml"), "utf8"));
      expect(config.fallback_providers).toEqual([
        { provider: "custom", model: "cc/claude-opus-5", base_url: launch.env.OPENAI_BASE_URL, key_env: "OPENAI_API_KEY" },
        { provider: "custom", model: "gc/grok-4.5", base_url: launch.env.OPENAI_BASE_URL, key_env: "OPENAI_API_KEY" },
        { provider: "custom", model: "cx/gpt-5.5", base_url: launch.env.OPENAI_BASE_URL, key_env: "OPENAI_API_KEY" }
      ]);
      expect(launch.env.OPENAI_BASE_URL).not.toBe(settings.endpoint);
    } finally {
      await launch?.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
