export type SubscriptionSeat = {
  seatId: string;
  providerId: string;
  accountRef: string;
  status: "AVAILABLE" | "BUSY" | "EXHAUSTED" | "REVOKED";
  validUntil?: string;
};

export class SubscriptionSeatBroker {
  constructor(private readonly seats: SubscriptionSeat[]) {}

  acquire(providerId: string, now: Date): SubscriptionSeat {
    const seat = this.seats.find((candidate) =>
      candidate.providerId === providerId
      && candidate.status === "AVAILABLE"
      && (candidate.validUntil === undefined || new Date(candidate.validUntil) > now)
    );
    if (!seat) throw new Error(`NO_SUBSCRIPTION_SEAT:${providerId}`);
    seat.status = "BUSY";
    return { ...seat };
  }

  release(seatId: string): void {
    const seat = this.seats.find((candidate) => candidate.seatId === seatId);
    if (!seat) throw new Error("SUBSCRIPTION_SEAT_NOT_FOUND");
    if (seat.status === "BUSY") seat.status = "AVAILABLE";
  }
}
