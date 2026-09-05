import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { OfficialCliProviderAdapter, officialSubscriptionLaunchSpecs } from "../api/official-cli-adapter.js";
import type { ProviderDescriptor, ProviderHealth } from "../api/provider-contract.js";
import { FileProviderReceiptStore } from "../api/provider-receipt-store.js";
import type { ProviderExecutionReceipt } from "../api/provider-receipt.js";

export type ProviderSummary = {
  providerId: string;
  executable: string;
  health: ProviderHealth;
  descriptor: ProviderDescriptor;
  doctorCommand: string;
  connectCommand: string;
  checkedAt: string;
};

export type ProviderFabricView = {
  mode: "OFFICIAL_CLI";
  providers: ProviderSummary[];
  receipts: ProviderExecutionReceipt[];
  architecture: {
    capabilityBoundary: "CANONICAL_CAPABILITY_API";
    diversityRule: "BUILDER_NE_REVIEWER_WHEN_REQUIRED";
    failoverRule: "IDEMPOTENCY_KEY_REQUIRED";
    credentialRule: "NO_BROWSER_PASSWORD_OR_COOKIE_CAPTURE";
  };
};

const HEALTH_TTL_MS = 15_000;

export class ProviderReadModel {
  private readonly healthCache = new Map<string, { health: ProviderHealth; checkedAt: string; expiresAt: number }>();

  constructor(private readonly receiptRoot: string) {}

  private spec(providerId: string) {
    return officialSubscriptionLaunchSpecs().find((item) => item.descriptor.providerId === providerId);
  }

  async doctor(providerId: string, force = false): Promise<ProviderSummary | null> {
    const spec = this.spec(providerId);
    if (!spec) return null;
    const cached = this.healthCache.get(providerId);
    const now = Date.now();
    let health: ProviderHealth;
    let checkedAt: string;
    if (!force && cached && cached.expiresAt > now) {
      health = cached.health;
      checkedAt = cached.checkedAt;
    } else {
      health = await new OfficialCliProviderAdapter(spec).health();
      checkedAt = new Date().toISOString();
      this.healthCache.set(providerId, { health, checkedAt, expiresAt: now + HEALTH_TTL_MS });
    }
    return {
      providerId,
      executable: spec.executable,
      health,
      descriptor: { ...spec.descriptor, transport: "OFFICIAL_CLI" },
      doctorCommand: `orchestrator provider doctor`,
      connectCommand: `orchestrator provider connect ${providerId}`,
      checkedAt
    };
  }

  async providers(force = false): Promise<ProviderSummary[]> {
    return Promise.all(officialSubscriptionLaunchSpecs().map(async (spec) => (await this.doctor(spec.descriptor.providerId, force))!));
  }

  async receipts(limit = 50): Promise<ProviderExecutionReceipt[]> {
    let taskDirs: string[];
    try {
      taskDirs = (await readdir(this.receiptRoot, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && /^TASK-[A-Za-z0-9._-]+$/.test(entry.name))
        .map((entry) => entry.name)
        .sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const store = new FileProviderReceiptStore(this.receiptRoot);
    const groups = await Promise.all(taskDirs.map((name) => store.listByTask(name as `TASK-${string}`)));
    return groups.flat().sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.receiptFp.localeCompare(a.receiptFp)).slice(0, limit);
  }

  async view(force = false): Promise<ProviderFabricView> {
    return {
      mode: "OFFICIAL_CLI",
      providers: await this.providers(force),
      receipts: await this.receipts(),
      architecture: {
        capabilityBoundary: "CANONICAL_CAPABILITY_API",
        diversityRule: "BUILDER_NE_REVIEWER_WHEN_REQUIRED",
        failoverRule: "IDEMPOTENCY_KEY_REQUIRED",
        credentialRule: "NO_BROWSER_PASSWORD_OR_COOKIE_CAPTURE"
      }
    };
  }
}

export function providerReceiptRoot(stateDir: string): string {
  return join(stateDir, "provider-receipts");
}
