import { randomUUID } from "node:crypto";
import type { NoveltySourceKind } from "./innovation.js";

export type NoveltySourceDescriptor = {
  sourceId: string;
  name: string;
  kind: NoveltySourceKind;
  connectorId: string;
  topics: string[];
  enabled: boolean;
  externalDependency: boolean;
  costClass: "LOCAL" | "FREE" | "INCLUDED_CREDITS" | "SUBSCRIPTION" | "PAID";
  trustClass: "PRIMARY" | "OFFICIAL" | "SECONDARY" | "COMMUNITY";
  pollingPolicy: "EVENT" | "HOURLY" | "DAILY" | "WEEKLY" | "MANUAL";
  lastSuccessfulIngestAt?: string;
};

export type NoveltyIntakeItem = {
  intakeId: string;
  sourceId: string;
  externalId: string;
  title: string;
  summary: string;
  publishedAt?: string;
  sourceRef: string;
  evidenceRefs: string[];
  observedAt: string;
};

export interface NoveltySourceConnector {
  connectorId: string;
  fetch(source: NoveltySourceDescriptor): Promise<NoveltyIntakeItem[]>;
}

export class NoveltySourceRegistry {
  private readonly sources = new Map<string, NoveltySourceDescriptor>();
  private readonly connectors = new Map<string, NoveltySourceConnector>();
  private readonly seen = new Set<string>();

  registerConnector(connector: NoveltySourceConnector): void {
    if (this.connectors.has(connector.connectorId)) {
      throw new Error(`NOVELTY_CONNECTOR_EXISTS:${connector.connectorId}`);
    }
    this.connectors.set(connector.connectorId, connector);
  }

  registerSource(input: Omit<NoveltySourceDescriptor, "sourceId"> & { sourceId?: string }): NoveltySourceDescriptor {
    if (!this.connectors.has(input.connectorId)) throw new Error("NOVELTY_CONNECTOR_NOT_FOUND");
    const source: NoveltySourceDescriptor = {
      ...input,
      sourceId: input.sourceId ?? `SOURCE-${randomUUID().slice(0, 10).toUpperCase()}`,
      topics: [...new Set(input.topics)]
    };
    this.sources.set(source.sourceId, source);
    return structuredClone(source);
  }

  async ingest(sourceId: string): Promise<NoveltyIntakeItem[]> {
    const source = this.sources.get(sourceId);
    if (!source) throw new Error("NOVELTY_SOURCE_NOT_FOUND");
    if (!source.enabled) return [];
    const connector = this.connectors.get(source.connectorId);
    if (!connector) throw new Error("NOVELTY_CONNECTOR_NOT_FOUND");

    const raw = await connector.fetch(structuredClone(source));
    const fresh: NoveltyIntakeItem[] = [];

    for (const item of raw) {
      const dedupeKey = `${source.sourceId}:${item.externalId}`;
      if (this.seen.has(dedupeKey)) continue;
      this.seen.add(dedupeKey);
      fresh.push({
        ...item,
        intakeId: item.intakeId || `INTAKE-${randomUUID().slice(0, 10).toUpperCase()}`,
        sourceId: source.sourceId,
        evidenceRefs: [...new Set(item.evidenceRefs)]
      });
    }

    source.lastSuccessfulIngestAt = new Date().toISOString();
    return fresh;
  }

  listSources(): NoveltySourceDescriptor[] {
    return [...this.sources.values()].map((item) => structuredClone(item));
  }

  coverage(): {
    total: number;
    enabled: number;
    nonPaid: number;
    nonExternal: number;
    primaryOrOfficial: number;
  } {
    const all = [...this.sources.values()];
    return {
      total: all.length,
      enabled: all.filter((item) => item.enabled).length,
      nonPaid: all.filter((item) => ["LOCAL", "FREE", "INCLUDED_CREDITS"].includes(item.costClass)).length,
      nonExternal: all.filter((item) => !item.externalDependency).length,
      primaryOrOfficial: all.filter((item) => ["PRIMARY", "OFFICIAL"].includes(item.trustClass)).length
    };
  }
}
