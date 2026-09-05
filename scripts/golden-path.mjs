#!/usr/bin/env node
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import {
  environmentFingerprint,
  listSourceFiles,
  measureBuildVector,
  sourceFingerprint,
  toolchainFingerprint
} from "../dist/build/tree-fingerprint.js";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const cli = join(repoRoot, "dist", "cli", "main.js");
const moduleRoot = join(repoRoot, "examples", "hello-module");

function digest(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(typeof value === "string" ? value : JSON.stringify(value));
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function treeDigest(root) {
  return sourceFingerprint(await listSourceFiles(root));
}

function run(args, { accept = [0] } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"], env: process.env });
    const out = [];
    const err = [];
    child.stdout.on("data", (chunk) => out.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => err.push(Buffer.from(chunk)));
    child.on("error", reject);
    child.on("close", (code) => {
      const stdout = Buffer.concat(out).toString("utf8");
      const stderr = Buffer.concat(err).toString("utf8");
      if (!accept.includes(code ?? 1)) return reject(new Error(`CLI_FAILED:${code}:${args.join(" ")}\n${stderr}\n${stdout}`));
      resolvePromise({ code: code ?? 1, stdout, stderr });
    });
  });
}

function pem(key, privateKey) {
  return key.export(privateKey ? { type: "pkcs8", format: "pem" } : { type: "spki", format: "pem" });
}

function makeOrder(revision, sourceFp) {
  return {
    taskId: "TASK-HELLO-GOLDEN",
    workspaceId: "WS-HELLO-GOLDEN",
    revision,
    objective: "Build, validate and release the real hello-module reference application",
    scope: { modules: ["hello-module"], allowedPaths: ["examples/hello-module/**"] },
    requiredInputs: [{ uri: "repo://examples/hello-module", digest: sourceFp }],
    capabilities: ["repo.read", "repo.write", "ai.reasoning"],
    budget: { timeSec: 120, costLimit: 0, retries: 1, maxDagDepth: 8 },
    requiredGates: ["unit", "security"],
    expectedEvidence: ["dependency", "security"],
    acceptanceCriteria: ["hello-module builds", "unit and security gates pass", "production artifact equals frozen artifact"],
    failureCriteria: ["build fails", "required gate fails", "artifact identity changes after freeze"],
    securityContractRef: digest("hello-security-contract-v1"),
    performanceContractRef: digest("hello-performance-contract-v1"),
    rollbackRequirement: "REVERSIBLE",
    humanApprovalPolicy: "AUTO_IF_POLICY_PASS",
    policyRef: { policyId: "release-v1", bundleHash: digest("hello-release-policy-v1") }
  };
}

async function sign(root, order, ownerPrivate, revision) {
  const orderPath = join(root, `work-order-r${revision}.json`);
  const signedPath = join(root, `signed-r${revision}.json`);
  await writeFile(orderPath, `${JSON.stringify(order, null, 2)}\n`);
  const plan = await run(["plan", orderPath]);
  const planned = JSON.parse(plan.stdout);
  if (planned.taskId !== order.taskId || planned.revision !== revision) throw new Error("GOLDEN_PLAN_FAILED");
  await run(["sign", orderPath, "--private-key", ownerPrivate, "--key-id", "golden-owner", "--out", signedPath]);
  return JSON.parse(await readFile(signedPath, "utf8"));
}

async function runConfig(signedWorkOrder) {
  const buildPlan = {
    sourceDir: moduleRoot,
    command: process.execPath,
    args: ["build.mjs"],
    artifactPaths: ["dist", "src", "module-manifest.json", "package.json", "tests"],
    timeoutMs: 30000,
    maxOutputBytes: 262144
  };
  const dependencyFp = digest("hello-deps-none");
  const configFp = digest("hello-config-v1");
  const generatedSourcesFp = digest("hello-generated-none");
  const toolchainFp = toolchainFingerprint({ nodeVersion: process.version, builder: "process", command: buildPlan.command, args: buildPlan.args });
  const buildEnvironmentFp = environmentFingerprint({
    platform: process.platform,
    arch: process.arch,
    hermetic: true,
    network: "host-process",
    envAllowList: []
  });
  const measured = await measureBuildVector(moduleRoot, { dependencyFp, configFp, generatedSourcesFp, toolchainFp, buildEnvironmentFp });
  return {
    signedWorkOrder,
    buildVector: measured.vector,
    moduleManifestFp: digest("hello-module-manifest-v1"),
    buildPlan,
    validators: [
      { gate: "unit", kind: "dependency", command: process.execPath, args: ["tests/unit.mjs"], timeoutMs: 10000, validForSeconds: 300 },
      { gate: "security", kind: "security", command: process.execPath, args: ["tests/security.mjs"], dependsOn: ["unit"], timeoutMs: 10000, validForSeconds: 300 }
    ],
    promoteToProduction: true
  };
}

