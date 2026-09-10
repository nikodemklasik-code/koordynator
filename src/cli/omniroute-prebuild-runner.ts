import { canonicalDigest } from "../crypto/canonical-digest.js";
import type { Digest } from "../domain/ids.js";
import type { SourceQc1Spec } from "../engine/exact-pack-source-guardians.js";
import { isForbiddenModel } from "../api/omniroute-model-selector.js";
import type { HarmoniaExactPackFileDirective } from "../orchestrator/omniroute-exact-pack-source.js";
import {
  createHarmoniaExactPackDirective
} from "../orchestrator/omniroute-exact-pack-source.js";
import {
  createOmniRouteExactPreBuildPipeline
} from "../orchestrator/omniroute-exact-prebuild-pipeline.js";
import type {
  OrchestratorRunner,
  PreBuildMaterializationResult
} from "../orchestrator/prebuild-materialization.js";
import type { OrchestratorRunRequest } from "../orchestrator/orchestrator.js";

export type CliOmniRoutePrebuildConfig = {
  enabled: true;
  authorityInputUri: string;
  instructions: string;
  expectedResult: string;
  files: HarmoniaExactPackFileDirective[];
  qc1: SourceQc1Spec[];
  defaultModel: string;
  maxLatencyMs?: number;
  telemetryTimeoutMs?: number;
  maxAgentCorrections?: number;
};

export type CliOmniRoutePrebuildRuntimeOptions = {
  fetchImpl?: typeof fetch;
};

type ConflictEvidence = {
  taskId: string;
  issueFp: string;
  opposing: number;
  qc1: number;
  evidenceFp: Digest;
};

function validate(config: Readonly<CliOmniRoutePrebuildConfig>): void {
  if (config.enabled !== true) throw new Error("CLI_PREBUILD_ENABLED_REQUIRED");
  if (!config.authorityInputUri.trim()) throw new Error("CLI_PREBUILD_AUTHORITY_URI_REQUIRED");
  if (!config.instructions.trim()) throw new Error("CLI_PREBUILD_INSTRUCTIONS_REQUIRED");
  if (!config.expectedResult.trim()) throw new Error("CLI_PREBUILD_EXPECTED_RESULT_REQUIRED");
  if (!Array.isArray(config.files) || config.files.length === 0) throw new Error("CLI_PREBUILD_FILES_REQUIRED");
  if (!Array.isArray(config.qc1) || config.qc1.length === 0) throw new Error("CLI_PREBUILD_QC1_REQUIRED");
  if (!config.defaultModel.trim()) throw new Error("CLI_PREBUILD_DEFAULT_MODEL_REQUIRED");
  if (isForbiddenModel(config.defaultModel)) throw new Error("CLI_PREBUILD_FORBIDDEN_MODEL");
  if (config.maxLatencyMs !== undefined && (!Number.isFinite(config.maxLatencyMs) || config.maxLatencyMs < 1000)) {
    throw new Error("CLI_PREBUILD_MAX_LATENCY_INVALID");
  }
  if (config.telemetryTimeoutMs !== undefined && (!Number.isFinite(config.telemetryTimeoutMs) || config.telemetryTimeoutMs < 100)) {
    throw new Error("CLI_PREBUILD_TELEMETRY_TIMEOUT_INVALID");
  }
  if (config.maxAgentCorrections !== undefined && (!Number.isInteger(config.maxAgentCorrections) || config.maxAgentCorrections < 1)) {
    throw new Error("CLI_PREBUILD_AGENT_CORRECTIONS_INVALID");
  }
}

function normalizedQc1(specs: readonly SourceQc1Spec[]) {
  return specs.map((spec) => ({
    name: spec.name,
    command: spec.command,
    args: [...spec.args],
    proposedSolution: spec.proposedSolution,
    timeoutMs: spec.timeoutMs ?? 60_000,
    maxOutputBytes: spec.maxOutputBytes ?? 1024 * 1024,
    envAllowList: [...(spec.envAllowList ?? [])].sort()
  }));
}

