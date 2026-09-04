import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { canonicalDigest } from "../crypto/canonical-digest.js";
import type { EvidenceKind } from "../domain/work-order.js";
import type { GateName } from "../engine/impact-engine.js";
import type { ValidationContext, Validator, ValidatorResult } from "./validation-dag.js";

export type CommandValidatorSpec = {
  gate: GateName;
  kind: EvidenceKind;
  command: string;
  args: string[];
  dependsOn?: GateName[];
  timeoutMs?: number;
  maxOutputBytes?: number;
  validForSeconds?: number;
  envAllowList?: string[];
};

type PackedArtifact = {
  format: "orchestrator-artifact-v1";
  files: Array<{ path: string; sha256: string; base64: string }>;
};

function safe(path: string): boolean {
  return !!path && !isAbsolute(path) && !path.split(/[\\/]/).includes("..");
}

async function unpackArtifact(bytes: Uint8Array, target: string): Promise<void> {
  const parsed = JSON.parse(Buffer.from(bytes).toString("utf8")) as PackedArtifact;
  if (parsed.format !== "orchestrator-artifact-v1" || !Array.isArray(parsed.files)) throw new Error("ARTIFACT_FORMAT_INVALID");
  for (const file of parsed.files) {
    if (!safe(file.path)) throw new Error("ARTIFACT_PATH_INVALID");
    const data = Buffer.from(file.base64, "base64");
    if (canonicalDigest(data) !== file.sha256) throw new Error(`ARTIFACT_FILE_HASH_MISMATCH:${file.path}`);
    const destination = join(target, file.path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, data, { mode: 0o600 });
  }
}

async function runCommand(spec: CommandValidatorSpec, cwd: string): Promise<number> {
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: cwd, TMPDIR: cwd, ORCHESTRATOR_VALIDATION: "1" };
  for (const key of spec.envAllowList ?? []) if (process.env[key] !== undefined) env[key] = process.env[key];
  return await new Promise((resolve, reject) => {
    const child = spawn(spec.command, spec.args, { cwd, env, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let size = 0;
    let timedOut = false;
    const limit = spec.maxOutputBytes ?? 1024 * 1024;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, spec.timeoutMs ?? 60_000);
    const collect = (chunk: Buffer) => { size += chunk.length; if (size > limit) child.kill("SIGKILL"); };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) return reject(new Error("VALIDATOR_TIMEOUT"));
      if (size > limit) return reject(new Error("VALIDATOR_OUTPUT_LIMIT_EXCEEDED"));
      resolve(code ?? 1);
    });
  });
}

export class ArtifactCommandValidator implements Validator {
  readonly gate: GateName;
  readonly dependsOn?: GateName[];
  constructor(private readonly spec: CommandValidatorSpec) {
    this.gate = spec.gate;
    if (spec.dependsOn !== undefined) this.dependsOn = [...spec.dependsOn];
  }

  async validate(context: ValidationContext): Promise<ValidatorResult> {
    const workspace = await mkdtemp(join(tmpdir(), `orchestrator-validate-${this.gate}-`));
    const testDefinitionFp = canonicalDigest({ gate: this.gate, command: this.spec.command, args: this.spec.args });
    try {
      await unpackArtifact(context.artifactBytes, workspace);
      const code = await runCommand(this.spec, workspace);
      const validUntil = new Date(new Date(context.now).getTime() + (this.spec.validForSeconds ?? 3600) * 1000).toISOString();
      return {
        status: code === 0 ? "PASS" : "FAIL",
        kind: this.spec.kind,
        validUntil,
        testDefinitionFp,
        fixtureFp: canonicalDigest({ artifactFp: context.candidate.artifactFp }),
        validatorVersionFp: canonicalDigest({ validator: "ArtifactCommandValidator", version: 1 })
      };
    } catch {
      return {
        status: "FAIL",
        kind: this.spec.kind,
        validUntil: context.now,
        testDefinitionFp,
        fixtureFp: canonicalDigest({ artifactFp: context.candidate.artifactFp }),
        validatorVersionFp: canonicalDigest({ validator: "ArtifactCommandValidator", version: 1 })
      };
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }
}
