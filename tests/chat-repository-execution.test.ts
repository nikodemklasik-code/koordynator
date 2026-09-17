import { describe, it, expect } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChatService, type ChatEvent } from "../src/control/chat-service.js";
import { repositoryTask, runCommand, createRepositoryExecutor } from "../src/control/hermes-repository-runner.js";

describe("chat repository execution", () => {
  it("requires an explicit task and exact GitHub URL", () => {
    expect(repositoryTask("summarize https://github.com/a/b")).toBeNull();
    expect(repositoryTask("/repo https://github.com/a/b.git fix tests")?.repository).toBe("a/b");
    for (const text of ["/repo https://github.com/a/b", "/repo https://github.com.evil/a/b fix", "/repo https://github.com/a/../ fix"]) expect(() => repositoryTask(text)).toThrow();
  });
  it("blocks execution unless explicitly enabled", async () => {
    const dir = await mkdtemp(join(tmpdir(), "repo-chat-"));
    const chat = new ChatService({ stateDir: dir, apiKey: "test" });
    try {
      const s = await chat.createSession();
      await expect(chat.startMessage(s.sessionId, "/repo https://github.com/a/b fix")).rejects.toThrow("REPO_EXECUTION_DISABLED");
    } finally { chat.close(); await rm(dir, { recursive: true, force: true }); }
  });
  it("routes the selected model to executor and persists its result without calling plain chat", async () => {
    const dir = await mkdtemp(join(tmpdir(), "repo-chat-"));
    const chat = new ChatService({ stateDir: dir, apiKey: "test", repositoryExecutor: async run => {
      expect(run.model).toBe("cx/test");
      run.emit("Tests: NOT_TESTED; report ready");
    }, fetchImpl: async () => { throw new Error("PLAIN_CHAT_MUST_NOT_RUN"); } });
    try {
      const s = await chat.createSession("cx/test");
      const done = new Promise<ChatEvent>(accept => chat.subscribe(s.sessionId, e => { if (e.type === "assistant_done" || e.type === "error") accept(e); }));
      await chat.startMessage(s.sessionId, "/repo https://github.com/a/b inspect");
      expect((await done).type).toBe("assistant_done");
      expect((await chat.getSession(s.sessionId))?.messages.at(-1)?.content).toContain("NOT_TESTED");
    } finally { chat.close(); await rm(dir, { recursive: true, force: true }); }
  });
  it("passes arbitrary arguments literally and supports cancellation", async () => {
    const control = new AbortController();
    expect(await runCommand(process.execPath, ["-e", "process.stdout.write(process.argv[1])", "$(echo unsafe)"], process.cwd(), process.env, control.signal)).toBe("$(echo unsafe)");
    const pending = runCommand(process.execPath, ["-e", "setInterval(()=>{},1000)"], process.cwd(), process.env, control.signal);
    control.abort();
    await expect(pending).rejects.toThrow("REPO_STOPPED");
  });
  it("prepares an isolated job, passes credentials only through its profile and redacts the report", { timeout: 20_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), "repo-runner-"));
    const bin = join(root, "bin");
    await mkdir(bin);
    const previousPath = process.env.PATH;
    const originalCwd = process.cwd();
    const script = `#!/usr/bin/env node
import {mkdirSync,readFileSync} from 'node:fs';
import {basename} from 'node:path';
const command=basename(process.argv[1]);
const args=process.argv.slice(2);
if(command==='git') {
  if(args[0]==='clone') mkdirSync(args.at(-1),{recursive:true});
  if(args[0]==='rev-parse') process.stdout.write('a'.repeat(40));
} else if(command==='gh') { process.stdout.write('{}'); }
else {
  const config=JSON.parse(readFileSync(process.env.HERMES_HOME+'/config.yaml','utf8'));
  if(config.model.default!=='cx/test' || !/^http:\\/\\/127\\.0\\.0\\.1:\\d+\\/v1$/.test(config.model.base_url) || config.model.base_url==='http://127.0.0.1:20128/v1') process.exit(2);
  if(config.model.api_key || config.model.key_env!=='OPENAI_API_KEY') process.exit(4);
  if(!String(process.env.OPENAI_API_KEY||'').startsWith('tkt.')) process.exit(5);
  if(process.env.OMNIROUTE_API_KEY) process.exit(6);
  if(!args.includes('-q') || !args.includes('--quiet')) process.exit(3);
  process.stdout.write('Agent fixture completed '+process.env.OPENAI_API_KEY);
}
`;
    try {
      for (const name of ["git", "gh", "hermes"]) await writeFile(join(bin,name), script, { mode: 0o700 });
      process.env.PATH = `${bin}:${previousPath}`;
      const chunks: string[] = [];
      await createRepositoryExecutor(root)({text:"/repo https://github.com/example/repo inspect", model:"cx/test", endpoint:"http://127.0.0.1:20128/v1", apiKey:"fixture-sensitive-key", signal:new AbortController().signal, emit:t=>chunks.push(t), attachments:[{name:"input.txt",dataUrl:"data:text/plain;base64,aGk=",extractedText:"hi"}]});
      expect(chunks.join("")).toContain("Agent fixture completed [REDACTED]");
      expect(chunks.join("")).not.toContain("fixture-sensitive-key");
      expect(chunks.join("")).not.toMatch(/tkt\./);
      const jobs = await readdir(join(root,"repository-jobs"));
      const job = join(root,"repository-jobs",jobs[0]!);
      const receipt = JSON.parse(await readFile(join(job,"receipt.json"),"utf8"));
      expect(receipt.status).toBe("PROCESS_COMPLETED");
      expect(receipt.tests).not.toBe("SEE_AGENT_REPORT");
      expect(receipt.verifier).toBe("independent");
      expect(receipt.testVerdict).toBe("BLOCKED");
      expect(receipt.testStatus).toBe("NOT_RUN");
      expect(await readFile(join(job,"attachments","0-input.txt"),"utf8")).toBe("hi");
      expect(process.cwd()).toBe(originalCwd);
    } finally { process.env.PATH=previousPath; await rm(root,{recursive:true,force:true}); }
  });

  it("records an independent PASS when the verifier exits 0 after the agent", { timeout: 20_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), "repo-runner-pass-"));
    const bin = join(root, "bin");
    await mkdir(bin);
    const previousPath = process.env.PATH;
    const script = `#!/usr/bin/env node
import {mkdirSync,existsSync,writeFileSync} from 'node:fs';
import {basename} from 'node:path';
const command=basename(process.argv[1]);
const args=process.argv.slice(2);
if(command==='git') {
  if(args[0]==='clone') { mkdirSync(args.at(-1),{recursive:true}); writeFileSync(args.at(-1)+'/package.json','{}'); }
  if(args[0]==='rev-parse') process.stdout.write('a'.repeat(40));
} else if(command==='gh') { process.stdout.write('{}'); }
else if(command==='npx' && args[0]==='vitest') { process.exit(existsSync('package.json')?0:1); }
else { process.stdout.write('Agent fixture completed'); }
`;
    try {
      for (const name of ["git", "gh", "hermes", "npx"]) await writeFile(join(bin, name), script, { mode: 0o700 });
      process.env.PATH = `${bin}:${previousPath}`;
      await createRepositoryExecutor(root)({
        text: "/repo https://github.com/example/repo inspect",
        model: "cx/test",
        endpoint: "http://127.0.0.1:20128/v1",
        apiKey: "fixture-sensitive-key",
        signal: new AbortController().signal,
        emit: () => undefined
      });
      const jobs = await readdir(join(root, "repository-jobs"));
      const receipt = JSON.parse(await readFile(join(root, "repository-jobs", jobs[0]!, "receipt.json"), "utf8"));
      expect(receipt.verifier).toBe("independent");
      expect(receipt.testVerdict).toBe("PASS");
      expect(receipt.testStatus).toBe("PASS");
      expect(receipt.testExitCode).toBe(0);
      // Incremental verify: only what the commit changed, against the base SHA.
      expect(receipt.tests).toMatch(/^npx vitest run --changed [0-9a-f]+$/);
    } finally {
      process.env.PATH = previousPath;
      await rm(root, { recursive: true, force: true });
    }
  });
});
