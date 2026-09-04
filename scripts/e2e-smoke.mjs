#!/usr/bin/env node
import { generateKeyPairSync, createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const cli = join(repoRoot, "dist", "cli", "main.js");

function digest(value) {
  return `sha256:${createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex")}`;
}

function run(args, cwd = repoRoot) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd, stdio: ["ignore", "pipe", "pipe"], env: process.env });
    const out = [];
    const err = [];
    child.stdout.on("data", (chunk) => out.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => err.push(Buffer.from(chunk)));
    child.on("error", reject);
    child.on("close", (code) => {
      const stdout = Buffer.concat(out).toString("utf8");
      const stderr = Buffer.concat(err).toString("utf8");
      if (code !== 0) return reject(new Error(`CLI_FAILED:${code}:${args.join(" ")}\n${stderr}\n${stdout}`));
      resolvePromise(stdout);
    });
  });
}

function exportPem(key, type) {
  return key.export(type === "private"
    ? { type: "pkcs8", format: "pem" }
    : { type: "spki", format: "pem" });
}

function workOrder(revision, sourceFp) {
  const policyFp = digest("release-policy-v1");
  return {
    taskId: "TASK-E2E-SMOKE",
    workspaceId: "WS-E2E-SMOKE",
    revision,
    objective: "Build validate and release a deterministic smoke artifact",
    scope: { modules: ["smoke-app"], allowedPaths: ["**/*"] },
    requiredInputs: [{ uri: "smoke://source", digest: sourceFp }],
    capabilities: ["repo.read", "repo.write"],
    budget: { timeSec: 120, costLimit: 0, retries: 1, maxDagDepth: 8 },
    requiredGates: ["unit", "security"],
    expectedEvidence: ["dependency", "security"],
    acceptanceCriteria: ["artifact builds", "validators pass", "exact artifact is promoted"],
    failureCriteria: ["build fails", "validator fails", "release artifact mismatch"],
    securityContractRef: digest("security-contract-v1"),
    performanceContractRef: digest("performance-contract-v1"),
    rollbackRequirement: "REVERSIBLE",
    humanApprovalPolicy: "AUTO_IF_POLICY_PASS",
    policyRef: { policyId: "release-v1", bundleHash: policyFp }
  };
}

async function makeRunConfig(root, revision, version, signedWorkOrder) {
  const sourceDir = join(root, `source-r${revision}`);
  await mkdir(sourceDir, { recursive: true });
  await writeFile(join(sourceDir, "build.mjs"), `import { mkdir, writeFile } from "node:fs/promises";\nawait mkdir("dist", { recursive: true });\nawait writeFile("dist/app.json", JSON.stringify({name:"smoke-app",version:${version}}));\n`, "utf8");
  const sourceFp = digest(`source-${version}`);
  const policyFp = digest("release-policy-v1");
  return {
    signedWorkOrder,
    buildVector: {
      sourceFp,
      dependencyFp: digest("deps-none"),
      configFp: digest("config-v1"),
      toolchainFp: digest(`node-${process.versions.node}`),
      buildEnvironmentFp: digest(`${process.platform}-${process.arch}`),
      generatedSourcesFp: digest("generated-none")
    },
    moduleManifestFp: digest("smoke-module-manifest-v1"),
    buildPlan: {
      sourceDir,
      command: process.execPath,
      args: ["build.mjs"],
      artifactPaths: ["dist"],
      timeoutMs: 30000,
      maxOutputBytes: 262144
    },
    validators: [
      {
        gate: "unit",
        kind: "dependency",
        command: process.execPath,
        args: ["-e", `const fs=require('fs');const x=JSON.parse(fs.readFileSync('dist/app.json','utf8'));if(x.name!=='smoke-app'||x.version!==${version})process.exit(2);`],
        timeoutMs: 10000,
        validForSeconds: 300
      },
      {
        gate: "security",
        kind: "security",
        command: process.execPath,
        args: ["-e", "const fs=require('fs');const s=fs.readFileSync('dist/app.json','utf8');if(/token|secret|password/i.test(s))process.exit(3);"],
        dependsOn: ["unit"],
        timeoutMs: 10000,
        validForSeconds: 300
      }
    ],
    promoteToProduction: true,
    policyFp
  };
}

