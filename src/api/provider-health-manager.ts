import type { ProviderAdapter, ProviderHealth } from "./provider-contract.js";

export type ProviderHealthManagerOptions = {
  ttlMs?: number;
  cooldownMs?: number;
  failureThreshold?: number;
  clock?: () => number;
};

type RuntimeHealth = {
  health?: ProviderHealth;
  expiresAt: number;
  consecutiveFailures: number;
  cooldownUntil?: number;
};

export type ProviderRuntimeSnapshot = {
  providerId: string;
  health: ProviderHealth | "UNKNOWN";
  consecutiveFailures: number;
  cooldownUntil?: number;
};

export class ProviderHealthManager {
  private readonly state = new Map<string, RuntimeHealth>();
  private readonly ttlMs: number;
  private readonly cooldownMs: number;
  private readonly failureThreshold: number;
  private readonly clock: () => number;

  constructor(options: ProviderHealthManagerOptions = {}) {
    this.ttlMs = options.ttlMs ?? 15_000;
    this.cooldownMs = options.cooldownMs ?? 60_000;
    this.failureThreshold = options.failureThreshold ?? 2;
    this.clock = options.clock ?? Date.now;
  }

  async health(provider: ProviderAdapter): Promise<ProviderHealth> {
    const id = provider.descriptor.providerId;
    const now = this.clock();
    const current = this.state.get(id);
    if (current?.cooldownUntil !== undefined && current.cooldownUntil > now) {
      return current.health === "RATE_LIMITED" ? "RATE_LIMITED" : "UNAVAILABLE";
    }
    if (current?.health !== undefined && current.expiresAt > now) return current.health;

    const health = await provider.health();
    this.state.set(id, {
      health,
      expiresAt: now + this.ttlMs,
      consecutiveFailures: health === "HEALTHY" ? 0 : current?.consecutiveFailures ?? 0
    });
    return health;
  }

  recordSuccess(providerId: string): void {
    const now = this.clock();
    this.state.set(providerId, {
      health: "HEALTHY",
      expiresAt: now + this.ttlMs,
      consecutiveFailures: 0
    });
  }

  recordFailure(providerId: string, failureCode: string): void {
    const now = this.clock();
    const previous = this.state.get(providerId);
    const failures = (previous?.consecutiveFailures ?? 0) + 1;
    const upper = failureCode.toUpperCase();

    if (upper.includes("AUTH")) {
      this.state.set(providerId, { health: "AUTH_REQUIRED", expiresAt: now + this.ttlMs, consecutiveFailures: failures });
      return;
    }

    if (upper.includes("RATE") || upper.includes("QUOTA") || upper.includes("429")) {
      this.state.set(providerId, {
        health: "RATE_LIMITED",
        expiresAt: now + this.ttlMs,
        consecutiveFailures: failures,
        cooldownUntil: now + this.cooldownMs
      });
      return;
    }

    if (failures >= this.failureThreshold) {
      this.state.set(providerId, {
        health: "UNAVAILABLE",
        expiresAt: now + this.ttlMs,
        consecutiveFailures: failures,
        cooldownUntil: now + this.cooldownMs
      });
      return;
    }

    this.state.set(providerId, { health: "DEGRADED", expiresAt: now + this.ttlMs, consecutiveFailures: failures });
  }

  snapshot(providerId: string): ProviderRuntimeSnapshot {
    const current = this.state.get(providerId);
    return {
      providerId,
      health: current?.health ?? "UNKNOWN",
      consecutiveFailures: current?.consecutiveFailures ?? 0,
      ...(current?.cooldownUntil === undefined ? {} : { cooldownUntil: current.cooldownUntil })
    };
  }
}
