import {
  assertMandateAllowsEffect,
  normalizeConstitutionalMandate,
  type ConstitutionalMandate,
  type MandateState
} from "../domain/constitutional-mandate.js";

/**
 * Harmonia's mandate, held in memory by the Coordinator. It gates side effects
 * WITHOUT touching disk on the /run hot path (zero I/O). Harmonia narrows or
 * suspends it through a single call; the Coordinator only reads it.
 *
 * Canon (issue 40 / Etap 0): "mandate != enabled ⇒ side effect must not start."
 * The check runs BEFORE any worker process spawns — not as an after-the-fact abort.
 */
export interface MandatePort {
  assertAllows(effect: string): void;
}

const DEFAULT_MANDATE: ConstitutionalMandate = normalizeConstitutionalMandate({
  constitutionVersion: "1.0.0",
  mandateId: "MND-DEFAULT",
  mandateState: "enabled",
  allowedEffects: [],
  forbiddenEffects: [],
  riskClass: "standard",
  gateRequirements: [],
  issuedAt: "1970-01-01T00:00:00.000Z"
});

export class MandateAuthority implements MandatePort {
  private mandate: ConstitutionalMandate;

  constructor(mandate: ConstitutionalMandate = DEFAULT_MANDATE) {
    this.mandate = normalizeConstitutionalMandate(mandate);
  }

  /** Harmonia's single lever: narrow, suspend or revoke the executive mandate. */
  set(mandate: ConstitutionalMandate): void {
    this.mandate = normalizeConstitutionalMandate(mandate);
  }

  /** Convenience for the common lever — flip the state, keep the rest. */
  setState(state: MandateState): void {
    // Drop the old fingerprint so it is recomputed for the new body, instead of
    // failing the mismatch check against the pre-change value.
    const { governanceFingerprint: _prev, ...body } = this.mandate;
    this.mandate = normalizeConstitutionalMandate({ ...body, mandateState: state });
  }

  current(): ConstitutionalMandate {
    return this.mandate;
  }

  assertAllows(effect: string): void {
    assertMandateAllowsEffect(this.mandate, effect);
  }
}
