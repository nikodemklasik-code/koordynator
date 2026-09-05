import type { Digest } from "../domain/ids.js";
import type { BuildInputVector } from "./build-input.js";
import type { BuilderAttestation } from "./attestation.js";

export type BuildArtifact = {
  bytes: Uint8Array;
  sbomFp: Digest;
  provenanceFp: Digest;
  builderIdentityFp: Digest;
  builderAttestation?: BuilderAttestation;
};

export interface HermeticBuilder {
  build(vector: BuildInputVector): Promise<BuildArtifact>;
}

export type SandboxRunner = {
  run(vector: BuildInputVector): Promise<BuildArtifact>;
};

export class HermeticBuildCoordinator implements HermeticBuilder {
  constructor(private readonly sandbox: SandboxRunner) {}
  build(vector: BuildInputVector): Promise<BuildArtifact> {
    return this.sandbox.run(vector);
  }
}
