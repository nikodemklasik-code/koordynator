import { randomUUID } from "node:crypto";
import type {
  CorporateTask,
  ExecutionPlan,
  ExecutionStage,
  RoleContract
} from "./domain.js";

function stageId(): string {
  return `STAGE-${randomUUID().slice(0, 8).toUpperCase()}`;
}

function byCapability(roles: RoleContract[], capability: string): RoleContract | undefined {
  return roles.find((role) =>
    role.status === "ACTIVE"
    && role.capabilities.some((item) => item.toLowerCase() === capability.toLowerCase())
  );
}

/**
 * Deterministic baseline planner.
 *
 * The kernel deliberately starts with a small, inspectable planner. A model-backed
 * planner can be attached later, but it must emit the same ExecutionPlan contract
 * and still pass HLL ratification before delegation.
 */
export function buildBaselinePlan(task: CorporateTask, roles: RoleContract[]): ExecutionPlan {
  const stages: ExecutionStage[] = [];
  let order = 0;

  const research = byCapability(roles, "research");
  if (research) {
    stages.push({
      stageId: stageId(),
      taskId: task.taskId,
      order: order++,
      roleId: research.roleId,
      objective: `Establish evidence, dependencies, uncertainties and constraints for: ${task.objective}`,
      requiredCapabilities: ["research"],
      expectedEvidence: ["provenance", "constraints", "dependency-map"],
      successCondition: "The task can be executed without relying on unstated assumptions.",
      status: "PLANNED"
    });
  }

  for (const capability of task.requiredCapabilities) {
    const role = byCapability(roles, capability);
    if (!role) continue;
    if (stages.some((stage) => stage.roleId === role.roleId && stage.requiredCapabilities.includes(capability))) continue;

    stages.push({
      stageId: stageId(),
      taskId: task.taskId,
      order: order++,
      roleId: role.roleId,
      objective: task.objective,
      requiredCapabilities: [capability],
      expectedEvidence: ["work-product", "execution-receipt"],
      successCondition: task.successDefinition,
      status: "PLANNED"
    });
  }

  const auditor = byCapability(roles, "audit") ?? byCapability(roles, "review");
  if (auditor) {
    stages.push({
      stageId: stageId(),
      taskId: task.taskId,
      order: order++,
      roleId: auditor.roleId,
      objective: "Independently verify the result against acceptance criteria, security constraints and evidence.",
      requiredCapabilities: auditor.capabilities.filter((item) =>
        ["audit", "review", "security-review"].includes(item.toLowerCase())
      ),
      expectedEvidence: ["independent-verdict", "verification-receipt"],
      successCondition: task.acceptanceCriteria.join("; "),
      status: "PLANNED"
    });
  }

  return {
    planId: `PLAN-${randomUUID().slice(0, 8).toUpperCase()}`,
    taskId: task.taskId,
    stages,
    generatedAt: new Date().toISOString()
  };
}