async function signOrder(root, order, privateKeyPath, revision) {
  const orderPath = join(root, `work-order-r${revision}.json`);
  const signedPath = join(root, `signed-r${revision}.json`);
  await writeFile(orderPath, `${JSON.stringify(order, null, 2)}\n`, "utf8");
  await run(["sign", orderPath, "--private-key", privateKeyPath, "--key-id", "e2e-owner", "--out", signedPath]);
  return JSON.parse(await readFile(signedPath, "utf8"));
}

async function main() {
  const root = await mkdtemp(join(tmpdir(), "orchestrator-e2e-"));
  try {
    const stateDir = join(root, "state");
    const ownerKeys = generateKeyPairSync("ed25519");
    const releaseKeys = generateKeyPairSync("ed25519");
    const ownerPrivate = join(root, "owner-private.pem");
    const ownerPublic = join(root, "owner-public.pem");
    const releasePrivate = join(root, "release-private.pem");
    await writeFile(ownerPrivate, exportPem(ownerKeys.privateKey, "private"), { mode: 0o600 });
    await writeFile(ownerPublic, exportPem(ownerKeys.publicKey, "public"), { mode: 0o600 });
    await writeFile(releasePrivate, exportPem(releaseKeys.privateKey, "private"), { mode: 0o600 });

    const sourceFp1 = digest("source-1");
    const signed1 = await signOrder(root, workOrder(0, sourceFp1), ownerPrivate, 0);
    const run1 = await makeRunConfig(root, 0, 1, signed1);
    const run1Path = join(root, "run-r0.json");
    await writeFile(run1Path, `${JSON.stringify(run1, null, 2)}\n`, "utf8");
    const result1 = JSON.parse(await run(["run", run1Path, "--public-key", ownerPublic, "--release-key", releasePrivate, "--key-id", "e2e-owner", "--state-dir", stateDir]));
    if (result1.status !== "RELEASED" || result1.release?.state !== "PRODUCTION") throw new Error("E2E_FIRST_RELEASE_NOT_PRODUCTION");
    if (result1.release.release.manifest.artifactFp !== result1.candidate.artifactFp) throw new Error("E2E_FIRST_ARTIFACT_MISMATCH");
    const firstReleaseSha = result1.release.release.releaseSha;

    const sourceFp2 = digest("source-2");
    const signed2 = await signOrder(root, workOrder(1, sourceFp2), ownerPrivate, 1);
    const run2 = await makeRunConfig(root, 1, 2, signed2);
    const run2Path = join(root, "run-r1.json");
    await writeFile(run2Path, `${JSON.stringify(run2, null, 2)}\n`, "utf8");
    const result2 = JSON.parse(await run(["run", run2Path, "--public-key", ownerPublic, "--release-key", releasePrivate, "--key-id", "e2e-owner", "--state-dir", stateDir]));
    if (result2.status !== "RELEASED" || result2.release?.state !== "PRODUCTION") throw new Error("E2E_SECOND_RELEASE_NOT_PRODUCTION");
    if (result2.candidate.candidateSha === result1.candidate.candidateSha) throw new Error("E2E_REVISION_DID_NOT_CHANGE_CANDIDATE");

    const status = JSON.parse(await run(["status", "TASK-E2E-SMOKE", "--state-dir", stateDir]));
    if (status.current?.state !== "RELEASED" || status.current?.revision !== 1) throw new Error("E2E_STATUS_NOT_RELEASED_R1");

    const replay = JSON.parse(await run(["replay", "TASK-E2E-SMOKE", "0", "--public-key", ownerPublic, "--state-dir", stateDir]));
    if (replay.taskId !== "TASK-E2E-SMOKE" || replay.revision !== 0) throw new Error("E2E_REPLAY_FAILED");

    const rolledBack = JSON.parse(await run(["rollback", firstReleaseSha, "--state-dir", stateDir]));
    if (rolledBack.state !== "PRODUCTION" || rolledBack.release.releaseSha !== firstReleaseSha) throw new Error("E2E_ROLLBACK_FAILED");

    const releases = JSON.parse(await run(["releases", "--state-dir", stateDir]));
    if (releases.currentProduction?.release?.releaseSha !== firstReleaseSha) throw new Error("E2E_PRODUCTION_POINTER_NOT_ROLLED_BACK");

    process.stdout.write(JSON.stringify({
      ok: true,
      firstCandidateSha: result1.candidate.candidateSha,
      secondCandidateSha: result2.candidate.candidateSha,
      rolledBackTo: firstReleaseSha
    }) + "\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
