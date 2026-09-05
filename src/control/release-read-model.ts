import { canonicalDigest } from "../crypto/canonical-digest.js";
import type { Digest } from "../domain/ids.js";
import { FileReleaseStore } from "../release/file-release-store.js";
import type { ReleaseRecord, ReleaseState } from "../release/release-controller.js";

export type ReleaseView = {
  releaseSha: Digest;
  state: ReleaseState;
  channel: string;
  candidateSha: Digest;
  artifactFp: Digest;
  approvalFp: Digest;
  releasePolicyFp: Digest;
  releaseManifestFp: Digest;
  signatureFp: Digest;
  previousProductionSha?: Digest;
  createdAt: string;
  changedAt: string;
  manifestIntegrity: "PASS" | "FAIL";
  isCurrentProduction: boolean;
};

export type ReleaseListResponse = {
  releases: ReleaseView[];
  currentProduction: ReleaseView | null;
  counts: { total: number; canary: number; production: number; rolledBack: number };
};

function view(record: ReleaseRecord, currentProductionSha?: Digest): ReleaseView {
  const manifest = record.release.manifest;
  return {
    releaseSha: record.release.releaseSha,
    state: record.state,
    channel: manifest.channel,
    candidateSha: manifest.candidateSha,
    artifactFp: manifest.artifactFp,
    approvalFp: manifest.approvalFp,
    releasePolicyFp: manifest.releasePolicyFp,
    releaseManifestFp: record.release.releaseManifestFp,
    signatureFp: record.release.signatureFp,
    ...(record.previousProductionSha === undefined ? {} : { previousProductionSha: record.previousProductionSha }),
    createdAt: manifest.createdAt,
    changedAt: record.changedAt,
    manifestIntegrity: canonicalDigest(manifest) === record.release.releaseManifestFp ? "PASS" : "FAIL",
    isCurrentProduction: record.release.releaseSha === currentProductionSha && record.state === "PRODUCTION"
  };
}

export class ReleaseReadModel {
  private readonly store: FileReleaseStore;
  constructor(releaseRoot: string) {
    this.store = new FileReleaseStore(releaseRoot);
  }

  async list(): Promise<ReleaseListResponse> {
    const current = await this.store.currentProduction();
    const currentSha = current?.release.releaseSha;
    const releases = (await this.store.all())
      .map((record) => view(record, currentSha))
      .sort((a, b) => b.changedAt.localeCompare(a.changedAt) || a.releaseSha.localeCompare(b.releaseSha));
    return {
      releases,
      currentProduction: current ? view(current, currentSha) : null,
      counts: {
        total: releases.length,
        canary: releases.filter((release) => release.state === "CANARY").length,
        production: releases.filter((release) => release.state === "PRODUCTION").length,
        rolledBack: releases.filter((release) => release.state === "ROLLED_BACK").length
      }
    };
  }

  async get(releaseSha: Digest): Promise<ReleaseView | null> {
    const current = await this.store.currentProduction();
    const record = await this.store.get(releaseSha);
    return record ? view(record, current?.release.releaseSha) : null;
  }
}
