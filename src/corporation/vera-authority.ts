/**
 * Thin TypeScript projection of the existing HLP VERA T0 bridge.
 *
 * Source authority lives in Harmonia-Legal-Platform/develop:
 *   composition/core_bridge_protocol.json
 *   core/hlp-vera/crates/vera-core-runtime
 *
 * This file deliberately does not reproduce VERA policy, capability or effect
 * semantics. It only names the closed RPC surface Corporation is allowed to
 * call. Truth remains HLL authority; execution authority remains VERA.
 */

export const VERA_CORE_BRIDGE_PROTOCOL = "hlp-vera-core-bridge/2" as const;

export type VeraRight =
  | "ReadObject"
  | "Propose"
  | "Check"
  | "Promote"
  | "ExecuteEffect"
  | "WriteCanonical"
  | "AdministerSecurity";

export type VeraEffectKind =
  | "EmailSend"
  | "ExportFile"
  | "CalendarWrite"
  | "DmsWrite"
  | "Print"
  | "ExternalApi"
  | "InstallRelease"
  | "UpdateRelease"
  | "RollbackRelease";

export type VeraRpcMethod =
  | "core.health"
  | "capability.issue"
  | "capability.revoke"
  | "access.evaluate"
  | "human_act.record"
  | "effect.prepare"
  | "effect.consume"
  | "effect.receipt"
  | "audit.verify";

export type VeraOpaqueRef = Record<string, unknown>;

export interface VeraRpcPort {
  call<T = unknown>(method: VeraRpcMethod, params: Record<string, unknown>): Promise<T>;
}

export type VeraHealth = {
  status: string;
  trust: string;
  legal_semantics: boolean;
};

export type VeraCapabilityIssueRequest = {
  subject: string;
  issuer: string;
  scope: string;
  rights: VeraRight[];
  object_bound: VeraOpaqueRef | null;
  policy: VeraOpaqueRef;
  not_before: number;
  expires_at: number;
};

export type VeraEffectIntent = {
  intent_ref: VeraOpaqueRef;
  actor: string;
  scope: string;
  kind: VeraEffectKind;
  adapter: string;
  payload_ref: VeraOpaqueRef;
  target_hash: unknown | null;
};

export type VeraPreparedEffect = {
  permitId: string;
};

export type VeraConsumedEffect = {
  consumedPermit: VeraOpaqueRef;
};

function nonEmpty(value: string, code: string): string {
  const clean = value.trim();
  if (!clean) throw new Error(code);
  return clean;
}

function asObject(value: unknown, code: string): VeraOpaqueRef {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as VeraOpaqueRef;
}

function asString(value: unknown, code: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(code);
  return value;
}

export class VeraCoreAuthority {
  constructor(private readonly rpc: VeraRpcPort) {}

  async health(): Promise<VeraHealth> {
    const result = asObject(await this.rpc.call("core.health", {}), "VERA_HEALTH_INVALID");
    if (typeof result.status !== "string" || typeof result.trust !== "string" || typeof result.legal_semantics !== "boolean") {
      throw new Error("VERA_HEALTH_INVALID");
    }
    if (result.trust !== "T0") throw new Error("VERA_TRUST_BOUNDARY_INVALID");
    if (result.legal_semantics !== false) throw new Error("VERA_MUST_NOT_CLAIM_LEGAL_SEMANTICS");
    return {
      status: result.status,
      trust: result.trust,
      legal_semantics: result.legal_semantics
    };
  }

  async issueCapability(request: VeraCapabilityIssueRequest): Promise<string> {
    if (!request.rights.length) throw new Error("VERA_CAPABILITY_RIGHTS_REQUIRED");
    if (!Number.isSafeInteger(request.not_before) || !Number.isSafeInteger(request.expires_at)) {
      throw new Error("VERA_CAPABILITY_WINDOW_INVALID");
    }
    if (request.expires_at <= request.not_before) throw new Error("VERA_CAPABILITY_WINDOW_INVALID");

    return asString(await this.rpc.call("capability.issue", {
      request: {
        subject: nonEmpty(request.subject, "VERA_CAPABILITY_SUBJECT_REQUIRED"),
        issuer: nonEmpty(request.issuer, "VERA_CAPABILITY_ISSUER_REQUIRED"),
        scope: nonEmpty(request.scope, "VERA_CAPABILITY_SCOPE_REQUIRED"),
        rights: [...new Set(request.rights)],
        object_bound: request.object_bound,
        policy: structuredClone(request.policy),
        not_before: request.not_before,
        expires_at: request.expires_at
      }
    }), "VERA_CAPABILITY_ID_INVALID");
  }

