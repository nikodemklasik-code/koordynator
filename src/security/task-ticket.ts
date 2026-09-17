import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export type TicketAudience = "hermes" | "opencode" | "playwright";

export type TaskTicketClaims = {
  jti: string;
  aud: TicketAudience;
  iat: number;
  exp: number;
  model: string;
};

const AUDIENCES = new Set<TicketAudience>(["hermes", "opencode", "playwright"]);

function b64url(value: Buffer | string): string {
  const buffer = typeof value === "string" ? Buffer.from(value, "utf8") : value;
  return buffer.toString("base64url");
}

function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function equal(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function mintTaskTicket(
  secret: string,
  input: { aud: TicketAudience; model: string; ttlMs?: number; now?: number }
): { token: string; claims: TaskTicketClaims } {
  if (!secret.trim()) throw new Error("TICKET_SECRET_REQUIRED");
  if (!AUDIENCES.has(input.aud)) throw new Error("TICKET_AUDIENCE_INVALID");
  if (!input.model.trim()) throw new Error("TICKET_MODEL_REQUIRED");
  const now = input.now ?? Date.now();
  const ttlMs = input.ttlMs ?? 30 * 60_000;
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error("TICKET_TTL_INVALID");
  const claims: TaskTicketClaims = {
    jti: randomUUID(),
    aud: input.aud,
    iat: now,
    exp: now + ttlMs,
    model: input.model.trim()
  };
  const payload = b64url(JSON.stringify(claims));
  return { token: `tkt.${payload}.${sign(secret, payload)}`, claims };
}

export function verifyTaskTicket(secret: string, token: string, now = Date.now()): TaskTicketClaims {
  if (!secret.trim()) throw new Error("TICKET_SECRET_REQUIRED");
  const match = /^tkt\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(token.trim());
  if (!match) throw new Error("TICKET_INVALID");
  const payload = match[1]!;
  const signature = match[2]!;
  if (!equal(sign(secret, payload), signature)) throw new Error("TICKET_INVALID");
  let claims: TaskTicketClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as TaskTicketClaims;
  } catch {
    throw new Error("TICKET_INVALID");
  }
  if (!AUDIENCES.has(claims.aud) || !claims.jti || !claims.model) throw new Error("TICKET_INVALID");
  if (claims.exp <= now) throw new Error("TICKET_EXPIRED");
  return claims;
}

export function bearerTicket(header: string | undefined): string {
  const match = /^Bearer\s+(\S+)$/i.exec(String(header ?? "").trim());
  if (!match) throw new Error("TICKET_REQUIRED");
  return match[1]!;
}
