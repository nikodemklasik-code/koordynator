import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { TaskState, OrchestratorState } from "../domain/state.js";
import type { TaskId } from "../domain/ids.js";
import type { WorkOrder } from "../domain/work-order.js";
import type { FrozenCandidate } from "../domain/candidate.js";
import type { EvidenceReceipt } from "../domain/evidence.js";
import type { ReleaseRecord } from "../release/release-controller.js";
import { FileStateStore } from "../store/file-state-store.js";
import { FileSignedWorkOrderStore } from "../store/work-order-store.js";
import { FileTaskExecutionStore, type StoredTaskExecution } from "../store/task-execution-store.js";

export type TaskFilter = "all" | "building" | "frozen" | "validating" | "awaiting-approval" | "released" | "returned";

export type TaskListItem = {
  taskId: TaskId;
  revision: number;
  state: TaskState;
  displayStatus: string;
  reasonCode?: string;
  objective: string;
  target: string;
  initiatedBy: string;
  createdAt: string;
  updatedAt: string;
  workspaceId: string;
  buildId: string;
  workOrderFp?: string;
};

export type TaskCounts = {
  all: number;
  building: number;
  frozen: number;
  validating: number;
  awaitingApproval: number;
  released: number;
  returned: number;
};

export type TaskListResponse = {
  tasks: TaskListItem[];
  counts: TaskCounts;
  total: number;
};

export type TaskDetailResponse = {
  task: TaskListItem;
  history: OrchestratorState[];
  workOrder?: {
    order: WorkOrder;
    orderFp: string;
    keyId: string;
    signatureStored: true;
  };
  executionStatus?: StoredTaskExecution["status"];
  candidate?: FrozenCandidate;
  receipts: EvidenceReceipt[];
  release?: ReleaseRecord;
  nextRevision?: number;
  reasons: string[];
  buildMode?: "BUILD" | "REUSE";
};

function displayStatus(state: TaskState): string {
  if (state === "APPROVED") return "AWAITING_HUMAN_APPROVAL";
  return state;
}

function matchesFilter(state: TaskState, filter: TaskFilter): boolean {
  if (filter === "all") return true;
  if (filter === "building") return state === "BUILDING" || state === "BUILD_READY";
  if (filter === "frozen") return state === "CANDIDATE_FROZEN";
  if (filter === "validating") return state === "VALIDATING";
  if (filter === "awaiting-approval") return state === "APPROVED";
  if (filter === "released") return state === "RELEASED";
  return state === "RETURNED";
}

