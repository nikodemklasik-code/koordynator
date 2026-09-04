import type { TaskId } from "../domain/ids.js";
import type { OrchestratorState } from "../domain/state.js";

export interface StateStore {
  load(taskId: TaskId): Promise<OrchestratorState | null>;
  save(state: OrchestratorState): Promise<void>;
  history(taskId: TaskId): Promise<OrchestratorState[]>;
}
