export type CredentialBinding = {
  credentialRef: string;
  providerId: string;
  envVar: string;
  allowedTenants: string[];
  allowedCapabilities: string[];
  enabled: boolean;
};

export type CredentialLease = {
  credentialRef: string;
  providerId: string;
  secret: string;
};

export class EnvCredentialBroker {
  private readonly bindings = new Map<string, CredentialBinding>();

  constructor(bindings: CredentialBinding[] = []) {
    for (const binding of bindings) this.register(binding);
  }

  register(binding: CredentialBinding): void {
    if (this.bindings.has(binding.credentialRef)) throw new Error("CREDENTIAL_REF_ALREADY_REGISTERED");
    if (!/^[A-Z_][A-Z0-9_]*$/.test(binding.envVar)) throw new Error("CREDENTIAL_ENV_VAR_INVALID");
    this.bindings.set(binding.credentialRef, { ...binding, allowedTenants: [...binding.allowedTenants], allowedCapabilities: [...binding.allowedCapabilities] });
  }

  acquire(credentialRef: string, providerId: string, tenantId: string, capability: string): CredentialLease {
    const binding = this.bindings.get(credentialRef);
    if (!binding || !binding.enabled) throw new Error("CREDENTIAL_BINDING_UNAVAILABLE");
    if (binding.providerId !== providerId) throw new Error("CREDENTIAL_PROVIDER_MISMATCH");
    if (!binding.allowedTenants.includes(tenantId)) throw new Error("CREDENTIAL_TENANT_DENIED");
    if (!binding.allowedCapabilities.includes(capability)) throw new Error("CREDENTIAL_CAPABILITY_DENIED");
    const secret = process.env[binding.envVar];
    if (!secret) throw new Error("CREDENTIAL_NOT_PRESENT_IN_ENVIRONMENT");
    return { credentialRef, providerId, secret };
  }

  describe(): Array<Omit<CredentialBinding, "envVar"> & { source: "ENV" }> {
    return [...this.bindings.values()].map(({ envVar: _envVar, ...binding }) => ({ ...binding, source: "ENV" as const }));
  }
}
