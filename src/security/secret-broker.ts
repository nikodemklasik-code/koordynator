import { createHmac, randomUUID } from "node:crypto";
import type { Digest } from "../domain/ids.js";

export type TicketAudience = "hermes" | "opencode" | "playwright" | "audit" | "deploy";

export type CapabilityTicket = {
  ticketId: string;
  audience: TicketAudience;
  endpoint: string;
  model: string;
  taskId: string;
  contractFp: Digest;
  issuedAt: string;
  expiresAt: string;
};

export type VaultStatus = {
  reachable: boolean;
  sealed: boolean;
};

export function issueCapabilityTicket(
  vault: VaultStatus,
  signingKey: Buffer,
  ticket: {
    audience: TicketAudience;
    endpoint: string;
    model: string;
    taskId: string;
    contractFp: Digest;
  },
  ttlMs = 5 * 60_000,
  now = new Date()
): { ticket: CapabilityTicket; token: string } {
  if (!vault.reachable || vault.sealed) throw new Error("VAULT_UNAVAILABLE");
  if (signingKey.length < 16) throw new Error("TICKET_SIGNING_KEY_WEAK");

  const sealed: CapabilityTicket = {
    ...ticket,
    ticketId: randomUUID(),
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString()
  };

  const body = Buffer.from(JSON.stringify(sealed)).toString("base64url");
  const mac = createHmac("sha256", signingKey).update(body).digest("base64url");
  return { ticket: sealed, token: `${body}.${mac}` };
}
