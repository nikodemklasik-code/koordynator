import type { ExecutorDescriptor, RoleContract } from "./domain.js";
import type { ExecutorRegistryPort } from "./ports.js";

function includesAll(haystack: string[], needles: string[]): boolean {
  const set = new Set(haystack.map((item) => item.toLowerCase()));
  return needles.every((item) => set.has(item.toLowerCase()));
}

export type CapabilityMatch = {
  role: RoleContract;
  executors: ExecutorDescriptor[];
};

export class CapabilityRegistry {
  constructor(private readonly executors: ExecutorRegistryPort) {}

  async healthyExecutors(): Promise<ExecutorDescriptor[]> {
    return (await this.executors.list()).filter((item) => item.healthy);
  }

  async executorsForRole(role: RoleContract): Promise<ExecutorDescriptor[]> {
    const healthy = await this.healthyExecutors();
    return healthy.filter((executor) =>
      includesAll(executor.capabilities, role.capabilities)
      && includesAll(executor.effects, role.allowedEffects)
      && includesAll(executor.tools, role.allowedTools)
    );
  }

  async rolesSatisfying(
    roles: RoleContract[],
    requiredCapabilities: string[]
  ): Promise<CapabilityMatch[]> {
    const active = roles.filter((role) => role.status === "ACTIVE");
    const matches: CapabilityMatch[] = [];

    for (const role of active) {
      if (!includesAll(role.capabilities, requiredCapabilities)) continue;
      const executors = await this.executorsForRole(role);
      if (executors.length) matches.push({ role, executors });
    }

    return matches;
  }

  async missingCapabilities(
    roles: RoleContract[],
    requiredCapabilities: string[]
  ): Promise<string[]> {
    const healthy = await this.healthyExecutors();
    const available = new Set<string>();

    for (const role of roles.filter((item) => item.status === "ACTIVE")) {
      const runnable = healthy.some((executor) =>
        includesAll(executor.capabilities, role.capabilities)
        && includesAll(executor.effects, role.allowedEffects)
        && includesAll(executor.tools, role.allowedTools)
      );
      if (!runnable) continue;
      for (const capability of role.capabilities) available.add(capability.toLowerCase());
    }

    return requiredCapabilities.filter((item) => !available.has(item.toLowerCase()));
  }



  async ceilingForCapabilities(requiredCapabilities: string[]): Promise<{
    capabilities: string[];
    effects: string[];
    tools: string[];
  }> {
    const healthy = await this.healthyExecutors();
    const matching = healthy.filter((executor) =>
      includesAll(executor.capabilities, requiredCapabilities)
    );

    return {
      capabilities: [...new Set(matching.flatMap((executor) => executor.capabilities))],
      effects: [...new Set(matching.flatMap((executor) => executor.effects))],
      tools: [...new Set(matching.flatMap((executor) => executor.tools))]
    };
  }

  async roleWithinExecutorCeiling(role: RoleContract): Promise<boolean> {
    return (await this.executorsForRole(role)).length > 0;
  }
}
