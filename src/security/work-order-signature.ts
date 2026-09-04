import { sign as cryptoSign, verify as cryptoVerify, type KeyObject } from "node:crypto";
import { canonicalDigest, canonicalJson } from "../crypto/canonical-digest.js";
import type { Digest } from "../domain/ids.js";
import type { WorkOrder } from "../domain/work-order.js";

export type SignedWorkOrder = {
  order: WorkOrder;
  orderFp: Digest;
  keyId: string;
  signatureBase64: string;
};

export function signWorkOrder(order: WorkOrder, keyId: string, privateKey: KeyObject): SignedWorkOrder {
  const payload = Buffer.from(canonicalJson(order), "utf8");
  return {
    order,
    orderFp: canonicalDigest(order),
    keyId,
    signatureBase64: cryptoSign(null, payload, privateKey).toString("base64")
  };
}

export function verifySignedWorkOrder(envelope: SignedWorkOrder, publicKey: KeyObject): boolean {
  if (envelope.orderFp !== canonicalDigest(envelope.order)) return false;
  return cryptoVerify(
    null,
    Buffer.from(canonicalJson(envelope.order), "utf8"),
    publicKey,
    Buffer.from(envelope.signatureBase64, "base64")
  );
}
