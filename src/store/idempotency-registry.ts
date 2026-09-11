export type SideEffectKind = "payment" | "email" | "migration" | "preview_publish" | "merge" | "deploy";

export type SideEffectRecord = {
  idempotencyKey: string;
  kind: SideEffectKind;
  taskId: string;
  revision: number;
  result: "COMPLETED" | "IN_FLIGHT";
  effectFp: string;
};

export class DuplicateSideEffectError extends Error {
  readonly existing: SideEffectRecord;

  constructor(existing: SideEffectRecord) {
    super(`IDEMPOTENT_REPLAY_BLOCKED:${existing.kind}`);
    this.existing = existing;
  }
}

export function claimSideEffect(
  registry: Map<string, SideEffectRecord>,
  next: SideEffectRecord
): SideEffectRecord {
  const existing = registry.get(next.idempotencyKey);
  if (!existing) {
    registry.set(next.idempotencyKey, next);
    return next;
  }
  if (existing.result === "COMPLETED") throw new DuplicateSideEffectError(existing);
  if (existing.effectFp !== next.effectFp) throw new Error("IDEMPOTENCY_PAYLOAD_DRIFT");
  return existing;
}
