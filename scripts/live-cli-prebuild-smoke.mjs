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
  const root = await mkdtemp(join(tmpdir(), "koord-live-cli-prebuild-"));
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
      dependencyFp: canonicalDigest("live-cli-deps"),
      configFp: canonicalDigest("live-cli-config"),
      generatedSourcesFp: canonicalDigest("live-cli-generated-none"),
      toolchainFp,
      buildEnvironmentFp
    });

    const prebuild = {
      enabled: true,
      authorityInputUri: "harmonia://prebuild/TASK-LIVE-CLI-PREBUILD",
      instructions: "Zmaterializuj wyłącznie dostarczony materiał. Bez inicjatywy.",
      expectedResult: "Dokładny plik TypeScript przekazany do builda.",
      files: [
        {
          kind: "create",
          path: "src/generated.ts",
          contentContract: "Treść pliku ma być dokładnie: export const CLI_RUN_OMNIROUTE_OK = true; oraz końcowy znak nowej linii."
        }
      ],
      qc1: [
        {
          name: "exact-source",
          command: process.execPath,
          args: [
            "-e",
            "const fs=require('fs');if(fs.readFileSync('src/generated.ts','utf8')!=='export const CLI_RUN_OMNIROUTE_OK = true;\\n')process.exit(1)"
          ],
          proposedSolution: "Zapisz dokładnie treść wskazaną przez kontrakt Harmonii.",
          timeoutMs: 10_000
        }
      ],
      defaultModel: "openai/gpt-5.6-sol",
      maxLatencyMs: 120_000,
      telemetryTimeoutMs: 5_000,
      maxAgentCorrections: 2
    };

    const prebuildPath = join(root, "prebuild.json");
    await writeFile(prebuildPath, `${JSON.stringify(prebuild, null, 2)}\n`, "utf8");
    const authorityFp = (await runCli(["prebuild-fingerprint", prebuildPath])).trim();
    if (!/^sha256:[a-f0-9]{64}$/.test(authorityFp)) throw new Error("PREBUILD_AUTHORITY_FP_INVALID");

    const workOrder = {
      taskId: "TASK-LIVE-CLI-PREBUILD",
      workspaceId: "WS-LIVE-CLI-PREBUILD",
      revision: 0,
      objective: "Live CLI exact-pack prebuild through OmniRoute",
      scope: { modules: ["live-cli"], allowedPaths: ["src/**"] },
      requiredInputs: [{ uri: prebuild.authorityInputUri, digest: authorityFp }],
      capabilities: ["ai.code", "repo.write"],
      budget: { timeSec: 120, costLimit: 5, retries: 1, maxDagDepth: 4 },
      requiredGates: ["unit"],
      expectedEvidence: ["dependency"],
      acceptanceCriteria: ["prebuild is one/one", "artifact contains the exact generated file"],
      failureCriteria: ["source differs from contract", "validator fails"],
      securityContractRef: canonicalDigest("live-cli-security"),
      performanceContractRef: canonicalDigest("live-cli-performance"),
      rollbackRequirement: "REVERSIBLE",
      humanApprovalPolicy: "AUTO_IF_POLICY_PASS",
      policyRef: { policyId: "live-cli-policy", bundleHash: canonicalDigest("live-cli-policy-bundle") }
    };

    const ownerKeys = generateKeyPairSync("ed25519");
    const releaseKeys = generateKeyPairSync("ed25519");
    const ownerPrivate = join(root, "owner-private.pem");
    const ownerPublic = join(root, "owner-public.pem");
    const releasePrivate = join(root, "release-private.pem");
    await writeFile(ownerPrivate, exportPem(ownerKeys.privateKey, "private"), { mode: 0o600 });
    await writeFile(ownerPublic, exportPem(ownerKeys.publicKey, "public"), { mode: 0o600 });
    await writeFile(releasePrivate, exportPem(releaseKeys.privateKey, "private"), { mode: 0o600 });

    const orderPath = join(root, "work-order.json");
    const signedPath = join(root, "signed-work-order.json");
    await writeFile(orderPath, `${JSON.stringify(workOrder, null, 2)}\n`, "utf8");
    await runCli(["sign", orderPath, "--private-key", ownerPrivate, "--key-id", "live-owner", "--out", signedPath]);
    const signedWorkOrder = JSON.parse(await readFile(signedPath, "utf8"));

    const runConfig = {
      signedWorkOrder,
      buildVector: measured.vector,
      moduleManifestFp: canonicalDigest("live-cli-module-manifest"),
      buildPlan,
      validators: [
        {
          gate: "unit",
          kind: "dependency",
          command: process.execPath,
          args: [
            "-e",
            "const fs=require('fs');if(fs.readFileSync('dist/generated.ts','utf8')!=='export const CLI_RUN_OMNIROUTE_OK = true;\\n')process.exit(1)"
          ],
          timeoutMs: 10_000,
          validForSeconds: 300
        }
      ],
      promoteToProduction: true,
      omniRoutePrebuild: prebuild
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
      "--key-id",
      "live-owner",
      "--state-dir",
      stateDir
    ]));

    const materialized = await readFile(join(sourceDir, "src/generated.ts"), "utf8");
    if (materialized !== "export const CLI_RUN_OMNIROUTE_OK = true;\n") throw new Error("LIVE_CLI_SOURCE_MISMATCH");
    if (result.status !== "RELEASED") throw new Error(`LIVE_CLI_NOT_RELEASED:${result.status}`);
    if (result.release?.state !== "PRODUCTION") throw new Error("LIVE_CLI_NOT_PRODUCTION");

    process.stdout.write(`${JSON.stringify({
      ok: true,
      status: result.status,
      releaseState: result.release.state,
      taskId: result.candidate.taskId,
      revision: result.candidate.revision,
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
