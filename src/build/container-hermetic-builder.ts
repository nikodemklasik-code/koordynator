import { spawn } from "node:child_process";
import { cp, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { canonicalDigest, canonicalJson } from "../crypto/canonical-digest.js";
import type { BuildArtifact, HermeticBuilder } from "./hermetic-builder.js";
import type { BuildInputVector } from "./build-input.js";

export type ContainerHermeticBuildPlan = {
  kind: "container";
  runtime: "docker" | "podman";
  image: string;
  sourceDir: string;
  command: string;
  args: string[];
  artifactPaths: string[];
  timeoutMs: number;
  maxOutputBytes: number;
  memoryMb?: number;
  cpus?: number;
  pidsLimit?: number;
};

function assertPinnedImage(image: string): void {
  if (!/@sha256:[a-f0-9]{64}$/i.test(image)) throw new Error("CONTAINER_IMAGE_MUST_BE_PINNED_BY_SHA256");
}

function safeArtifactPath(path: string): void {
  if (!path || isAbsolute(path) || path.split(/[\\/]/).includes("..")) throw new Error(`UNSAFE_ARTIFACT_PATH:${path}`);
}

export function containerRunArgs(plan: ContainerHermeticBuildPlan, workspace: string): string[] {
  assertPinnedImage(plan.image);
  const mount = `type=bind,src=${workspace},dst=/workspace`;
  const args = [
    "run", "--rm", "--network=none", "--cap-drop=ALL", "--security-opt=no-new-privileges",
    "--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid,size=128m", "--workdir", "/workspace",
    "--mount", mount, "--pids-limit", String(plan.pidsLimit ?? 256)
  ];
  if (plan.memoryMb !== undefined) args.push("--memory", `${plan.memoryMb}m`);
  if (plan.cpus !== undefined) args.push("--cpus", String(plan.cpus));
  args.push(plan.image, plan.command, ...plan.args);
  return args;
}

async function collect(root: string, relPath: string): Promise<Array<{ path: string; bytes: Uint8Array }>> {
  safeArtifactPath(relPath);
  const target = join(root, relPath);
  const info = await stat(target);
  if (info.isFile()) return [{ path: relPath.split(sep).join("/"), bytes: await readFile(target) }];
  if (!info.isDirectory()) throw new Error(`UNSUPPORTED_ARTIFACT_TYPE:${relPath}`);
  const result: Array<{ path: string; bytes: Uint8Array }> = [];
  for (const name of (await readdir(target)).sort()) result.push(...await collect(root, join(relPath, name)));
  return result;
}

async function pack(workspace: string, artifactPaths: string[]): Promise<Uint8Array> {
  const files: Array<{ path: string; bytes: Uint8Array }> = [];
  for (const path of [...artifactPaths].sort()) {
    const full = resolve(workspace, path);
    const rel = relative(workspace, full);
    if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("ARTIFACT_ESCAPES_WORKSPACE");
    files.push(...await collect(workspace, path));
  }
  const unique = new Map(files.map((file) => [file.path, file.bytes]));
  const payload = [...unique.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([path, bytes]) => ({
    path, sha256: canonicalDigest(bytes), base64: Buffer.from(bytes).toString("base64")
  }));
  return Buffer.from(canonicalJson({ format: "orchestrator-artifact-v1", files: payload }), "utf8");
}

async function runContainer(plan: ContainerHermeticBuildPlan, workspace: string): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(plan.runtime, containerRunArgs(plan, workspace), { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let outputBytes = 0;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, plan.timeoutMs);
    const collect = (chunk: Buffer) => { outputBytes += chunk.length; if (outputBytes > plan.maxOutputBytes) child.kill("SIGKILL"); };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) return reject(new Error("CONTAINER_BUILD_TIMEOUT"));
      if (outputBytes > plan.maxOutputBytes) return reject(new Error("CONTAINER_BUILD_OUTPUT_LIMIT_EXCEEDED"));
      if ((code ?? 1) !== 0) return reject(new Error(`CONTAINER_BUILD_FAILED:${code ?? 1}`));
      resolvePromise();
    });
  });
}

export class ContainerHermeticBuilder implements HermeticBuilder {
  constructor(private readonly plan: ContainerHermeticBuildPlan) { assertPinnedImage(plan.image); }

  async build(vector: BuildInputVector): Promise<BuildArtifact> {
    const workspace = await mkdtemp(join(tmpdir(), "orchestrator-container-"));
    try {
      await cp(resolve(this.plan.sourceDir), workspace, { recursive: true, force: true });
      await runContainer(this.plan, workspace);
      const bytes = await pack(workspace, this.plan.artifactPaths);
      return {
        bytes,
        sbomFp: canonicalDigest({ image: this.plan.image, artifactPaths: this.plan.artifactPaths }),
        provenanceFp: canonicalDigest({ vector, image: this.plan.image, runtime: this.plan.runtime, network: "none", capDrop: "ALL" }),
        builderIdentityFp: canonicalDigest({ builder: "ContainerHermeticBuilder", version: 1, image: this.plan.image })
      };
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }
}
