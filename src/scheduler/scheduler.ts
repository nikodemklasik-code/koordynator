export type ResourceRequest = { cpu: number; memoryMb: number; gpu?: number; hsm?: number };

export type SchedulerJob<T = unknown> = {
  id: string;
  deps: string[];
  tenantId: string;
  priority: 0 | 1 | 2 | 3;
  securityClass: "S0" | "S1" | "S2" | "S3" | "S4" | "S5";
  resources: ResourceRequest;
  run(): Promise<T>;
};

export type SchedulerLimits = {
  cpu: number;
  memoryMb: number;
  gpu?: number;
  hsm?: number;
  maxConcurrent: number;
  maxConcurrentPerTenant: number;
};

export type SchedulerResult<T = unknown> = {
  results: Map<string, T>;
  executionOrder: string[];
};

function fits(used: ResourceRequest, req: ResourceRequest, limits: SchedulerLimits): boolean {
  return used.cpu + req.cpu <= limits.cpu
    && used.memoryMb + req.memoryMb <= limits.memoryMb
    && (used.gpu ?? 0) + (req.gpu ?? 0) <= (limits.gpu ?? 0)
    && (used.hsm ?? 0) + (req.hsm ?? 0) <= (limits.hsm ?? 0);
}

function add(a: ResourceRequest, b: ResourceRequest): ResourceRequest {
  return {
    cpu: a.cpu + b.cpu,
    memoryMb: a.memoryMb + b.memoryMb,
    gpu: (a.gpu ?? 0) + (b.gpu ?? 0),
    hsm: (a.hsm ?? 0) + (b.hsm ?? 0)
  };
}

export class DagScheduler {
  constructor(private readonly limits: SchedulerLimits) {}

  async run<T>(jobs: SchedulerJob<T>[]): Promise<SchedulerResult<T>> {
    const byId = new Map(jobs.map((job) => [job.id, job]));
    if (byId.size !== jobs.length) throw new Error("DUPLICATE_JOB_ID");
    for (const job of jobs) {
      for (const dep of job.deps) if (!byId.has(dep)) throw new Error(`UNKNOWN_JOB_DEPENDENCY:${job.id}:${dep}`);
      if (!fits({ cpu: 0, memoryMb: 0 }, job.resources, this.limits)) throw new Error(`JOB_EXCEEDS_RESOURCE_LIMIT:${job.id}`);
    }

    const pending = new Set(jobs.map((job) => job.id));
    const completed = new Set<string>();
    const results = new Map<string, T>();
    const executionOrder: string[] = [];

    while (pending.size > 0) {
      const ready = [...pending]
        .map((id) => byId.get(id)!)
        .filter((job) => job.deps.every((dep) => completed.has(dep)))
        .sort((a, b) => {
          if (a.securityClass !== b.securityClass) return b.securityClass.localeCompare(a.securityClass);
          if (a.priority !== b.priority) return b.priority - a.priority;
          if (a.tenantId !== b.tenantId) return a.tenantId.localeCompare(b.tenantId);
          return a.id.localeCompare(b.id);
        });

      if (ready.length === 0) throw new Error("SCHEDULER_DEPENDENCY_CYCLE");

      const selected: SchedulerJob<T>[] = [];
      const perTenant = new Map<string, number>();
      let used: ResourceRequest = { cpu: 0, memoryMb: 0, gpu: 0, hsm: 0 };

      for (const job of ready) {
        if (selected.length >= this.limits.maxConcurrent) break;
        const tenantCount = perTenant.get(job.tenantId) ?? 0;
        if (tenantCount >= this.limits.maxConcurrentPerTenant) continue;
        if (!fits(used, job.resources, this.limits)) continue;
        selected.push(job);
        used = add(used, job.resources);
        perTenant.set(job.tenantId, tenantCount + 1);
      }

      if (selected.length === 0) throw new Error("SCHEDULER_NO_RESOURCE_FIT");

      const batch = await Promise.all(selected.map(async (job) => [job.id, await job.run()] as const));
      for (const [id, result] of batch) {
        results.set(id, result);
        completed.add(id);
        pending.delete(id);
        executionOrder.push(id);
      }
    }

    return { results, executionOrder };
  }
}
