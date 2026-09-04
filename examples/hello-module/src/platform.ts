export type CapabilityCall = {
  capability: string;
  input: unknown;
  purposeId: string;
};

export interface CapabilityApi {
  execute<T = unknown>(request: CapabilityCall): Promise<T>;
}
