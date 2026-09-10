import { canonicalDigest } from "../crypto/canonical-digest.js";
import type { SourceQc1Spec } from "../engine/exact-pack-source-guardians.js";
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
  instructions: string;
  expectedResult: string;
  files: HarmoniaExactPackFileDirective[];
  qc1: SourceQc1Spec[];
  endpoint?: string;
  apiKeyEnv?: string;
  defaultModel?: string;
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
  evidenceFp: string;
};

function validate(config: Readonly<CliOmniRoutePrebuildConfig>): void {
  if (config.enabled !== true) throw new Error("CLI_PREBUILD_ENABLED_REQUIRED");
  if (!config.instructions.trim()) throw new Error("CLI_PREBUILD_INSTRUCTIONS_REQUIRED");
  if (!config.expectedResult.trim()) throw new Error("CLI_PREBUILD_EXPECTED_RESULT_REQUIRED");
  if (!Array.isArray(config.files) || config.files.length === 0) throw new Error("CLI_PREBUILD_FILES_REQUIRED");
  if (!Array.isArray(config.qc1) || config.qc1.length === 0) throw new Error("CLI_PREBUILD_QC1_REQUIRED");
  if (config.maxAgentCorrections !== undefined && (!Number.isInteger(config.maxAgentCorrections) || config.maxAgentCorrections < 1)) {
    throw new Error("CLI_PREBUILD_AGENT_CORRECTIONS_INVALID");
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
      ...(config.endpoint === undefined ? {} : { endpoint: config.endpoint }),
      ...(config.apiKeyEnv === undefined ? {} : { apiKeyEnv: config.apiKeyEnv }),
      ...(config.defaultModel === undefined ? {} : { defaultModel: config.defaultModel }),
      ...(runtime.fetchImpl === undefined ? {} : { fetchImpl: runtime.fetchImpl })
    },
    ...(config.defaultModel === undefined ? {} : { defaultModel: config.defaultModel }),
    ...(config.maxLatencyMs === undefined ? {} : { maxLatencyMs: config.maxLatencyMs }),
    ...(config.telemetryTimeoutMs === undefined ? {} : { telemetryTimeoutMs: config.telemetryTimeoutMs }),
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
  return createCliOmniRoutePrebuildPipeline(downstream, sourceDir, config, runtime).run(request);
}
