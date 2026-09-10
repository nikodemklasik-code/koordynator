import type { MaterializationOrder } from "../engine/autonomous-recovery.js";
import { ExactPackAgentMaterializer, type ExactPackSource } from "../engine/exact-pack-agent-materializer.js";
import { ExactPackSourceGuardians, type SourceQc1Spec } from "../engine/exact-pack-source-guardians.js";
import {
  AutonomousMaterializationLoop,
  type BrainExecutionConditions,
  type ExecutionConditions,
  type HarmoniaConflictWeigher,
  type Rewident
} from "../engine/materialization-loop.js";
import type { OrchestratorRunRequest } from "./orchestrator.js";
import {
  PreBuildMaterializationRuntime,
  type OrchestratorRunner,
  type PreBuildMaterializationResult
} from "./prebuild-materialization.js";

export type ExactPreBuildPipelineOptions<E> = {
  sourceDir: string;
  packSource(request: Readonly<OrchestratorRunRequest>): ExactPackSource;
  qc1(request: Readonly<OrchestratorRunRequest>): SourceQc1Spec[];
  instructions(request: Readonly<OrchestratorRunRequest>): string;
  expectedResult(request: Readonly<OrchestratorRunRequest>): string;
  brain: BrainExecutionConditions;
  rewident: Rewident<E, OrchestratorRunRequest>;
  harmonia: HarmoniaConflictWeigher<E>;
  maxAgentCorrections: number;
  maxConditionChanges: number;
  initialConditions?(request: Readonly<OrchestratorRunRequest>): ExecutionConditions;
  initialCorrection?(request: Readonly<OrchestratorRunRequest>): string | undefined;
};

export class ExactPreBuildPipeline<E = unknown> {
  constructor(
    private readonly downstream: OrchestratorRunner,
    private readonly options: ExactPreBuildPipelineOptions<E>
  ) {}

  async run(request: OrchestratorRunRequest): Promise<PreBuildMaterializationResult> {
    const materializer = new ExactPackAgentMaterializer(
      this.options.sourceDir,
      request,
      this.options.packSource(request)
    );
    const guardians = new ExactPackSourceGuardians(
      this.options.sourceDir,
      materializer,
      this.options.qc1(request)
    );

    const runtime = new PreBuildMaterializationRuntime<E>(this.downstream, {
      createLoop: () => new AutonomousMaterializationLoop(
        materializer,
        guardians,
        this.options.brain,
        this.options.rewident,
        this.options.harmonia,
        {
          maxAgentCorrections: this.options.maxAgentCorrections,
          maxConditionChanges: this.options.maxConditionChanges
        }
      ),
      materializationOrder: (current): MaterializationOrder => ({
        taskId: current.signedWorkOrder.order.taskId,
        instructions: this.options.instructions(current),
        allowedPaths: [...current.signedWorkOrder.order.scope.allowedPaths],
        suppliedMaterialFp: current.buildVector.sourceFp,
        expectedResult: this.options.expectedResult(current),
        initiative: "brak"
      }),
      ...(this.options.initialConditions === undefined
        ? {}
        : { initialConditions: this.options.initialConditions }),
      ...(this.options.initialCorrection === undefined
        ? {}
        : { initialCorrection: this.options.initialCorrection })
    });

    return runtime.run(request);
  }
}
