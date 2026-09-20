export type VerifierTrustRoot = {
  trustRootId: string;
  verifierId: string;
  independentGroupId: string;
  providerLineageId: string;
  authority: "CORE" | "SECURITY" | "QC" | "OPERATOR" | "PROVIDER";
  revoked: boolean;
  validFrom: string;
  validUntil?: string;
};

export class VerifierTrustRegistry {
  private readonly roots = new Map<string, VerifierTrustRoot>();

  constructor(initial: VerifierTrustRoot[] = []) {
    for (const root of initial) this.register(root);
  }

  register(root: VerifierTrustRoot): void {
    if (this.roots.has(root.trustRootId)) throw new Error(`VERIFIER_TRUST_ROOT_EXISTS:${root.trustRootId}`);
    this.roots.set(root.trustRootId, structuredClone(root));
  }

  resolve(trustRootId: string, now = new Date()): VerifierTrustRoot {
    const root = this.roots.get(trustRootId);
    if (!root) throw new Error(`VERIFIER_TRUST_ROOT_UNKNOWN:${trustRootId}`);
    if (root.revoked) throw new Error(`VERIFIER_TRUST_ROOT_REVOKED:${trustRootId}`);
    if (Date.parse(root.validFrom) > now.getTime()) throw new Error(`VERIFIER_TRUST_ROOT_NOT_YET_VALID:${trustRootId}`);
    if (root.validUntil && Date.parse(root.validUntil) <= now.getTime()) {
      throw new Error(`VERIFIER_TRUST_ROOT_EXPIRED:${trustRootId}`);
    }
    return structuredClone(root);
  }

  assertReceiptLineage(input: {
    trustRootId: string;
    verifierId: string;
    independentGroupId: string;
    providerLineageId: string;
    now?: Date;
  }): void {
    const root = this.resolve(input.trustRootId, input.now);
    if (root.verifierId !== input.verifierId) throw new Error("VERIFIER_ID_LINEAGE_MISMATCH");
    if (root.independentGroupId !== input.independentGroupId) throw new Error("VERIFIER_GROUP_LINEAGE_MISMATCH");
    if (root.providerLineageId !== input.providerLineageId) throw new Error("VERIFIER_PROVIDER_LINEAGE_MISMATCH");
  }

  list(): VerifierTrustRoot[] {
    return [...this.roots.values()].map((root) => structuredClone(root));
  }
}
