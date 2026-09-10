import { createHash, createPublicKey, type KeyObject } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { canonicalDigest } from "../crypto/canonical-digest.js";
import type { Digest } from "../domain/ids.js";
import { signWorkOrder, type SignedWorkOrder } from "../security/work-order-signature.js";
import type {
  AutonomousRecoveryContext,
  AutonomousRecoveryDecision,
  AutonomousRunRecovery
} from "../orchestrator/autonomous-orchestrator.js";
import type { OrchestratorRunRequest, OrchestratorRunResult } from "../orchestrator/orchestrator.js";
import type { HarmoniaExactPackFileDirective } from "../orchestrator/omniroute-exact-pack-source.js";
import {
  assertCliOmniRoutePrebuildAuthority,
  createCliOmniRoutePrebuildPipeline,
  type CliOmniRoutePrebuildConfig
} from "./omniroute-prebuild-runner.js";

export type CliAutonomousRecoveryCorrection = {
  reason: string;
  correction: string;
};

export type CliAutonomousExecutionConfig = {
  enabled: true;
  authorityInputUri: string;
  delegateKeyId: string;
  delegatePublicKeyPem: string;
  recoveryCorrections: CliAutonomousRecoveryCorrection[];
};

export type CliDelegatedAutonomousRecoveryOptions = {
  sourceDir: string;
  prebuild: Readonly<CliOmniRoutePrebuildConfig>;
  authority: Readonly<CliAutonomousExecutionConfig>;
  delegatePrivateKey: KeyObject;
  fetchImpl?: typeof fetch;
};

function publicKeySpkiDigest(key: KeyObject): Digest {
  const publicKey = key.type === "public" ? key : createPublicKey(key);
  const der = publicKey.export({ type: "spki", format: "der" });
  return canonicalDigest({
    kind: "delegated-execution-public-key-v1",
    spkiBase64: Buffer.from(der).toString("base64")
  });
}

function configPublicKey(config: Readonly<CliAutonomousExecutionConfig>): KeyObject {
  try {
    return createPublicKey(config.delegatePublicKeyPem);
  } catch {
    throw new Error("CLI_AUTONOMOUS_DELEGATE_PUBLIC_KEY_INVALID");
  }
}

function normalizedCorrections(corrections: readonly CliAutonomousRecoveryCorrection[]) {
  return corrections
    .map((item) => ({ reason: item.reason.trim(), correction: item.correction.trim() }))
    .sort((left, right) => left.reason.localeCompare(right.reason));
}

function validate(config: Readonly<CliAutonomousExecutionConfig>): void {
  if (config.enabled !== true) throw new Error("CLI_AUTONOMOUS_ENABLED_REQUIRED");
  if (!config.authorityInputUri.trim()) throw new Error("CLI_AUTONOMOUS_AUTHORITY_URI_REQUIRED");
  if (!config.delegateKeyId.trim()) throw new Error("CLI_AUTONOMOUS_DELEGATE_KEY_ID_REQUIRED");
  configPublicKey(config);
  if (!Array.isArray(config.recoveryCorrections) || config.recoveryCorrections.length === 0) {
    throw new Error("CLI_AUTONOMOUS_RECOVERY_CORRECTIONS_REQUIRED");
  }
  const seen = new Set<string>();
  for (const item of config.recoveryCorrections) {
    const reason = item.reason.trim();
    if (!reason) throw new Error("CLI_AUTONOMOUS_RECOVERY_REASON_REQUIRED");
    if (!item.correction.trim()) throw new Error(`CLI_AUTONOMOUS_RECOVERY_CORRECTION_REQUIRED:${reason}`);
    if (seen.has(reason)) throw new Error(`CLI_AUTONOMOUS_RECOVERY_REASON_DUPLICATE:${reason}`);
    seen.add(reason);
  }
}

export function cliAutonomousExecutionAuthorityFingerprint(
  config: Readonly<CliAutonomousExecutionConfig>
): Digest {
  validate(config);
  return canonicalDigest({
    kind: "cli-autonomous-execution-authority-v1",
    authorityInputUri: config.authorityInputUri,
    delegateKeyId: config.delegateKeyId,
    delegatePublicKeyFp: publicKeySpkiDigest(configPublicKey(config)),
    recoveryCorrections: normalizedCorrections(config.recoveryCorrections)
  });
}

export function assertCliAutonomousExecutionAuthority(
  signedWorkOrder: Readonly<SignedWorkOrder>,
  config: Readonly<CliAutonomousExecutionConfig>
): void {
  const expected = cliAutonomousExecutionAuthorityFingerprint(config);
  const authority = signedWorkOrder.order.requiredInputs.find((input) => input.uri === config.authorityInputUri);
  if (authority === undefined) throw new Error("CLI_AUTONOMOUS_AUTHORITY_INPUT_MISSING");
  if (authority.digest !== expected) {
    throw new Error(`CLI_AUTONOMOUS_AUTHORITY_MISMATCH:expected=${authority.digest}:actual=${expected}`);
  }
}

export function delegatedExecutionPublicKey(config: Readonly<CliAutonomousExecutionConfig>): KeyObject {
  validate(config);
  return configPublicKey(config);
}

