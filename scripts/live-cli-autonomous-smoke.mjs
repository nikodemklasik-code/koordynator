#!/usr/bin/env node
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import {
  environmentFingerprint,
  measureBuildVector,
  toolchainFingerprint
} from "../dist/build/tree-fingerprint.js";
import { canonicalDigest } from "../dist/crypto/canonical-digest.js";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const cli = join(repoRoot, "dist", "cli", "main.js");

if (!process.env.OMNIROUTE_API_KEY?.trim()) {
  throw new Error("OMNIROUTE_API_KEY_REQUIRED");
}

function runCli(args, cwd = repoRoot) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env
    });
    const out = [];
    const err = [];
    child.stdout.on("data", (chunk) => out.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => err.push(Buffer.from(chunk)));
    child.on("error", reject);
    child.on("close", (code) => {
      const stdout = Buffer.concat(out).toString("utf8");
      const stderr = Buffer.concat(err).toString("utf8");
      if (code !== 0) return reject(new Error(`CLI_FAILED:${code}\n${stderr}\n${stdout}`));
      resolvePromise(stdout);
    });
  });
}

function exportPem(key, type) {
  return key.export(type === "private"
    ? { type: "pkcs8", format: "pem" }
    : { type: "spki", format: "pem" });
}

async function main() {
  const root = await mkdtemp(join(tmpdir(), "koord-live-cli-autonomous-"));
  try {
    const sourceDir = join(root, "source");
    const stateDir = join(root, "state");
    await mkdir(sourceDir, { recursive: true });

    await writeFile(
      join(sourceDir, "build.mjs"),
      [
        'import { mkdir, readFile, writeFile } from "node:fs/promises";',
        'const generated = await readFile("src/generated.ts", "utf8");',
        'await mkdir("dist", { recursive: true });',
        'await writeFile("dist/generated.ts", generated, "utf8");',
        ""
      ].join("\n"),
      "utf8"
    );

    const buildPlan = {
      sourceDir,
      command: process.execPath,
      args: ["build.mjs"],
      artifactPaths: ["dist"],
      timeoutMs: 30_000,
      maxOutputBytes: 262_144
    };

    const toolchainFp = toolchainFingerprint({
      nodeVersion: process.version,
      builder: "process",
      command: buildPlan.command,
      args: buildPlan.args
    });
    const buildEnvironmentFp = environmentFingerprint({
      platform: process.platform,
      arch: process.arch,
      hermetic: true,
      network: "host-process",
      envAllowList: []
    });
    const measured = await measureBuildVector(sourceDir, {
      dependencyFp: canonicalDigest("live-autonomous-deps"),
      configFp: canonicalDigest("live-autonomous-config"),
      generatedSourcesFp: canonicalDigest("live-autonomous-generated-none"),
      toolchainFp,
      buildEnvironmentFp
    });

    const prebuild = {
      enabled: true,
      authorityInputUri: "harmonia://prebuild/TASK-LIVE-CLI-AUTONOMOUS",
      instructions: "Zmaterializuj wyłącznie dostarczony materiał. Bez inicjatywy. Jeżeli correction jest obecne, wykonaj je dokładnie w ramach tego samego pliku i zakresu.",
      expectedResult: "Dokładny plik TypeScript przekazany do builda.",
      files: [
        {
          kind: "create",
          path: "src/generated.ts",
          contentContract: "Gdy correction nie jest obecne, treść pliku ma być dokładnie: export const CLI_AUTONOMOUS_VALUE = 1; oraz końcowy znak nowej linii. Gdy correction jest obecne, zastosuj correction dokładnie dla tego samego pliku."
        }
      ],
      qc1: [
        {
          name: "authorized-source-shape",
          command: process.execPath,
          args: [
            "-e",
            "const fs=require('fs');const s=fs.readFileSync('src/generated.ts','utf8');if(s!=='export const CLI_AUTONOMOUS_VALUE = 1;\\n'&&s!=='export const CLI_AUTONOMOUS_VALUE = 2;\\n')process.exit(1)"
          ],
          proposedSolution: "Zapisz dokładnie jedną z autoryzowanych treści dla tego samego pliku.",
          timeoutMs: 10_000
        }
      ],
      defaultModel: "openai/gpt-5.6-sol",
      maxLatencyMs: 120_000,
      telemetryTimeoutMs: 5_000,
      maxAgentCorrections: 1
    };

    const ownerKeys = generateKeyPairSync("ed25519");
    const releaseKeys = generateKeyPairSync("ed25519");
    const executionKeys = generateKeyPairSync("ed25519");
    const ownerPrivate = join(root, "owner-private.pem");
    const ownerPublic = join(root, "owner-public.pem");
    const releasePrivate = join(root, "release-private.pem");
    const executionPrivate = join(root, "execution-private.pem");
    await writeFile(ownerPrivate, exportPem(ownerKeys.privateKey, "private"), { mode: 0o600 });
    await writeFile(ownerPublic, exportPem(ownerKeys.publicKey, "public"), { mode: 0o600 });
    await writeFile(releasePrivate, exportPem(releaseKeys.privateKey, "private"), { mode: 0o600 });
    await writeFile(executionPrivate, exportPem(executionKeys.privateKey, "private"), { mode: 0o600 });

    const autonomousExecution = {
      enabled: true,
      authorityInputUri: "harmonia://autonomous/TASK-LIVE-CLI-AUTONOMOUS",
      delegateKeyId: "brain-execution-live",
      delegatePublicKeyPem: exportPem(executionKeys.publicKey, "public").toString(),
      recoveryCorrections: [
        {
          reason: "FAIL:unit",
          correction: "Dla src/generated.ts zapisz dokładnie: export const CLI_AUTONOMOUS_VALUE = 2; oraz końcowy znak nowej linii. Nie zmieniaj żadnego innego pliku ani zakresu."
        }
      ]
    };

    const prebuildPath = join(root, "prebuild.json");
    const autonomousPath = join(root, "autonomous.json");
    await writeFile(prebuildPath, `${JSON.stringify(prebuild, null, 2)}\n`, "utf8");
    await writeFile(autonomousPath, `${JSON.stringify(autonomousExecution, null, 2)}\n`, "utf8");
    const prebuildFp = (await runCli(["prebuild-fingerprint", prebuildPath])).trim();
    const autonomousFp = (await runCli(["autonomous-fingerprint", autonomousPath])).trim();
    if (!/^sha256:[a-f0-9]{64}$/.test(prebuildFp)) throw new Error("PREBUILD_AUTHORITY_FP_INVALID");
    if (!/^sha256:[a-f0-9]{64}$/.test(autonomousFp)) throw new Error("AUTONOMOUS_AUTHORITY_FP_INVALID");

    const workOrder = {
      taskId: "TASK-LIVE-CLI-AUTONOMOUS",
      workspaceId: "WS-LIVE-CLI-AUTONOMOUS",
      revision: 0,
      objective: "Live delegated autonomous repair through normal orchestrator run",
      scope: { modules: ["live-autonomous"], allowedPaths: ["src/**"] },
      requiredInputs: [
        { uri: prebuild.authorityInputUri, digest: prebuildFp },
        { uri: autonomousExecution.authorityInputUri, digest: autonomousFp }
      ],
      capabilities: ["ai.code", "repo.write"],
      budget: { timeSec: 180, costLimit: 5, retries: 1, maxDagDepth: 4 },
      requiredGates: ["unit"],
      expectedEvidence: ["dependency"],
      acceptanceCriteria: ["revision zero fails unit", "authorized recovery produces revision one", "revision one releases"],
      failureCriteria: ["unsigned correction", "governance drift", "unit gate remains failed"],
      securityContractRef: canonicalDigest("live-autonomous-security"),
      performanceContractRef: canonicalDigest("live-autonomous-performance"),
      rollbackRequirement: "REVERSIBLE",
      humanApprovalPolicy: "AUTO_IF_POLICY_PASS",
      policyRef: { policyId: "live-autonomous-policy", bundleHash: canonicalDigest("live-autonomous-policy-bundle") }
    };

    const orderPath = join(root, "work-order.json");
    const signedPath = join(root, "signed-work-order.json");
    await writeFile(orderPath, `${JSON.stringify(workOrder, null, 2)}\n`, "utf8");
    await runCli(["sign", orderPath, "--private-key", ownerPrivate, "--key-id", "live-owner", "--out", signedPath]);
    const signedWorkOrder = JSON.parse(await readFile(signedPath, "utf8"));

    const runConfig = {
      signedWorkOrder,
      buildVector: measured.vector,
      moduleManifestFp: canonicalDigest("live-autonomous-module-manifest"),
      buildPlan,
      validators: [
        {
          gate: "unit",
          kind: "dependency",
          command: process.execPath,
          args: [
            "-e",
            "const fs=require('fs');if(fs.readFileSync('dist/generated.ts','utf8')!=='export const CLI_AUTONOMOUS_VALUE = 2;\\n')process.exit(1)"
          ],
          timeoutMs: 10_000,
          validForSeconds: 300
        }
      ],
      promoteToProduction: true,
      omniRoutePrebuild: prebuild,
      autonomousExecution
    };

    const runPath = join(root, "run.json");
    await writeFile(runPath, `${JSON.stringify(runConfig, null, 2)}\n`, "utf8");
    const result = JSON.parse(await runCli([
      "run",
      runPath,
      "--public-key",
      ownerPublic,
      "--release-key",
      releasePrivate,
      "--execution-key",
      executionPrivate,
      "--key-id",
      "live-owner",
      "--state-dir",
      stateDir
    ]));

    const materialized = await readFile(join(sourceDir, "src/generated.ts"), "utf8");
    if (materialized !== "export const CLI_AUTONOMOUS_VALUE = 2;\n") throw new Error("LIVE_AUTONOMOUS_SOURCE_MISMATCH");
    if (result.status !== "RELEASED") throw new Error(`LIVE_AUTONOMOUS_NOT_RELEASED:${result.status}`);
    if (result.release?.state !== "PRODUCTION") throw new Error("LIVE_AUTONOMOUS_NOT_PRODUCTION");
    if (result.candidate?.revision !== 1) throw new Error(`LIVE_AUTONOMOUS_RETRY_NOT_PROVEN:${result.candidate?.revision}`);

    process.stdout.write(`${JSON.stringify({
      ok: true,
      status: result.status,
      releaseState: result.release.state,
      taskId: result.candidate.taskId,
      revision: result.candidate.revision,
      autonomousRepairProven: true,
      sourceExact: true,
      key: "***"
    }, null, 2)}\n`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
