import type { CapabilityApi } from "./platform.js";

export async function hello(platform: CapabilityApi, name: string): Promise<unknown> {
  return platform.execute({
    capability: "ai.reasoning",
    input: { task: "greet", name },
    purposeId: "hello-module.greet"
  });
}
