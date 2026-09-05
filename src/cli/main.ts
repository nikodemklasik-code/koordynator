#!/usr/bin/env node
import { createPrivateKey, createPublicKey, sign as cryptoSign } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { canonicalDigest } from "../crypto/canonical-digest.js";
import { validateWorkOrder, type WorkOrder } from "../domain/work-order.js";
import type { Digest } from "../domain/ids.js";
import { signWorkOrder, type SignedWorkOrder } from "../security/work-order-signature.js";
import { FileStateStore } from "../store/file-state-store.js";
import { FileSignedWorkOrderStore } from "../store/work-order-store.js";
import { FileTaskExecutionStore } from "../store/task-execution-store.js";
import { FileArtifactRegistry } from "../build/file-artifact-registry.js";
import { ProcessHermeticBuilder, type HermeticBuildPlan } from "../build/process-hermetic-builder.js";
import type { BuildInputVector } from "../build/build-input.js";
import { ArtifactCommandValidator, type CommandValidatorSpec } from "../validators/command-validator.js";
import { FileReleaseStore } from "../release/file-release-store.js";
import { ReleaseController } from "../release/release-controller.js";
import { OrchestratorRuntime } from "../orchestrator/orchestrator.js";
import { OfficialCliProviderAdapter, officialSubscriptionLaunchSpecs } from "../api/official-cli-adapter.js";
import { generateModule } from "../module/module-factory.js";

const VERSION = "0.2.0";

type RunConfig = {
  signedWorkOrder: SignedWorkOrder;
  buildVector: BuildInputVector;
  moduleManifestFp: Digest;
  buildPlan: HermeticBuildPlan;
  validators: CommandValidatorSpec[];
  humanApprovalFp?: Digest;
  promoteToProduction?: boolean;
};

function parseFlags(args: string[]): { positional: string[]; flags: Map<string, string | true> } {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (!arg.startsWith("--")) { positional.push(arg); continue; }
    const next = args[i + 1];
    if (next !== undefined && !next.startsWith("--")) { flags.set(arg.slice(2), next); i += 1; }
    else flags.set(arg.slice(2), true);
  }
  return { positional, flags };
}

function requiredFlag(flags: Map<string, string | true>, name: string): string {
  const value = flags.get(name);
  if (typeof value !== "string") throw new Error(`MISSING_FLAG:--${name}`);
  return value;
}

