import { createDefaultAiProviderFabric } from "../api/default-provider-fabric.js";
import type { OmniRouteConfig } from "../api/omniroute-adapter.js";
import { DeterministicOmniRouteModelSelector } from "../api/omniroute-model-selector.js";
import { OmniRouteRuntimeTelemetry } from "../api/omniroute-runtime-telemetry.js";
import { ProviderExecutor } from "../api/provider-executor.js";
import type { SecurityClass } from "../api/capability-api.js";
import type { ExactPackRequestContext } from "../engine/exact-pack-agent-materializer.js";
import {
  ExactPreBuildPipeline,
  type ExactPreBuildPipelineOptions
} from "./exact-prebuild-pipeline.js";
import type { OrchestratorRunner } from "./prebuild-materialization.js";
import {
  OmniRouteExactPackSource,
  type HarmoniaExactPackDirective
} from "./omniroute-exact-pack-source.js";

export type OmniRouteExactPreBuildPipelineOptions<E> = Omit<ExactPreBuildPipelineOptions<E>, "packSource"> & {
  directive(context: Readonly<ExactPackRequestContext>): HarmoniaExactPackDirective;
  omniRoute?: OmniRouteConfig;
  securityClass?: SecurityClass;
  defaultModel?: string;
  maxLatencyMs?: number;
  telemetryTimeoutMs?: number;
  dynamicModelSelection?: boolean;
};

export function createOmniRouteExactPreBuildPipeline<E = unknown>(
  downstream: OrchestratorRunner,
  options: OmniRouteExactPreBuildPipelineOptions<E>
): ExactPreBuildPipeline<E> {
  const {
    directive,
    omniRoute,
    securityClass,
    defaultModel,
    maxLatencyMs,
    telemetryTimeoutMs,
    dynamicModelSelection,
    ...pipeline
  } = options;
  const fabric = createDefaultAiProviderFabric({
    ...(omniRoute === undefined ? {} : { omniRoute }),
    profile: { mode: "MONO", providerId: "omniroute" }
  });
  const executor = new ProviderExecutor(fabric.router, { now: () => new Date().toISOString() });
  const telemetry = new OmniRouteRuntimeTelemetry({
    ...(omniRoute?.endpoint === undefined ? {} : { endpoint: omniRoute.endpoint }),
    ...(omniRoute?.apiKey === undefined ? {} : { apiKey: omniRoute.apiKey }),
    ...(omniRoute?.apiKeyEnv === undefined ? {} : { apiKeyEnv: omniRoute.apiKeyEnv }),
    ...(omniRoute?.fetchImpl === undefined ? {} : { fetchImpl: omniRoute.fetchImpl }),
    ...(telemetryTimeoutMs === undefined ? {} : { timeoutMs: telemetryTimeoutMs })
  });
  const modelSelector = dynamicModelSelection === false
    ? undefined
    : new DeterministicOmniRouteModelSelector(telemetry);

  return new ExactPreBuildPipeline<E>(downstream, {
    ...pipeline,
    packSource: () => new OmniRouteExactPackSource(executor, {
      directive,
      ...(securityClass === undefined ? {} : { securityClass }),
      ...(defaultModel === undefined ? {} : { defaultModel }),
      ...(maxLatencyMs === undefined ? {} : { maxLatencyMs }),
      ...(modelSelector === undefined ? {} : { modelSelector })
    })
  });
}