async function executeRevision(root, stateDir, ownerPrivate, ownerPublic, releasePrivate, revision, sourceFp) {
  const signed = await sign(root, makeOrder(revision, sourceFp), ownerPrivate, revision);
  const configPath = join(root, `run-r${revision}.json`);
  await writeFile(configPath, `${JSON.stringify(await runConfig(signed), null, 2)}\n`);
  const response = await run(["run", configPath, "--public-key", ownerPublic, "--release-key", releasePrivate, "--key-id", "golden-owner", "--state-dir", stateDir]);
  const result = JSON.parse(response.stdout);
  if (result.status !== "RELEASED" || result.release?.state !== "PRODUCTION") throw new Error(`GOLDEN_R${revision}_NOT_PRODUCTION`);
  if (result.release.release.manifest.candidateSha !== result.candidate.candidateSha) throw new Error(`GOLDEN_R${revision}_CANDIDATE_MISMATCH`);
  if (result.release.release.manifest.artifactFp !== result.candidate.artifactFp) throw new Error(`GOLDEN_R${revision}_ARTIFACT_MISMATCH`);
  return result;
}

async function main() {
  const root = await mkdtemp(join(tmpdir(), "koordynator-golden-"));
  try {
    const stateDir = join(root, "state");
    const owner = generateKeyPairSync("ed25519");
    const release = generateKeyPairSync("ed25519");
    const ownerPrivate = join(root, "owner-private.pem");
    const ownerPublic = join(root, "owner-public.pem");
    const releasePrivate = join(root, "release-private.pem");
    await writeFile(ownerPrivate, pem(owner.privateKey, true), { mode: 0o600 });
    await writeFile(ownerPublic, pem(owner.publicKey, false), { mode: 0o600 });
    await writeFile(releasePrivate, pem(release.privateKey, true), { mode: 0o600 });

    const sourceFp = await treeDigest(moduleRoot);
    const r0 = await executeRevision(root, stateDir, ownerPrivate, ownerPublic, releasePrivate, 0, sourceFp);
    const r1 = await executeRevision(root, stateDir, ownerPrivate, ownerPublic, releasePrivate, 1, sourceFp);
    if (r0.candidate.candidateSha === r1.candidate.candidateSha) throw new Error("GOLDEN_REVISION_CANDIDATE_COLLISION");

    const status = JSON.parse((await run(["status", "TASK-HELLO-GOLDEN", "--state-dir", stateDir])).stdout);
    if (status.current?.state !== "RELEASED" || status.current?.revision !== 1) throw new Error("GOLDEN_STATUS_FAILED");

    const replay = JSON.parse((await run(["replay", "TASK-HELLO-GOLDEN", "0", "--public-key", ownerPublic, "--state-dir", stateDir])).stdout);
    if (replay.taskId !== "TASK-HELLO-GOLDEN" || replay.revision !== 0) throw new Error("GOLDEN_REPLAY_FAILED");

    const rolled = JSON.parse((await run(["rollback", r1.release.release.releaseSha, "--state-dir", stateDir])).stdout);
    if (rolled.state !== "PRODUCTION" || rolled.release.releaseSha !== r0.release.release.releaseSha) throw new Error("GOLDEN_ROLLBACK_FAILED");
    const releases = JSON.parse((await run(["releases", "--state-dir", stateDir])).stdout);
    if (releases.currentProduction?.release?.releaseSha !== r0.release.release.releaseSha) throw new Error("GOLDEN_ROLLBACK_POINTER_FAILED");

    process.stdout.write(`${JSON.stringify({
      ok: true,
      module: "examples/hello-module",
      sourceFp,
      r0: { candidateSha: r0.candidate.candidateSha, artifactFp: r0.candidate.artifactFp, releaseSha: r0.release.release.releaseSha },
      r1: { candidateSha: r1.candidate.candidateSha, artifactFp: r1.candidate.artifactFp, releaseSha: r1.release.release.releaseSha },
      rolledBackTo: r0.release.release.releaseSha
    })}\n`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
