export type Digest = `sha256:${string}`;
export type TaskId = `TASK-${string}`;
export type WorkspaceId = `WS-${string}`;
export type BuildId = `BUILD-${string}`;

export type TaskRef = {
  taskId: TaskId;
  workspaceId: WorkspaceId;
  buildId: BuildId;
  revision: number;
};

export function assertRevision(revision: number): void {
  if (!Number.isInteger(revision) || revision < 0) {
    throw new Error("INVALID_REVISION");
  }
}