  async revokeCapability(capabilityId: string, reason: string): Promise<void> {
    await this.rpc.call("capability.revoke", {
      capability_id: nonEmpty(capabilityId, "VERA_CAPABILITY_ID_REQUIRED"),
      reason: nonEmpty(reason, "VERA_REVOCATION_REASON_REQUIRED")
    });
  }

  async evaluateAccess(input: {
    capabilityId: string;
    actorId: string;
    scopeId: string;
    right: VeraRight;
    objectRef?: VeraOpaqueRef | null;
  }): Promise<VeraOpaqueRef> {
    return asObject(await this.rpc.call("access.evaluate", {
      capability_id: nonEmpty(input.capabilityId, "VERA_CAPABILITY_ID_REQUIRED"),
      actor_id: nonEmpty(input.actorId, "VERA_ACTOR_ID_REQUIRED"),
      scope_id: nonEmpty(input.scopeId, "VERA_SCOPE_ID_REQUIRED"),
      right: input.right,
      object_ref: input.objectRef ?? null
    }), "VERA_ACCESS_RESPONSE_INVALID");
  }

  async recordHumanAct(input: {
    kind: "Attestation" | "Approval" | "Override" | "Acknowledgement";
    actorId: string;
    roleId: string;
    subjectRef: VeraOpaqueRef;
    rationale: string;
  }): Promise<VeraOpaqueRef> {
    return asObject(await this.rpc.call("human_act.record", {
      kind: input.kind,
      actor_id: nonEmpty(input.actorId, "VERA_ACTOR_ID_REQUIRED"),
      role_id: nonEmpty(input.roleId, "VERA_ROLE_ID_REQUIRED"),
      subject_ref: structuredClone(input.subjectRef),
      rationale: nonEmpty(input.rationale, "VERA_HUMAN_ACT_RATIONALE_REQUIRED")
    }), "VERA_HUMAN_ACT_RESPONSE_INVALID");
  }

  async prepareEffect(input: {
    intent: VeraEffectIntent;
    actorId: string;
    capabilityId: string;
    policyRef: VeraOpaqueRef;
    verifiedEffectReceiptIds: string[];
    requestedTtlMs: number;
  }): Promise<VeraPreparedEffect> {
    if (!Number.isSafeInteger(input.requestedTtlMs) || input.requestedTtlMs <= 0) {
      throw new Error("VERA_EFFECT_TTL_INVALID");
    }
    const permitId = asString(await this.rpc.call("effect.prepare", {
      intent: structuredClone(input.intent),
      actor_id: nonEmpty(input.actorId, "VERA_ACTOR_ID_REQUIRED"),
      capability_id: nonEmpty(input.capabilityId, "VERA_CAPABILITY_ID_REQUIRED"),
      policy_ref: structuredClone(input.policyRef),
      verified_effect_receipt_ids: [...new Set(input.verifiedEffectReceiptIds)],
      requested_ttl_ms: input.requestedTtlMs
    }), "VERA_EFFECT_PERMIT_ID_INVALID");

    return { permitId };
  }

  async consumeEffect(input: {
    permitId: string;
    actorId: string;
    capabilityId: string;
    adapterId: string;
    payloadRef: VeraOpaqueRef;
    targetHash: unknown | null;
  }): Promise<VeraConsumedEffect> {
    const result = asObject(await this.rpc.call("effect.consume", {
      permit_id: nonEmpty(input.permitId, "VERA_EFFECT_PERMIT_ID_REQUIRED"),
      actor_id: nonEmpty(input.actorId, "VERA_ACTOR_ID_REQUIRED"),
      capability_id: nonEmpty(input.capabilityId, "VERA_CAPABILITY_ID_REQUIRED"),
      adapter_id: nonEmpty(input.adapterId, "VERA_ADAPTER_ID_REQUIRED"),
      payload_ref: structuredClone(input.payloadRef),
      target_hash: input.targetHash
    }), "VERA_CONSUMED_PERMIT_INVALID");

    return { consumedPermit: result };
  }

  async recordEffectReceipt(input: {
    consumedPermit: VeraOpaqueRef;
    actorId: string;
    adapterResultHash: unknown;
    status: string;
  }): Promise<VeraOpaqueRef> {
    return asObject(await this.rpc.call("effect.receipt", {
      consumed_permit: structuredClone(input.consumedPermit),
      actor_id: nonEmpty(input.actorId, "VERA_ACTOR_ID_REQUIRED"),
      adapter_result_hash: input.adapterResultHash,
      status: nonEmpty(input.status, "VERA_EFFECT_STATUS_REQUIRED")
    }), "VERA_EFFECT_RECEIPT_INVALID");
  }

  async verifyAudit(scopeId: string): Promise<void> {
    await this.rpc.call("audit.verify", {
      scope_id: nonEmpty(scopeId, "VERA_SCOPE_ID_REQUIRED")
    });
  }
}
