import type { Digest } from "../domain/ids.js";
import type { ProviderAccessMode } from "./provider-contract.js";

export type ProviderExecutionReceipt = {
  requestFp: Digest;
  capability: string;
  providerId: string;
  accessMode: ProviderAccessMode;
  inputFp: Digest;
  outputFp?: Digest;
  startedAt: string;
  completedAt: string;
  result: "SUCCESS" | "FAIL";
  failureCode?: string;
  receiptFp: Digest;
};