function normalizeSearch(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

function matchesSearch(task: TaskListItem, query: string): boolean {
  if (!query) return true;
  const haystack = [
    task.taskId,
    task.state,
    task.displayStatus,
    task.reasonCode ?? "",
    task.objective,
    task.target,
    task.initiatedBy,
    task.workspaceId,
    task.buildId,
    task.workOrderFp ?? ""
  ].join("\n").toLocaleLowerCase("en-US");
  return haystack.includes(query);
}

function countsFor(tasks: TaskListItem[]): TaskCounts {
  return {
    all: tasks.length,
    building: tasks.filter((task) => matchesFilter(task.state, "building")).length,
    frozen: tasks.filter((task) => matchesFilter(task.state, "frozen")).length,
    validating: tasks.filter((task) => matchesFilter(task.state, "validating")).length,
    awaitingApproval: tasks.filter((task) => matchesFilter(task.state, "awaiting-approval")).length,
    released: tasks.filter((task) => matchesFilter(task.state, "released")).length,
    returned: tasks.filter((task) => matchesFilter(task.state, "returned")).length
  };
}

async function currentTaskIds(stateRoot: string): Promise<TaskId[]> {
  let names: string[];
  try {
    names = await readdir(stateRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  return names
    .filter((name) => /^TASK-[A-Za-z0-9._-]+\.json$/.test(name))
    .map((name) => name.slice(0, -5) as TaskId)
    .sort();
}

function buildModeFrom(history: OrchestratorState[]): "BUILD" | "REUSE" | undefined {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const item = history[index]!;
    if (item.state === "BUILD_READY" && (item.reasonCode === "BUILD" || item.reasonCode === "REUSE")) return item.reasonCode;
  }
  return undefined;
}

export class TaskReadModel {
  private readonly stateStore: FileStateStore;
  private readonly workOrderStore: FileSignedWorkOrderStore;
  private readonly executionStore: FileTaskExecutionStore;

  constructor(
    private readonly stateRoot: string,
    workOrderRoot: string,
    executionRoot = join(dirname(stateRoot), "executions")
  ) {
    this.stateStore = new FileStateStore(stateRoot);
    this.workOrderStore = new FileSignedWorkOrderStore(workOrderRoot);
    this.executionStore = new FileTaskExecutionStore(executionRoot);
  }

  async list(options: { filter?: TaskFilter; query?: string } = {}): Promise<TaskListResponse> {
    const filter = options.filter ?? "all";
    const query = normalizeSearch(options.query ?? "");
    const taskIds = await currentTaskIds(this.stateRoot);
    const all: TaskListItem[] = [];

    for (const taskId of taskIds) {
      const current = await this.stateStore.load(taskId);
      if (!current) continue;
      const history = await this.stateStore.history(taskId);
      const signed = await this.workOrderStore.get(taskId, current.revision);
      const order = signed?.order;
      const first = history.at(0);
      const target = order?.scope.modules.length ? order.scope.modules.join(", ") : current.workspaceId;

      all.push({
        taskId,
        revision: current.revision,
        state: current.state,
        displayStatus: displayStatus(current.state),
        ...(current.reasonCode === undefined ? {} : { reasonCode: current.reasonCode }),
        objective: order?.objective ?? "Orchestration task",
        target,
        initiatedBy: signed?.keyId ?? "system",
        createdAt: first?.changedAt ?? current.changedAt,
        updatedAt: current.changedAt,
        workspaceId: current.workspaceId,
        buildId: current.buildId,
        ...(signed?.orderFp === undefined ? {} : { workOrderFp: signed.orderFp })
      });
    }

    all.sort((a, b) => {
      const byUpdated = Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
      return Number.isNaN(byUpdated) || byUpdated === 0 ? a.taskId.localeCompare(b.taskId) : byUpdated;
    });

    const searched = all.filter((task) => matchesSearch(task, query));
    const tasks = searched.filter((task) => matchesFilter(task.state, filter));
    return { tasks, counts: countsFor(searched), total: tasks.length };
  }

  async get(taskId: TaskId): Promise<TaskListItem | null> {
    const response = await this.list({ query: taskId });
    return response.tasks.find((task) => task.taskId === taskId) ?? null;
  }

  async detail(taskId: TaskId): Promise<TaskDetailResponse | null> {
    const task = await this.get(taskId);
    if (!task) return null;
    const history = await this.stateStore.history(taskId);
    const signed = await this.workOrderStore.get(taskId, task.revision);
    const execution = await this.executionStore.get(taskId, task.revision);
    const mode = buildModeFrom(history);
    return {
      task,
      history,
      ...(signed === null ? {} : {
        workOrder: {
          order: signed.order,
          orderFp: signed.orderFp,
          keyId: signed.keyId,
          signatureStored: true as const
        }
      }),
      ...(execution === null ? {} : { executionStatus: execution.status }),
      ...(execution?.candidate === undefined ? {} : { candidate: execution.candidate }),
      receipts: execution?.receipts ?? [],
      ...(execution?.release === undefined ? {} : { release: execution.release }),
      ...(execution?.nextRevision === undefined ? {} : { nextRevision: execution.nextRevision }),
      reasons: execution?.reasons ?? (task.reasonCode ? [task.reasonCode] : []),
      ...(mode === undefined ? {} : { buildMode: mode })
    };
  }
}

export function controlRoots(stateDir: string): { stateRoot: string; workOrderRoot: string; executionRoot: string } {
  return {
    stateRoot: join(stateDir, "state"),
    workOrderRoot: join(stateDir, "work-orders"),
    executionRoot: join(stateDir, "executions")
  };
}
