import { spawn } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { KeyObject } from "node:crypto";
import { canonicalDigest } from "../crypto/canonical-digest.js";
import type { Digest } from "../domain/ids.js";
import type { BuildInputVector } from "./build-input.js";
import { artifactFingerprint, buildKey } from "./build-input.js";
import type { BuildArtifact, HermeticBuilder } from "./hermetic-builder.js";
import { packWorkspace } from "./artifact-pack.js";
import { signBuilderAttestation } from "./attestation.js";
import {
  assertVectorMatchesSource,
  environmentFingerprint,
  listSourceFiles,
  toolchainFingerprint
} from "./tree-fingerprint.js";

export type ProcessPlan = {
  kind?: "process";
  sourceDir: string;
  command: string;
  args: string[];
  artifactPaths: string[];
  envAllowList?: string[];
  timeoutMs: number;
  maxOutputBytes: number;
};

export type ContainerPlan = {
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

export type SealedBuildPlan = ProcessPlan | ContainerPlan;

export type SealedBuildReceipt = {
  mode: "process" | "container";
  commandFp: Digest;
  toolchainFp: Digest;
  environmentFp: Digest;
  sourceFp: Digest;
  workspaceFp: Digest;
  artifactFp: Digest;
  sbomFp: Digest;
  exitCode: number;
  stdoutFp: Digest;
  stderrFp: Digest;
};

function assertPinnedImage(image: string): void {
  if (!/@sha256:[a-f0-9]{64}$/i.test(image)) throw new Error("CONTAINER_IMAGE_MUST_BE_PINNED_BY_SHA256");
}

async function runChild(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs: number; maxOutputBytes: number }
): Promise<{ exitCode: number; stdout: Buffer; stderr: Buffer }> {
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.env === undefined ? {} : { env: options.env }),
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let size = 0;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, options.timeoutMs);
    const take = (bucket: Buffer[]) => (chunk: Buffer) => {
      size += chunk.length;
      if (size > options.maxOutputBytes) child.kill("SIGKILL");
      else bucket.push(Buffer.from(chunk));
    };
    child.stdout.on("data", take(stdout));
    child.stderr.on("data", take(stderr));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (size > options.maxOutputBytes) return reject(new Error("BUILD_OUTPUT_LIMIT_EXCEEDED"));
      if (timedOut) return reject(new Error("BUILD_TIMEOUT_OR_KILLED"));
      resolvePromise({ exitCode: code ?? 1, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) });
    });
  });
}

export class SealedHermeticBuilder implements HermeticBuilder {
  lastReceipt?: SealedBuildReceipt;

  constructor(
    private readonly plan: SealedBuildPlan,
    private readonly attestationKey?: KeyObject,
    private readonly attestationKeyId = "builder-default"
  ) {
    if (plan.kind === "container") assertPinnedImage(plan.image);
  }

