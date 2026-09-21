import type { CorporatePosition, OrganizationModel } from "./organization.js";

export type DelegationMode =
  | "CORPORATE_CHAIN"
  | "DIRECT_ATOMIC"
  | "EMERGENCY_DIRECT";

export type DelegationDecision = {
  mode: DelegationMode;
  ownerPositionId: string;
  executorPositionId: string;
  chain: string[];
  rationale: string[];
};

const rankOrder: Record<CorporatePosition["rank"], number> = {
  CEO: 0,
  HEAD: 1,
  DIRECTOR: 2,
  MANAGER: 3,
  LEAD: 4,
  AGENT: 5
};

function departmentPositions(
  organization: OrganizationModel,
  departmentId: string
): CorporatePosition[] {
  return organization.positions
    .filter((position) => position.departmentId === departmentId && position.status !== "PAUSED")
    .sort((a, b) => rankOrder[a.rank] - rankOrder[b.rank]);
}

function chainTo(
  organization: OrganizationModel,
  position: CorporatePosition
): string[] {
  const positions = new Map(organization.positions.map((item) => [item.positionId, item]));
  const chain: string[] = [position.positionId];
  let current = position;

  while (current.reportsToPositionId) {
    const parent = positions.get(current.reportsToPositionId);
    if (!parent) break;
    chain.unshift(parent.positionId);
    current = parent;
  }

  return chain;
}

/**
 * Default rule:
 * - Koordynator delegates corporate ownership through the hierarchy.
 * - The department hierarchy selects the concrete Agent.
 * - Direct Agent assignment is reserved for pre-authorised atomic work.
 * - Emergency direct assignment is only for P0 containment/diagnostics.
 *
 * This keeps responsibility legible without turning every trivial task into a
 * ceremonial tour through five management layers.
 */
export function chooseDelegation(input: {
  organization: OrganizationModel;
  departmentId: string;
  atomic: boolean;
  preauthorisedDirectExecution: boolean;
  emergencyP0: boolean;
}): DelegationDecision {
  const positions = departmentPositions(input.organization, input.departmentId);
  const owner = positions.find((position) => position.rank === "HEAD" || position.rank === "CEO");
  if (!owner) throw new Error("DELEGATION_DEPARTMENT_OWNER_MISSING");

  const agent = [...positions].reverse().find((position) => position.rank === "AGENT");
  if (!agent) throw new Error("DELEGATION_AGENT_MISSING");

  if (input.emergencyP0) {
    return {
      mode: "EMERGENCY_DIRECT",
      ownerPositionId: owner.positionId,
      executorPositionId: agent.positionId,
      chain: [owner.positionId, agent.positionId],
      rationale: [
        "P0 emergency path",
        "department ownership remains with the Head/CEO",
        "direct execution reduces containment latency"
      ]
    };
  }

  if (input.atomic && input.preauthorisedDirectExecution) {
    return {
      mode: "DIRECT_ATOMIC",
      ownerPositionId: owner.positionId,
      executorPositionId: agent.positionId,
      chain: [owner.positionId, agent.positionId],
      rationale: [
        "task is atomic",
        "direct execution was pre-authorised by the Role Contract",
        "department Head retains accountability"
      ]
    };
  }

  return {
    mode: "CORPORATE_CHAIN",
    ownerPositionId: owner.positionId,
    executorPositionId: agent.positionId,
    chain: chainTo(input.organization, agent),
    rationale: [
      "material work follows the corporate delegation chain",
      "managers/leads may decompose work without changing the corporate objective",
      "executor remains focused on the assigned stage only"
    ]
  };
}
