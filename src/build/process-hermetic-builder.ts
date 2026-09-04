import { spawn } from "node:child_process";
import { cp, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { canonicalDigest, canonicalJson } from "../crypto/canonical-digest.js";
import type { Digest } from "../domain/ids.js";
import type { BuildArtifact, HermeticBuilder } from "./hermetic-builder.js";
import type { BuildInputVector } from "./build-input.js";

export type HermeticBuildPlan = {
  sourceDir: string;
  command: string;
  args: string[];
  artifactPaths: string[];
  envAllowList?: string[];
  timeoutMs: number;
  maxOutputBytes: number;
};

export type BuildExecutionReceipt = {
  commandFp: Digest;
  exitCode: number;
  stdoutFp: Digest;
  stderrFp: Digest;
  artifactPaths: string[];
  workspaceFp: Digest;
};

function assertRelativePath(path: string): void {
  if (!path || isAbsolute(path) || path.split(/[\\/]/).includes("..")) throw new Error(`UNSAFE_ARTIFACT_PATH:${path}`);
}

async function collectFiles(root: string, relPath: string): Promise<Array<{ path: string; bytes: Uint8Array }>> {
  const target = join(root, relPath);
  const info = await stat(target);
  if (info.isFile()) return [{ path: relPath.split(sep).join("/"), bytes: await readFile(target) }];
  if (!info.isDirectory()) throw new Error(`UNSUPPORTED_ARTIFACT_TYPE:${relPath}`);
  const names = (await readdir(target)).sort();
  const nested: Array<{ path: string; bytes: Uint8Array }> = [];
  for (const name of names) nested.push(...await collectFiles(root, join(relPath, name)));
  return nested;
}

async function packageArtifacts(workspace: string, artifactPaths: string[]): Promise<Uint8Array> {
  const files: Array<{ path: string; bytes: Uint8Array }> = [];
  for (const path of [...artifactPaths].sort()) {
    assertRelativePath(path);
    const full = resolve(workspace, path);
    const rel = relative(workspace, full);
    if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`ARTIFACT_ESCAPES_WORKSPACE:${path}`);
    files.push(...await collectFiles(workspace, path));
  }
  const unique = new Map<string, Uint8Array>();
  for (const file of files) unique.set(file.path, file.bytes);
  const payload = [...unique.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([path, bytes]) => ({
    path,
    sha256: canonicalDigest(bytes),
    base64: Buffer.from(bytes).toString("base64")
  }));
  return Buffer.from(canonicalJson({ format: "orchestrator-artifact-v1", files: payload }), "utf8");
}

async function runBounded(plan: HermeticBuildPlan, cwd: string): Promise<{ exitCode: number; stdout: Buffer; stderr: Buffer }> {
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: cwd, TMPDIR: cwd, ORCHESTRATOR_HERMETIC: "1" };
  for (const key of plan.envAllowList ?? []) if (process.env[key] !== undefined) env[key] = process.env[key];

  return await new Promise((resolvePromise, reject) => {
    const child = spawn(plan.command, plan.args, { cwd, env, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let size = 0;
    let finished = false;
    const timer = setTimeout(() => {
      if (!finished) child.kill("SIGKILL");
    }, plan.timeoutMs);

    const collect = (bucket: Buffer[]) => (chunk: Buffer) => {
      size += chunk.length;
      if (size > plan.maxOutputBytes) {
        child.kill("SIGKILL");
        return;
      }
      bucket.push(Buffer.from(chunk));
    };
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code, signal) => {
      finished = true;
      clearTimeout(timer);
      if (size > plan.maxOutputBytes) return reject(new Error("BUILD_OUTPUT_LIMIT_EXCEEDED"));
      if (signal === "SIGKILL" && code === null) return reject(new Error("BUILD_TIMEOUT_OR_KILLED"));
      resolvePromise({ exitCode: code ?? 1, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) });
    });
  });
}

export class ProcessHermeticBuilder implements HermeticBuilder {
  public lastReceipt?: BuildExecutionReceipt;
  constructor(private readonly plan: HermeticBuildPlan) {}

  async build(vector: BuildInputVector): Promise<BuildArtifact> {
    const workspace = await mkdtemp(join(tmpdir(), "orchestrator-build-"));
    try {
      const source = resolve(this.plan.sourceDir);
      const destination = join(workspace, basename(source));
      await cp(source, destination, { recursive: true, force: false, errorOnExist: true });
      const result = await runBounded(this.plan, destination);
      if (result.exitCode !== 0) throw new Error(`BUILD_COMMAND_FAILED:${result.exitCode}:${result.stderr.toString("utf8").slice(0, 1000)}`);
      const bytes = await packageArtifacts(destination, this.plan.artifactPaths);
      const workspaceFp = canonicalDigest({ vector, artifactFp: canonicalDigest(bytes) });
      this.lastReceipt = {
        commandFp: canonicalDigest({ command: this.plan.command, args: this.plan.args }),
        exitCode: result.exitCode,
        stdoutFp: canonicalDigest(result.stdout),
        stderrFp: canonicalDigest(result.stderr),
        artifactPaths: [...this.plan.artifactPaths],
        workspaceFp
      };
      return {
        bytes,
        sbomFp: canonicalDigest({ files: this.plan.artifactPaths, format: "orchestrator-artifact-v1" }),
        provenanceFp: canonicalDigest({ vector, commandFp: this.lastReceipt.commandFp, workspaceFp }),
        builderIdentityFp: canonicalDigest({ builder: "ProcessHermeticBuilder", version: 1 })
      };
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }
}
