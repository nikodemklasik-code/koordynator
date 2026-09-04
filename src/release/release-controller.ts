import { canonicalDigest } from "../crypto/canonical-digest.js";
import type { FrozenCandidate } from "../domain/candidate.js";
import { createSignedRelease, type ReleaseManifest, type SignedRelease } from "../domain/release.js";
import type { Digest } from "../domain/ids.js";

export type ReleaseState = "CANARY" | "PRODUCTION" | "ROLLED_BACK";

export type ReleaseRecord = {
  release: SignedRelease;
  state: ReleaseState;
  previousProductionSha?: Digest;
  changedAt: string;
};

export interface ReleaseStore {
  put(record: ReleaseRecord): Promise<void>;
  get(releaseSha: Digest): Promise<ReleaseRecord | null>;
  currentProduction(): Promise<ReleaseRecord | null>;
  all(): Promise<ReleaseRecord[]>;
}

export class MemoryReleaseStore implements ReleaseStore {
  private readonly records = new Map<Digest, ReleaseRecord>();
  async put(record: ReleaseRecord): Promise<void> { this.records.set(record.release.releaseSha, structuredClone(record)); }
  async get(releaseSha: Digest): Promise<ReleaseRecord | null> {
    const value = this.records.get(releaseSha);
    return value ? structuredClone(value) : null;
  }
  async currentProduction(): Promise<ReleaseRecord | null> {
    const values = [...this.records.values()].filter((record) => record.state === "PRODUCTION");
    const value = values.at(-1);
    return value ? structuredClone(value) : null;
  }
  async all(): Promise<ReleaseRecord[]> { return [...this.records.values()].map((record) => structuredClone(record)); }
}

export class ReleaseController {
  constructor(
    private readonly store: ReleaseStore,
    private readonly sign: (digest: Digest) => { signatureFp: Digest },
    private readonly clock: () => string
  ) {}

  async canary(candidate: FrozenCandidate, approvalFp: Digest, releasePolicyFp: Digest): Promise<ReleaseRecord> {
    const manifest: ReleaseManifest = {
      candidateSha: candidate.candidateSha,
      artifactFp: candidate.artifactFp,
      approvalFp,
      releasePolicyFp,
      channel: "canary",
      createdAt: this.clock()
    };
    const release = createSignedRelease(candidate, manifest, this.sign);
    const previous = await this.store.currentProduction();
    const record: ReleaseRecord = {
      release,
      state: "CANARY",
      ...(previous === null ? {} : { previousProductionSha: previous.release.releaseSha }),
      changedAt: this.clock()
    };
    await this.store.put(record);
    return record;
  }

  async promote(releaseSha: Digest): Promise<ReleaseRecord> {
    const record = await this.store.get(releaseSha);
    if (!record) throw new Error("RELEASE_NOT_FOUND");
    if (record.state !== "CANARY") throw new Error("ONLY_CANARY_CAN_PROMOTE");
    const current = await this.store.currentProduction();
    if (current && current.release.releaseSha !== releaseSha) {
      await this.store.put({ ...current, state: "ROLLED_BACK", changedAt: this.clock() });
    }
    const promoted = { ...record, state: "PRODUCTION" as const, changedAt: this.clock() };
    await this.store.put(promoted);
    return promoted;
  }

  async rollback(releaseSha: Digest): Promise<ReleaseRecord> {
    const record = await this.store.get(releaseSha);
    if (!record) throw new Error("RELEASE_NOT_FOUND");
    if (record.state !== "PRODUCTION") throw new Error("ONLY_PRODUCTION_CAN_ROLLBACK");
    const rolled = { ...record, state: "ROLLED_BACK" as const, changedAt: this.clock() };
    await this.store.put(rolled);
    if (!record.previousProductionSha) return rolled;
    const previous = await this.store.get(record.previousProductionSha);
    if (!previous) throw new Error("PREVIOUS_RELEASE_NOT_FOUND");
    const restored = { ...previous, state: "PRODUCTION" as const, changedAt: this.clock() };
    await this.store.put(restored);
    return restored;
  }

  verifyExactArtifact(candidate: FrozenCandidate, record: ReleaseRecord): boolean {
    return record.release.manifest.candidateSha === candidate.candidateSha
      && record.release.manifest.artifactFp === candidate.artifactFp
      && canonicalDigest(record.release.manifest) === record.release.releaseManifestFp;
  }
}
