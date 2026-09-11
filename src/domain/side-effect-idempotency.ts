export type SideEffectKind = "payment" | "migration" | "publish" | "deploy" | "message";

const KINDS = new Set<SideEffectKind>(["payment", "migration", "publish", "deploy", "message"]);

export type SideEffectRequest = {
  key: string;
  kind: SideEffectKind;
};

export class SideEffectRegistry {
  private readonly done = new Map<string, unknown>();

  async run<T>(request: SideEffectRequest, exec: () => Promise<T>): Promise<T> {
    if (!KINDS.has(request.kind)) throw new Error("SIDE_EFFECT_KIND_INVALID");
    if (!request.key.trim()) throw new Error("SIDE_EFFECT_KEY_REQUIRED");
    const id = `${request.kind}:${request.key}`;
    if (this.done.has(id)) return this.done.get(id) as T;
    const result = await exec();
    this.done.set(id, result);
    return result;
  }
}