function stateDir(flags: Map<string, string | true>): string {
  const value = flags.get("state-dir");
  return resolve(typeof value === "string" ? value : ".orchestrator");
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

function resolveFrom(baseFile: string, path: string): string {
  return isAbsolute(path) ? path : resolve(dirname(baseFile), path);
}

async function commandSign(positional: string[], flags: Map<string, string | true>): Promise<void> {
  const source = positional[0];
  if (!source) throw new Error("USAGE:orchestrator sign <work-order.json> --private-key <pem> --key-id <id> --out <signed.json>");
  const order = await readJson<WorkOrder>(resolve(source));
  validateWorkOrder(order);
  const privateKey = createPrivateKey(await readFile(resolve(requiredFlag(flags, "private-key")), "utf8"));
  const signed = signWorkOrder(order, requiredFlag(flags, "key-id"), privateKey);
  const output = resolve(requiredFlag(flags, "out"));
  await writeFile(output, `${JSON.stringify(signed, null, 2)}\n`, "utf8");
  process.stdout.write(`${output}\n`);
}

async function commandPlan(positional: string[]): Promise<void> {
  const source = positional[0];
  if (!source) throw new Error("USAGE:orchestrator plan <work-order.json>");
  const order = await readJson<WorkOrder>(resolve(source));
  validateWorkOrder(order);
  process.stdout.write(`${JSON.stringify({ taskId: order.taskId, revision: order.revision, workOrderFp: canonicalDigest(order), requiredGates: order.requiredGates }, null, 2)}\n`);
}

async function commandRun(positional: string[], flags: Map<string, string | true>): Promise<void> {
  const source = positional[0];
  if (!source) throw new Error("USAGE:orchestrator run <run.json> --public-key <pem> --release-key <pem> [--state-dir <dir>]");
  const configPath = resolve(source);
  const config = await readJson<RunConfig>(configPath);
  config.buildPlan = { ...config.buildPlan, sourceDir: resolveFrom(configPath, config.buildPlan.sourceDir) };

  const publicKey = createPublicKey(await readFile(resolve(requiredFlag(flags, "public-key")), "utf8"));
  const releasePrivateKey = createPrivateKey(await readFile(resolve(requiredFlag(flags, "release-key")), "utf8"));
  const root = stateDir(flags);
  const clock = () => new Date().toISOString();
  const releaseController = new ReleaseController(
    new FileReleaseStore(join(root, "release")),
    (digest) => ({ signatureFp: canonicalDigest(cryptoSign(null, Buffer.from(digest, "utf8"), releasePrivateKey).toString("base64")) }),
    clock
  );

  const runtime = new OrchestratorRuntime(
    new FileStateStore(join(root, "state")),
    new FileArtifactRegistry(join(root, "artifacts")),
    new ProcessHermeticBuilder(config.buildPlan),
    config.validators.map((spec) => new ArtifactCommandValidator(spec)),
    releaseController,
    (keyId) => {
      const expected = flags.get("key-id");
      if (typeof expected === "string" && expected !== keyId) throw new Error("WORK_ORDER_KEY_ID_MISMATCH");
      return publicKey;
    },
    clock,
    undefined,
    new FileSignedWorkOrderStore(join(root, "work-orders")),
    new FileTaskExecutionStore(join(root, "executions"))
  );

  const result = await runtime.run({
    signedWorkOrder: config.signedWorkOrder,
    buildVector: config.buildVector,
    moduleManifestFp: config.moduleManifestFp,
    ...(config.humanApprovalFp === undefined ? {} : { humanApprovalFp: config.humanApprovalFp }),
    ...(config.promoteToProduction === undefined ? {} : { promoteToProduction: config.promoteToProduction })
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status === "RETURNED") process.exitCode = 2;
  if (result.status === "AWAITING_HUMAN_APPROVAL") process.exitCode = 3;
}

async function commandStatus(positional: string[], flags: Map<string, string | true>): Promise<void> {
  const taskId = positional[0];
  if (!taskId?.startsWith("TASK-")) throw new Error("USAGE:orchestrator status TASK-... [--state-dir <dir>]");
  const store = new FileStateStore(join(stateDir(flags), "state"));
  const current = await store.load(taskId as `TASK-${string}`);
  const history = await store.history(taskId as `TASK-${string}`);
  process.stdout.write(`${JSON.stringify({ current, history }, null, 2)}\n`);
}

async function commandReplay(positional: string[], flags: Map<string, string | true>): Promise<void> {
  const taskId = positional[0];
  const revision = Number(positional[1]);
  if (!taskId?.startsWith("TASK-") || !Number.isInteger(revision) || revision < 0) throw new Error("USAGE:orchestrator replay TASK-... <revision> --public-key <pem> [--state-dir <dir>]");
  const publicKey = createPublicKey(await readFile(resolve(requiredFlag(flags, "public-key")), "utf8"));
  const receipt = await new FileSignedWorkOrderStore(join(stateDir(flags), "work-orders")).replay(taskId as `TASK-${string}`, revision, () => publicKey);
  process.stdout.write(`${JSON.stringify(receipt.receipt, null, 2)}\n`);
}

async function commandReleases(flags: Map<string, string | true>): Promise<void> {
  const store = new FileReleaseStore(join(stateDir(flags), "release"));
  process.stdout.write(`${JSON.stringify({ currentProduction: await store.currentProduction(), releases: await store.all() }, null, 2)}\n`);
}

async function commandRollback(positional: string[], flags: Map<string, string | true>): Promise<void> {
  const sha = positional[0] as Digest | undefined;
  if (!sha?.startsWith("sha256:")) throw new Error("USAGE:orchestrator rollback sha256:... [--state-dir <dir>]");
  const controller = new ReleaseController(new FileReleaseStore(join(stateDir(flags), "release")), (digest) => ({ signatureFp: canonicalDigest(digest) }), () => new Date().toISOString());
  process.stdout.write(`${JSON.stringify(await controller.rollback(sha), null, 2)}\n`);
}

async function commandProvider(positional: string[]): Promise<void> {
  const action = positional[0] ?? "list";
  const specs = officialSubscriptionLaunchSpecs();
  if (action === "list") {
    process.stdout.write(`${JSON.stringify(specs.map((spec) => spec.descriptor), null, 2)}\n`);
    return;
  }
  if (action === "doctor") {
    const results = [];
    for (const spec of specs) results.push({ providerId: spec.descriptor.providerId, executable: spec.executable, health: await new OfficialCliProviderAdapter(spec).health() });
    process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
    if (results.some((result) => result.health === "BLOCKED" || result.health === "DEGRADED" || result.health === "AUTH_REQUIRED")) process.exitCode = 4;
    return;
  }
  if (action === "connect") {
    const providerId = positional[1];
    const spec = specs.find((candidate) => candidate.descriptor.providerId === providerId);
    if (!spec) throw new Error("UNKNOWN_PROVIDER_ID");
    await new OfficialCliProviderAdapter(spec).connect();
    process.stdout.write(`${providerId}:OFFICIAL_AUTH_FLOW_STARTED\n`);
    return;
  }
  throw new Error("USAGE:orchestrator provider <list|doctor|connect PROVIDER_ID>");
}

async function commandModule(positional: string[], flags: Map<string, string | true>): Promise<void> {
  const action = positional[0];
  const target = positional[1];
  if (action !== "create" || !target) throw new Error("USAGE:orchestrator module create <target-dir> --id <module-id> [--capabilities a,b]");
  const capabilitiesFlag = flags.get("capabilities");
  const capabilities = typeof capabilitiesFlag === "string" ? capabilitiesFlag.split(",") : ["core.echo"];
  const generated = await generateModule({ moduleId: requiredFlag(flags, "id"), targetDir: resolve(target), capabilities });
  process.stdout.write(`${JSON.stringify(generated, null, 2)}\n`);
}

function help(): void {
  process.stdout.write(`koordynator-orchestrator ${VERSION}\n\nCommands:\n  plan <work-order.json>\n  sign <work-order.json> --private-key <pem> --key-id <id> --out <file>\n  run <run.json> --public-key <pem> --release-key <pem> [--key-id <id>] [--state-dir <dir>]\n  status TASK-... [--state-dir <dir>]\n  replay TASK-... <revision> --public-key <pem> [--state-dir <dir>]\n  releases [--state-dir <dir>]\n  rollback sha256:... [--state-dir <dir>]\n  module create <target-dir> --id <module-id> [--capabilities a,b]\n  provider list\n  provider doctor\n  provider connect PROVIDER_ID\n  version\n`);
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseFlags(rest);
  if (!command || command === "help" || command === "--help") return help();
  if (command === "version" || command === "--version") { process.stdout.write(`${VERSION}\n`); return; }
  if (command === "plan") return commandPlan(positional);
  if (command === "sign") return commandSign(positional, flags);
  if (command === "run") return commandRun(positional, flags);
  if (command === "status") return commandStatus(positional, flags);
  if (command === "replay") return commandReplay(positional, flags);
  if (command === "releases") return commandReleases(flags);
  if (command === "rollback") return commandRollback(positional, flags);
  if (command === "provider") return commandProvider(positional);
  if (command === "module") return commandModule(positional, flags);
  throw new Error(`UNKNOWN_COMMAND:${command}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