export function assertDelegatedExecutionPrivateKey(
  config: Readonly<CliAutonomousExecutionConfig>,
  privateKey: KeyObject
): void {
  validate(config);
  if (privateKey.type !== "private") throw new Error("CLI_AUTONOMOUS_DELEGATE_PRIVATE_KEY_REQUIRED");
  if (publicKeySpkiDigest(privateKey) !== publicKeySpkiDigest(configPublicKey(config))) {
    throw new Error("CLI_AUTONOMOUS_DELEGATE_KEY_MISMATCH");
  }
}

function rawDigest(bytes: Buffer): Digest {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function resolveInside(root: string, relativePath: string): string {
  const base = resolve(root);
  const full = resolve(base, relativePath);
  if (!full.startsWith(`${base}${sep}`)) throw new Error(`CLI_AUTONOMOUS_RECOVERY_PATH_ESCAPE:${relativePath}`);
  return full;
}

async function recoveryFiles(
  sourceDir: string,
  files: readonly HarmoniaExactPackFileDirective[]
): Promise<HarmoniaExactPackFileDirective[]> {
  const recovered: HarmoniaExactPackFileDirective[] = [];
  for (const file of files) {
    const full = resolveInside(sourceDir, file.path);
    let current: Buffer;
    try {
      current = await readFile(full);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") throw new Error(`CLI_AUTONOMOUS_RECOVERY_TARGET_MISSING:${file.path}`);
      throw error;
    }
    recovered.push({
      kind: "replace",
      path: file.path,
      beforeFp: rawDigest(current),
      contentContract: file.contentContract
    });
  }
  return recovered;
}

function correctionFor(
  context: Readonly<AutonomousRecoveryContext>,
  config: Readonly<CliAutonomousExecutionConfig>
): string | undefined {
  const table = new Map(normalizedCorrections(config.recoveryCorrections).map((entry) => [entry.reason, entry.correction]));
  for (const reason of context.result.reasons ?? []) {
    const correction = table.get(reason);
    if (correction) return correction;
  }
  return undefined;
}

function nextSignedRequest(
  context: Readonly<AutonomousRecoveryContext>,
  config: Readonly<CliAutonomousExecutionConfig>,
  privateKey: KeyObject
): OrchestratorRunRequest {
  const nextRevision = context.result.nextRevision ?? context.request.signedWorkOrder.order.revision + 1;
  const nextOrder = structuredClone(context.request.signedWorkOrder.order);
  nextOrder.revision = nextRevision;
  return {
    signedWorkOrder: signWorkOrder(nextOrder, config.delegateKeyId, privateKey),
    buildVector: { ...context.request.buildVector },
    moduleManifestFp: context.request.moduleManifestFp,
    ...(context.request.humanApprovalFp === undefined ? {} : { humanApprovalFp: context.request.humanApprovalFp }),
    ...(context.request.promoteToProduction === undefined ? {} : { promoteToProduction: context.request.promoteToProduction })
  };
}

export class CliDelegatedAutonomousRecovery implements AutonomousRunRecovery {
  constructor(private readonly options: CliDelegatedAutonomousRecoveryOptions) {
    validate(options.authority);
    assertDelegatedExecutionPrivateKey(options.authority, options.delegatePrivateKey);
  }

  async recover(context: Readonly<AutonomousRecoveryContext>): Promise<AutonomousRecoveryDecision> {
    assertCliAutonomousExecutionAuthority(context.request.signedWorkOrder, this.options.authority);
    assertCliOmniRoutePrebuildAuthority(context.request, this.options.prebuild);

    const correction = correctionFor(context, this.options.authority);
    if (!correction) {
      return {
        action: "stop",
        reason: `Brak podpisanej korekty wykonawczej dla: ${(context.result.reasons ?? []).join(",") || "UNKNOWN"}.`
      };
    }

    const request = nextSignedRequest(context, this.options.authority, this.options.delegatePrivateKey);
    let captured: OrchestratorRunRequest | undefined;
    const capture = {
      async run(materialized: OrchestratorRunRequest): Promise<OrchestratorRunResult> {
        captured = materialized;
        return context.result;
      }
    };

    try {
      const derivedPrebuild: CliOmniRoutePrebuildConfig = {
        ...this.options.prebuild,
        files: await recoveryFiles(this.options.sourceDir, this.options.prebuild.files)
      };
      const pipeline = createCliOmniRoutePrebuildPipeline(
        capture,
        this.options.sourceDir,
        derivedPrebuild,
        {
          ...(this.options.fetchImpl === undefined ? {} : { fetchImpl: this.options.fetchImpl }),
          initialCorrection: correction
        }
      );
      const outcome = await pipeline.run(request);
      if (outcome.status === "PREBUILD_BLOCKED") {
        return { action: "stop", reason: `Prebuild naprawczy zatrzymany: ${outcome.reason}` };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith("CLI_PREBUILD_HARMONIA_AUTHORITY_REQUIRED:")) {
        return { action: "stop", reason: "Powtórzony konflikt wymaga rozstrzygnięcia Harmonii." };
      }
      return { action: "stop", reason: `Autonomiczna materializacja zatrzymana: ${message}` };
    }

    if (captured === undefined) {
      return { action: "stop", reason: "Autonomiczna materializacja nie zwróciła gotowej rewizji." };
    }
    return { action: "retry", request: captured };
  }
}