  async build(vector: BuildInputVector): Promise<BuildArtifact> {
    const sourceDir = resolve(this.plan.sourceDir);
    const sourceFiles = await listSourceFiles(sourceDir);
    assertVectorMatchesSource(vector, sourceFiles);

    const mode = this.plan.kind === "container" ? "container" : "process";
    const toolchainFp = toolchainFingerprint({
      nodeVersion: process.version,
      builder: mode,
      ...(this.plan.kind === "container" ? { image: this.plan.image } : {}),
      command: this.plan.command,
      args: this.plan.args
    });
    if (vector.toolchainFp !== toolchainFp) throw new Error(`TOOLCHAIN_FP_MISMATCH:declared=${vector.toolchainFp}:actual=${toolchainFp}`);

    const envAllowList = this.plan.kind === "container" ? [] : this.plan.envAllowList ?? [];
    const environmentFp = environmentFingerprint({
      platform: process.platform,
      arch: process.arch,
      hermetic: true,
      network: mode === "container" ? "none" : "host-process",
      envAllowList
    });
    if (vector.buildEnvironmentFp !== environmentFp) throw new Error(`ENVIRONMENT_FP_MISMATCH:declared=${vector.buildEnvironmentFp}:actual=${environmentFp}`);

    const workspace = await mkdtemp(join(tmpdir(), `orchestrator-${mode}-`));
    const cwd = join(workspace, "source");
    try {
      await cp(sourceDir, cwd, { recursive: true, force: false, errorOnExist: true });
      const executed = this.plan.kind === "container" ? await this.runContainer(cwd) : await this.runProcess(cwd);
      if (executed.exitCode !== 0) {
        throw new Error(`BUILD_COMMAND_FAILED:${executed.exitCode}:${executed.stderr.toString("utf8").slice(0, 1000)}`);
      }

      const packed = await packWorkspace(cwd, this.plan.artifactPaths);
      const artifactFp = artifactFingerprint(packed.bytes);
      const workspaceAfter = await listSourceFiles(cwd);
      const workspaceFp = canonicalDigest({ kind: "workspace-v1", files: workspaceAfter });
      this.lastReceipt = {
        mode,
        commandFp: canonicalDigest({ command: this.plan.command, args: this.plan.args }),
        toolchainFp,
        environmentFp,
        sourceFp: vector.sourceFp,
        workspaceFp,
        artifactFp,
        sbomFp: packed.sbomFp,
        exitCode: executed.exitCode,
        stdoutFp: canonicalDigest(executed.stdout),
        stderrFp: canonicalDigest(executed.stderr)
      };

      const builderIdentity = {
        builder: "SealedHermeticBuilder",
        version: 2,
        mode,
        ...(this.plan.kind === "container" ? { image: this.plan.image, runtime: this.plan.runtime } : {})
      };
      const builderIdentityFp = canonicalDigest(builderIdentity);
      const provenanceFp = canonicalDigest({
        kind: "build-provenance-v2",
        vector,
        receipt: this.lastReceipt,
        identity: builderIdentity
      });
      const artifact: BuildArtifact = {
        bytes: packed.bytes,
        sbomFp: packed.sbomFp,
        provenanceFp,
        builderIdentityFp
      };

      if (this.attestationKey) {
        artifact.builderAttestation = signBuilderAttestation({
          buildKey: buildKey(vector),
          artifactFp,
          builderIdentityFp,
          sbomFp: packed.sbomFp,
          provenanceFp
        }, this.attestationKeyId, this.attestationKey);
      }
      return artifact;
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }

  private runProcess(cwd: string): Promise<{ exitCode: number; stdout: Buffer; stderr: Buffer }> {
    const plan = this.plan as ProcessPlan;
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: cwd,
      TMPDIR: cwd,
      ORCHESTRATOR_HERMETIC: "1"
    };
    for (const key of plan.envAllowList ?? []) if (process.env[key] !== undefined) env[key] = process.env[key];
    return runChild(plan.command, plan.args, {
      cwd,
      env,
      timeoutMs: plan.timeoutMs,
      maxOutputBytes: plan.maxOutputBytes
    });
  }

  private runContainer(cwd: string): Promise<{ exitCode: number; stdout: Buffer; stderr: Buffer }> {
    const plan = this.plan as ContainerPlan;
    const args = [
      "run", "--rm",
      "--network=none",
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges",
      "--read-only",
      "--tmpfs", "/tmp:rw,noexec,nosuid,size=128m",
      "--workdir", "/workspace",
      "--mount", `type=bind,src=${cwd},dst=/workspace`,
      "--pids-limit", String(plan.pidsLimit ?? 256)
    ];
    if (plan.memoryMb !== undefined) args.push("--memory", `${plan.memoryMb}m`);
    if (plan.cpus !== undefined) args.push("--cpus", String(plan.cpus));
    args.push(plan.image, plan.command, ...plan.args);
    return runChild(plan.runtime, args, {
      timeoutMs: plan.timeoutMs,
      maxOutputBytes: plan.maxOutputBytes
    });
  }
}