export function cliOmniRoutePrebuildAuthorityFingerprint(config: Readonly<CliOmniRoutePrebuildConfig>): Digest {
  validate(config);
  return canonicalDigest({
    kind: "cli-omniroute-prebuild-authority-v1",
    instructions: config.instructions,
    expectedResult: config.expectedResult,
    files: config.files.map((file) => ({ ...file })),
    qc1: normalizedQc1(config.qc1),
    defaultModel: config.defaultModel,
    maxLatencyMs: config.maxLatencyMs ?? 120_000,
    telemetryTimeoutMs: config.telemetryTimeoutMs ?? 5_000,
    maxAgentCorrections: config.maxAgentCorrections ?? 2
  });
}

export function assertCliOmniRoutePrebuildAuthority(
  request: Readonly<OrchestratorRunRequest>,
  config: Readonly<CliOmniRoutePrebuildConfig>
): void {
  const expected = cliOmniRoutePrebuildAuthorityFingerprint(config);
  const authority = request.signedWorkOrder.order.requiredInputs.find((input) => input.uri === config.authorityInputUri);
  if (authority === undefined) throw new Error("CLI_PREBUILD_AUTHORITY_INPUT_MISSING");
  if (authority.digest !== expected) {
    throw new Error(`CLI_PREBUILD_AUTHORITY_MISMATCH:expected=${authority.digest}:actual=${expected}`);
  }
}

export function createCliOmniRoutePrebuildPipeline(
  downstream: OrchestratorRunner,
  sourceDir: string,
  config: Readonly<CliOmniRoutePrebuildConfig>,
  runtime: CliOmniRoutePrebuildRuntimeOptions = {}
) {
  validate(config);

  return createOmniRouteExactPreBuildPipeline<ConflictEvidence>(downstream, {
    sourceDir,
    directive(context) {
      return createHarmoniaExactPackDirective({
        taskId: context.order.taskId,
        orderFp: canonicalDigest(context.order),
        files: config.files.map((file) => ({ ...file }))
      });
    },
    qc1() {
      return config.qc1.map((spec) => ({
        ...spec,
        args: [...spec.args],
        ...(spec.envAllowList === undefined ? {} : { envAllowList: [...spec.envAllowList] })
      }));
    },
    instructions() {
      return config.instructions;
    },
    expectedResult() {
      return config.expectedResult;
    },
    brain: {
      async change(current) {
        return { ...current, generation: current.generation + 1 };
      }
    },
    rewident: {
      async gather(input) {
        const base = {
          taskId: input.order.taskId,
          issueFp: input.issueFp,
          opposing: input.comparison.opposing.value,
          qc1: input.comparison.qc1.value
        };
        return {
          ...base,
          evidenceFp: canonicalDigest({ kind: "cli-prebuild-conflict-evidence-v1", ...base })
        };
      }
    },
    harmonia: {
      async weigh(evidence) {
        throw new Error(`CLI_PREBUILD_HARMONIA_AUTHORITY_REQUIRED:${evidence.evidenceFp}`);
      }
    },
    maxAgentCorrections: config.maxAgentCorrections ?? 2,
    maxConditionChanges: 0,
    omniRoute: {
      endpoint: "http://127.0.0.1:20128/v1",
      apiKeyEnv: "OMNIROUTE_API_KEY",
      defaultModel: config.defaultModel,
      ...(runtime.fetchImpl === undefined ? {} : { fetchImpl: runtime.fetchImpl })
    },
    defaultModel: config.defaultModel,
    maxLatencyMs: config.maxLatencyMs ?? 120_000,
    telemetryTimeoutMs: config.telemetryTimeoutMs ?? 5_000,
    dynamicModelSelection: true,
    initialConditions(_request: Readonly<OrchestratorRunRequest>) {
      return { agent: "Agent", aiRoute: "OmniRoute", generation: 0 };
    }
  });
}

export async function runCliOmniRoutePrebuild(
  downstream: OrchestratorRunner,
  request: OrchestratorRunRequest,
  sourceDir: string,
  config: Readonly<CliOmniRoutePrebuildConfig>,
  runtime: CliOmniRoutePrebuildRuntimeOptions = {}
): Promise<PreBuildMaterializationResult> {
  assertCliOmniRoutePrebuildAuthority(request, config);
  return createCliOmniRoutePrebuildPipeline(downstream, sourceDir, config, runtime).run(request);
}
