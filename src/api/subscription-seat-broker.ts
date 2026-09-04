export type QuotaState = "OK" | "LOW" | "EXHAUSTED" | "UNKNOWN";

export type SubscriptionSeat = {
  seatId: string;
  providerId: string;
  accountRef: string;
  credentialRef?: string;
  principalId?: string;
  planLabel?: string;
  allowedTenants?: string[];
  allowedCapabilities?: string[];
  maxConcurrentJobs?: number;
  activeJobs?: number;
  quotaState?: QuotaState;
  status: "AVAILABLE" | "BUSY" | "EXHAUSTED" | "REVOKED";
  validUntil?: string;
  enabled?: boolean;
};

export class SubscriptionSeatBroker {
  constructor(private readonly seats: SubscriptionSeat[]) {}

  acquire(providerId: string, now: Date, tenantId?: string, capability?: string): SubscriptionSeat {
    const seat = this.seats.find((candidate) => {
      const quota = candidate.quotaState ?? (candidate.status === "EXHAUSTED" ? "EXHAUSTED" : "UNKNOWN");
      const active = candidate.activeJobs ?? (candidate.status === "BUSY" ? 1 : 0);
      const limit = candidate.maxConcurrentJobs ?? 1;
      return candidate.providerId === providerId
        && candidate.status !== "REVOKED"
        && candidate.status !== "EXHAUSTED"
        && candidate.enabled !== false
        && quota !== "EXHAUSTED"
        && active < limit
        && (candidate.validUntil === undefined || new Date(candidate.validUntil) > now)
        && (tenantId === undefined || candidate.allowedTenants === undefined || candidate.allowedTenants.includes(tenantId))
        && (capability === undefined || candidate.allowedCapabilities === undefined || candidate.allowedCapabilities.includes(capability));
    });
    if (!seat) throw new Error(`NO_SUBSCRIPTION_SEAT:${providerId}`);
    seat.activeJobs = (seat.activeJobs ?? 0) + 1;
    seat.status = (seat.activeJobs ?? 0) >= (seat.maxConcurrentJobs ?? 1) ? "BUSY" : "AVAILABLE";
    return { ...seat };
  }

  release(seatId: string): void {
    const seat = this.seats.find((candidate) => candidate.seatId === seatId);
    if (!seat) throw new Error("SUBSCRIPTION_SEAT_NOT_FOUND");
    seat.activeJobs = Math.max(0, (seat.activeJobs ?? 1) - 1);
    if (seat.status !== "REVOKED" && seat.status !== "EXHAUSTED") seat.status = "AVAILABLE";
  }

  setQuota(seatId: string, quotaState: QuotaState): void {
    const seat = this.seats.find((candidate) => candidate.seatId === seatId);
    if (!seat) throw new Error("SUBSCRIPTION_SEAT_NOT_FOUND");
    seat.quotaState = quotaState;
    if (quotaState === "EXHAUSTED") seat.status = "EXHAUSTED";
  }

  snapshot(): SubscriptionSeat[] { return this.seats.map((seat) => ({ ...seat })); }
}
