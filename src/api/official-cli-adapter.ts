import { spawn } from "node:child_process";
import type { CapabilityRequest } from "./capability-api.js";
import type { ProviderAdapter, ProviderDescriptor, ProviderHealth, ProviderResult } from "./provider-contract.js";
import { SubscriptionSeatBroker } from "./subscription-seat-broker.js";

export type OfficialCliLaunchSpec = {
  descriptor: ProviderDescriptor;
  executable: string;
  versionArgs: string[];
  expectedVersionPattern?: RegExp;
  buildArgs(request: CapabilityRequest): string[];
  parseOutput(stdout: string): unknown;
  timeoutMs?: number;
  maxOutputBytes?: number;
  envAllowList?: string[];
};

async function spawnBounded(
  executable: string,
  args: string[],
  timeoutMs: number,
  maxOutputBytes: number,
  envAllowList: string[] = []
): Promise<{ code: number; stdout: string; stderr: string }> {
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: process.env.HOME };
  for (const key of envAllowList) if (process.env[key] !== undefined) env[key] = process.env[key];

  return await new Promise((resolve, reject) => {
    const child = spawn(executable, args, { shell: false, stdio: ["ignore", "pipe", "pipe"], env });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let size = 0;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeoutMs);
    const append = (bucket: Buffer[]) => (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxOutputBytes) child.kill("SIGKILL");
      else bucket.push(Buffer.from(chunk));
    };
    child.stdout.on("data", append(stdout));
    child.stderr.on("data", append(stderr));
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) return reject(new Error("PROVIDER_TIMEOUT"));
      if (size > maxOutputBytes) return reject(new Error("PROVIDER_OUTPUT_LIMIT_EXCEEDED"));
      resolve({ code: code ?? 1, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") });
    });
  });
}

export class OfficialCliProviderAdapter implements ProviderAdapter {
  readonly descriptor: ProviderDescriptor;
  constructor(private readonly spec: OfficialCliLaunchSpec, private readonly seats?: SubscriptionSeatBroker) {
    if (spec.descriptor.transport !== undefined && spec.descriptor.transport !== "OFFICIAL_CLI") throw new Error("CLI_ADAPTER_TRANSPORT_MISMATCH");
    this.descriptor = { ...spec.descriptor, transport: "OFFICIAL_CLI", supportsHeadless: true };
  }

  async health(): Promise<ProviderHealth> {
    try {
      const result = await spawnBounded(this.spec.executable, this.spec.versionArgs, 5000, 64 * 1024, this.spec.envAllowList);
      if (result.code !== 0) return "UNAVAILABLE";
      const version = `${result.stdout}\n${result.stderr}`.trim();
      if (this.spec.expectedVersionPattern && !this.spec.expectedVersionPattern.test(version)) return "BLOCKED";
      return "HEALTHY";
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return "UNAVAILABLE";
      return "DEGRADED";
    }
  }

  async canExecute(request: CapabilityRequest): Promise<boolean> {
    return this.descriptor.enabled
      && this.descriptor.capabilities.includes(request.capability)
      && this.descriptor.allowedSecurityClasses.includes(request.securityClass);
  }

  async execute<T>(request: CapabilityRequest): Promise<ProviderResult<T>> {
    let seatId: string | undefined;
    if (this.descriptor.accessMode === "SUBSCRIPTION") {
      if (!this.seats) throw new Error("SUBSCRIPTION_SEAT_BROKER_REQUIRED");
      const seat = this.seats.acquire(this.descriptor.providerId, new Date(), request.tenantId, request.capability);
      seatId = seat.seatId;
    }

    try {
      const result = await spawnBounded(
        this.spec.executable,
        this.spec.buildArgs(request),
        this.spec.timeoutMs ?? 120_000,
        this.spec.maxOutputBytes ?? 2 * 1024 * 1024,
        this.spec.envAllowList
      );
      if (result.code !== 0) {
        const stderr = result.stderr.slice(0, 1000);
        if (/auth|login|unauthor/i.test(stderr)) throw new Error("AUTH_REQUIRED");
        if (/rate|quota|limit/i.test(stderr)) throw new Error("RATE_LIMITED");
        throw new Error(`PROVIDER_CLI_EXIT_${result.code}:${stderr}`);
      }
      const output = this.spec.parseOutput(result.stdout) as T;
      return { output, ...(seatId === undefined ? {} : { seatId }) };
    } finally {
      if (seatId !== undefined) this.seats?.release(seatId);
    }
  }
}

function promptFor(request: CapabilityRequest): string {
  return JSON.stringify({ capability: request.capability, purposeId: request.purposeId, input: request.input });
}

function parseJsonOrText(stdout: string): unknown {
  const trimmed = stdout.trim();
  try { return JSON.parse(trimmed) as unknown; } catch { return trimmed; }
}

export function officialSubscriptionLaunchSpecs(): OfficialCliLaunchSpec[] {
  const common = {
    capabilities: ["ai.code", "ai.reasoning", "ai.review"],
    allowedSecurityClasses: ["S0", "S1", "S2"] as const,
    external: true,
    priority: 10,
    enabled: true,
    accessMode: "SUBSCRIPTION" as const,
    authMode: "SUBSCRIPTION_OAUTH" as const,
    billingMode: "SUBSCRIPTION_INCLUDED" as const,
    supportsHeadless: true,
    supportsStructuredOutput: true
  };
  return [
    {
      descriptor: { ...common, providerId: "openai-codex-sub" },
      executable: "codex",
      versionArgs: ["--version"],
      buildArgs: (request) => ["exec", promptFor(request)],
      parseOutput: parseJsonOrText
    },
    {
      descriptor: { ...common, providerId: "claude-code-sub" },
      executable: "claude",
      versionArgs: ["--version"],
      buildArgs: (request) => ["-p", promptFor(request), "--output-format", "json"],
      parseOutput: parseJsonOrText
    },
    {
      descriptor: { ...common, providerId: "gemini-cli-sub" },
      executable: "gemini",
      versionArgs: ["--version"],
      buildArgs: (request) => ["-p", promptFor(request), "--output-format", "json", "--sandbox"],
      parseOutput: parseJsonOrText
    },
    {
      descriptor: { ...common, providerId: "github-copilot-sub" },
      executable: "copilot",
      versionArgs: ["--version"],
      buildArgs: (request) => ["-p", promptFor(request), "--output-format=json"],
      parseOutput: parseJsonOrText
    }
  ];
}
