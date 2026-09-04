import { describe, expect, it } from "vitest";
import { freezeCandidate } from "../src/domain/candidate.js";
import { createSignedRelease } from "../src/domain/release.js";
import { canonicalDigest } from "../src/crypto/canonical-digest.js";

const digest = (value: string) => canonicalDigest(value);

function candidate(artifact: string) {
  return freezeCandidate(
    { taskId: "TASK-1", workspaceId: "WS-1", buildId: "BUILD-1", revision: 0 },
    {
      sourceFp: digest("source"), dependencyFp: digest("deps"), configFp: digest("config"),
      toolchainFp: digest("toolchain"), buildEnvironmentFp: digest("env"),
      moduleManifestFp: digest("manifest"), artifactFp: digest(artifact)
    },
    "2026-09-04T00:00:00.000Z"
  );
}

describe("candidate and release identity", () => {
  it("changes candidateSha when deployable artifact changes", () => {
    expect(candidate("A").candidateSha).not.toBe(candidate("B").candidateSha);
  });

  it("refuses to release bytes different from the frozen candidate", () => {
    const frozen = candidate("A");
    expect(() => createSignedRelease(
      frozen,
      {
        candidateSha: frozen.candidateSha,
        artifactFp: digest("B"),
        approvalFp: digest("approval"),
        releasePolicyFp: digest("policy"),
        channel: "canary",
        createdAt: "2026-09-04T00:01:00.000Z"
      },
      (d) => ({ signatureFp: canonicalDigest({ signed: d }) })
    )).toThrow("RELEASE_ARTIFACT_MISMATCH");
  });
});
