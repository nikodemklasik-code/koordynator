import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { createControlServer } from "../src/control/server.js";
import { HermesPtySession } from "../src/control/hermes-pty.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function listen(options: Parameters<typeof createControlServer>[0]) {
  const server = createControlServer(options);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("NO_ADDR");
  return {
    base: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.close();
      if (server.listening) await once(server, "close");
    }
  };
}

async function grantTerminal(root: string): Promise<void> {
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "hermes-grants.json"), `${JSON.stringify({ terminal: true, updatedAt: "2026-09-11T12:20:00.000Z" })}\n`);
}

/** In-process fake PTY: writes are echoed, resize is recorded. */
function echoPty() {
  const listeners: Array<(chunk: Buffer) => void> = [];
  let killed = false;
  const resizes: Array<{ cols: number; rows: number }> = [];
  return {
    resizes,
    spawn: () => ({
      pid: 4242,
      write(data: string | Buffer) {
        if (killed) return;
        const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
        for (const listener of listeners) listener(buffer);
      },
      resize(cols: number, rows: number) { resizes.push({ cols, rows }); },
      onData(listener: (chunk: Buffer) => void) { listeners.push(listener); },
      onExit(listener: (code: number) => void) { this._onExit = listener; },
      kill() {
        killed = true;
        this._onExit?.(0);
      },
      _onExit: undefined as ((code: number) => void) | undefined
    })
  };
}

describe("Live Chat + Hermes PTY screen", () => {
  it("serves chat and Hermes terminal on one page, with mute", async () => {
    const root = await mkdtemp(join(tmpdir(), "hermes-pty-ui-"));
    roots.push(root);
    const { base, close } = await listen({ stateDir: root, webRoot: resolve("web/control") });
    try {
      const page = await fetch(`${base}/chat`).then((item) => item.text());
      expect(page).toContain('id="hermesPane"');
      expect(page).toContain('id="muteHermesButton"');
      expect(page).toContain('id="hermesTerm"');
      expect(page).toContain('id="startHermesButton"');
      expect(page).toContain('href="/xterm.css"');
      expect(page).toContain('src="/xterm.js"');
      expect(await fetch(`${base}/xterm.js`).then((item) => item.status)).toBe(200);
      expect(await fetch(`${base}/xterm.css`).then((item) => item.status)).toBe(200);
      const css = await fetch(`${base}/chat.css`).then((item) => item.text());
      expect(css).toContain(".chat-hermes-muted");
      expect(css).toContain(".hermes-pane");
      expect(css).not.toContain("word-break:break-word");
      const js = await fetch(`${base}/chat.js`).then((item) => item.text());
      expect(js).toContain("/api/hermes/pty");
      expect(js).toContain("muteHermes");
      expect(js).toContain("new Terminal");
    } finally {
      await close();
    }
  });
});

describe("Hermes PTY HTTP", () => {
  it("refuses to start without a terminal grant", async () => {
    const root = await mkdtemp(join(tmpdir(), "hermes-pty-deny-"));
    roots.push(root);
    const fake = echoPty();
    const { base, close } = await listen({
      stateDir: root,
      webRoot: resolve("web/control"),
      hermesPty: {
        spawn: fake.spawn,
        prepare: async () => ({ command: "echo", args: ["no"], cwd: root, env: process.env })
      }
    });
    try {
      const denied = await fetch(`${base}/api/hermes/pty`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}"
      });
      expect(denied.status).toBe(403);
      expect(await denied.json()).toEqual({ error: "HERMES_TERMINAL_REQUIRED" });
    } finally {
      await close();
    }
  });

  it("starts a PTY after grant, echoes input, resizes and stops", async () => {
    const root = await mkdtemp(join(tmpdir(), "hermes-pty-ok-"));
    roots.push(root);
    await grantTerminal(root);
    const fake = echoPty();
    const { base, close } = await listen({
      stateDir: root,
      webRoot: resolve("web/control"),
      hermesPty: {
        spawn: fake.spawn,
        prepare: async () => ({ command: "echo", args: ["ok"], cwd: root, env: process.env })
      }
    });
    try {
      const started = await fetch(`${base}/api/hermes/pty`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cols: 80, rows: 24 })
      });
      expect(started.status).toBe(201);
      const session = await started.json() as { sessionId: string; cols: number; rows: number };
      expect(session.sessionId).toMatch(/^[0-9a-f-]{36}$/i);
      expect(session.cols).toBe(80);
      expect(session.rows).toBe(24);

      const events = await fetch(`${base}/api/hermes/pty/${session.sessionId}/events`);
      expect(events.status).toBe(200);
      expect(events.headers.get("content-type")).toMatch(/text\/event-stream/);

      const chunks: string[] = [];
      const reader = events.body!.getReader();
      const decoded = new TextDecoder();
      const waitData = (async () => {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          chunks.push(decoded.decode(value));
          if (chunks.join("").includes("hello-pty")) return;
        }
      })();

      const written = await fetch(`${base}/api/hermes/pty/${session.sessionId}/input`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ data: "hello-pty" })
      });
      expect(written.status).toBe(200);

      await Promise.race([waitData, new Promise((_, reject) => setTimeout(() => reject(new Error("SSE_TIMEOUT")), 2000))]);
      expect(chunks.join("")).toContain("hello-pty");

      const resized = await fetch(`${base}/api/hermes/pty/${session.sessionId}/resize`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cols: 120, rows: 40 })
      });
      expect(resized.status).toBe(200);
      expect(fake.resizes.at(-1)).toEqual({ cols: 120, rows: 40 });

      const stopped = await fetch(`${base}/api/hermes/pty/${session.sessionId}/stop`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}"
      });
      expect(stopped.status).toBe(200);
    } finally {
      await close();
    }
  });
});

describe("HermesPtySession", () => {
  it("does not spawn until the terminal grant exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "hermes-pty-unit-"));
    roots.push(root);
    let spawned = 0;
    const session = new HermesPtySession({
      stateDir: root,
      spawn: () => {
        spawned += 1;
        return echoPty().spawn();
      },
      prepare: async () => ({ command: "echo", args: [], cwd: root, env: process.env })
    });
    await expect(session.start({ cols: 80, rows: 24 })).rejects.toMatchObject({ code: "HERMES_TERMINAL_REQUIRED" });
    expect(spawned).toBe(0);
  });
});
