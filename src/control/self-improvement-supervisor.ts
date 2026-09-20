import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export type SelfImprovementIncidentKind =
  | "CONFIG_DRIFT"
  | "PROVIDER_DOWN"
  | "MODEL_ROUTE_BAD"
  | "TOOL_CAPABILITY_MISMATCH"
  | "GITHUB_AUTH"
  | "REPOSITORY_CONTEXT_FAILURE"
  | "BUILD_FAILURE"
  | "TEST_REGRESSION"
  | "UI_REGRESSION"
  | "SECRET_OR_AUTH_REQUIRED"
  | "FREE_TIER_OPPORTUNITY"
  | "DEPENDENCY_UPDATE"
  | "PERFORMANCE_REGRESSION"
  | "HERMES_STOPPED"
  | "UNKNOWN";

export type SelfImprovementRisk = "LOW" | "MEDIUM" | "HIGH";
export type SelfImprovementIncidentStatus = "OPEN" | "REPAIRING" | "VERIFIED" | "RESOLVED" | "ESCALATED";
export type SelfImprovementRepairAction = "START_HERMES" | "REFRESH_ROUTES" | "NONE";

export type SelfImprovementIncident = {
  incidentId: string;
  key: string;
  kind: SelfImprovementIncidentKind;
  status: SelfImprovementIncidentStatus;
  risk: SelfImprovementRisk;
  summary: string;
  evidence: string[];
  detectedAt: string;
  updatedAt: string;
  attempts: number;
  maxAttempts: number;
  approvalRequired: boolean;
  repairAction: SelfImprovementRepairAction;
};

export type SelfImprovementOpportunity = {
  opportunityId: string;
  family: string;
  label: string;
  model: string;
  action: string;
  detail: string;
  requiresApproval: boolean;
  checkedAt: string;
};

export type SelfImprovementReceipt = {
  receiptId: string;
  incidentId: string;
  action: SelfImprovementRepairAction;
  startedAt: string;
  finishedAt: string;
  status: "PASS" | "FAIL" | "BLOCKED";
  evidence: string[];
};

export type SelfImprovementSnapshot = {
  enabled: boolean;
  paused: boolean;
  scanIntervalMs: number;
  autoRepairLowRisk: boolean;
  lastScanAt: string | null;
  incidents: SelfImprovementIncident[];
  opportunities: SelfImprovementOpportunity[];
  receipts: SelfImprovementReceipt[];
  policy: {
    maxRepairAttempts: number;
    oneRepairLeaseAtATime: true;
    isolatedCodeRepairs: true;
    paidFallbackAutoEnable: false;
    secretScraping: false;
    approvalRequiredFor: string[];
  };
};

export type SelfImprovementProbeOptions = {
  stateDir: string;
  enabled?: boolean;
  scanIntervalMs?: number;
  autoRepairLowRisk?: boolean;
  githubStatus: () => Promise<{ state?: string; repositoryAccess?: boolean; connectionMethod?: string }>;
  hermesStatus: () => { running?: boolean; sessionId?: string | null; pid?: number | null };
  hermesGrant: () => Promise<{ terminal?: boolean; localFiles?: boolean; localRoots?: string[] }>;
  omniRoutes: (force?: boolean) => Promise<Array<{
    providerId?: string;
    family?: string;
    label?: string;
    model?: string;
    health?: string;
    connectAction?: string;
    detail?: string;
    checkedAt?: string;
  }>>;
  startHermes?: () => Promise<{ sessionId?: string | null; pid?: number | null }>;
};

export class SelfImprovementError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
    this.name = "SelfImprovementError";
  }
}

const DEFAULT_INTERVAL_MS = 5 * 60_000;
const MIN_INTERVAL_MS = 60_000;
const MAX_INTERVAL_MS = 24 * 60 * 60_000;
const MAX_RECEIPTS = 200;
const FREE_FAMILIES = new Set([
  "opencode-free",
  "duckduckgo",
  "uncloseai",
  "aihorde",
  "gemini",
  "kiro",
  "amazonq"
]);

function iso(): string {
  return new Date().toISOString();
}

function clampInterval(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_INTERVAL_MS;
  return Math.max(MIN_INTERVAL_MS, Math.min(MAX_INTERVAL_MS, Math.floor(value!)));
}

function incidentIdFor(key: string): string {
  return `INCIDENT-${Buffer.from(key).toString("hex").slice(0, 24).toUpperCase()}`;
}

function opportunityIdFor(family: string): string {
  return `FREE-${family.replace(/[^A-Za-z0-9._-]+/g, "-").toUpperCase()}`;
}

function defaultSnapshot(options: SelfImprovementProbeOptions): SelfImprovementSnapshot {
  return {
    enabled: options.enabled !== false,
    paused: false,
    scanIntervalMs: clampInterval(options.scanIntervalMs),
    autoRepairLowRisk: options.autoRepairLowRisk !== false,
    lastScanAt: null,
    incidents: [],
    opportunities: [],
    receipts: [],
    policy: {
      maxRepairAttempts: 3,
      oneRepairLeaseAtATime: true,
      isolatedCodeRepairs: true,
      paidFallbackAutoEnable: false,
      secretScraping: false,
      approvalRequiredFor: [
        "OAuth/browser consent",
        "new provider account",
        "API-key creation",
        "billing/card changes",
        "secret changes",
        "destructive filesystem or git operations",
        "production deployment",
        "push/merge to main"
      ]
    }
  };
}

export class SelfImprovementSupervisor {
  private readonly root: string;
  private readonly statePath: string;
  private readonly skillsRoot: string;
  private readonly intervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private scanning: Promise<SelfImprovementSnapshot> | null = null;
  private repairLease: Promise<SelfImprovementReceipt> | null = null;

  constructor(private readonly options: SelfImprovementProbeOptions) {
    this.root = join(resolve(options.stateDir), "self-improvement");
    this.statePath = join(this.root, "state.json");
    this.skillsRoot = join(this.root, "learned-skills");
    this.intervalMs = clampInterval(options.scanIntervalMs);
  }

  start(): void {
    if (this.options.enabled === false || this.timer) return;
    const initial = setTimeout(() => {
      void this.scan(false).catch(() => undefined);
    }, 2_000);
    initial.unref();

    this.timer = setInterval(() => {
      void this.scan(false).catch(() => undefined);
    }, this.intervalMs);
    this.timer.unref();
  }

  close(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async snapshot(): Promise<SelfImprovementSnapshot> {
    try {
      const parsed = JSON.parse(await readFile(this.statePath, "utf8")) as SelfImprovementSnapshot;
      return {
        ...defaultSnapshot(this.options),
        ...parsed,
        scanIntervalMs: this.intervalMs,
        enabled: this.options.enabled !== false
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return defaultSnapshot(this.options);
      throw error;
    }
  }

  async setPaused(paused: boolean): Promise<SelfImprovementSnapshot> {
    const state = await this.snapshot();
    const next = { ...state, paused };
    await this.persist(next);
    return next;
  }

  async scan(force = false): Promise<SelfImprovementSnapshot> {
    if (this.scanning) return this.scanning;
    this.scanning = this.scanOnce(force);
    try {
      return await this.scanning;
    } finally {
      this.scanning = null;
    }
  }

  async repair(incidentId: string, approved = false): Promise<SelfImprovementReceipt> {
    if (this.repairLease) throw new SelfImprovementError("SELF_IMPROVEMENT_REPAIR_BUSY", 409);
    const run = this.repairOnce(incidentId, approved);
    this.repairLease = run;
    try {
      return await run;
    } finally {
      this.repairLease = null;
    }
  }

  private async scanOnce(force: boolean): Promise<SelfImprovementSnapshot> {
    const current = await this.snapshot();
    if (current.paused && !force) return current;

    const [githubResult, grantResult, routesResult] = await Promise.allSettled([
      this.options.githubStatus(),
      this.options.hermesGrant(),
      this.options.omniRoutes(force)
    ]);

    const hermes = this.options.hermesStatus();
    const now = iso();
    const findings: SelfImprovementIncident[] = [];
    const opportunities: SelfImprovementOpportunity[] = [];

    if (githubResult.status === "rejected") {
      findings.push(this.finding(
        "github-status",
        "GITHUB_AUTH",
        "MEDIUM",
        "GitHub status probe failed",
        [githubResult.reason instanceof Error ? githubResult.reason.message : "GitHub probe rejected"],
        true,
        "NONE",
        now
      ));
    } else {
      const github = githubResult.value;
      if (github.state !== "CONNECTED" || github.repositoryAccess === false) {
        findings.push(this.finding(
          "github-auth",
          "GITHUB_AUTH",
          "MEDIUM",
          "GitHub repository access requires attention",
          [
            `state=${github.state ?? "UNKNOWN"}`,
            `repositoryAccess=${String(github.repositoryAccess ?? false)}`,
            `method=${github.connectionMethod ?? "NONE"}`
          ],
          true,
          "NONE",
          now
        ));
      }
    }

    const grant = grantResult.status === "fulfilled" ? grantResult.value : { terminal: false, localFiles: false };
    if (!hermes.running) {
      if (grant.terminal === true && this.options.startHermes) {
        findings.push(this.finding(
          "hermes-stopped",
          "HERMES_STOPPED",
          "LOW",
          "Hermes PTY is stopped despite an existing terminal grant",
          [
            `terminalGrant=${String(grant.terminal)}`,
            `localFiles=${String(grant.localFiles ?? false)}`
          ],
          false,
          "START_HERMES",
          now
        ));
      } else {
        findings.push(this.finding(
          "hermes-tools",
          "TOOL_CAPABILITY_MISMATCH",
          "MEDIUM",
          "Hermes cannot self-heal because terminal execution is not currently available",
          [
            `running=${String(Boolean(hermes.running))}`,
            `terminalGrant=${String(Boolean(grant.terminal))}`
          ],
          true,
          "NONE",
          now
        ));
      }
    }

    if (routesResult.status === "rejected") {
      findings.push(this.finding(
        "omniroute-probe",
        "PROVIDER_DOWN",
        "HIGH",
        "OmniRoute route probe failed",
        [routesResult.reason instanceof Error ? routesResult.reason.message : "Route probe rejected"],
        false,
        "REFRESH_ROUTES",
        now
      ));
    } else {
      const routes = routesResult.value;
      const healthy = routes.filter((route) => route.health === "HEALTHY");
      if (healthy.length === 0) {
        findings.push(this.finding(
          "no-healthy-route",
          "PROVIDER_DOWN",
          "HIGH",
          "No healthy OmniRoute provider route is available",
          routes.slice(0, 12).map((route) => `${route.family ?? route.providerId ?? "unknown"}=${route.health ?? "UNKNOWN"}`),
          false,
          "REFRESH_ROUTES",
          now
        ));
      }

      for (const route of routes) {
        const family = String(route.family ?? "");
        if (!FREE_FAMILIES.has(family) || route.health === "HEALTHY") continue;
        opportunities.push({
          opportunityId: opportunityIdFor(family),
          family,
          label: String(route.label ?? family),
          model: String(route.model ?? "-"),
          action: String(route.connectAction ?? "CHECK"),
          detail: String(route.detail ?? "Free-tier route is not healthy yet"),
          requiresApproval: ["AUTH", "CONNECT", "OPEN"].includes(String(route.connectAction ?? "").toUpperCase()),
          checkedAt: String(route.checkedAt ?? now)
        });
      }
    }

    const merged = this.mergeFindings(current.incidents, findings, now);
    let next: SelfImprovementSnapshot = {
      ...current,
      enabled: this.options.enabled !== false,
      scanIntervalMs: this.intervalMs,
      lastScanAt: now,
      incidents: merged,
      opportunities
    };
    await this.persist(next);

    if (next.autoRepairLowRisk && !next.paused) {
      for (const incident of next.incidents) {
        if (incident.status !== "OPEN" || incident.risk !== "LOW" || incident.approvalRequired || incident.repairAction === "NONE") continue;
        if (incident.attempts >= incident.maxAttempts) continue;
        try {
          await this.repair(incident.incidentId, false);
        } catch {
          // The receipt and incident state are persisted by repairOnce.
        }
      }
      next = await this.snapshot();
    }

    return next;
  }

  private finding(
    key: string,
    kind: SelfImprovementIncidentKind,
    risk: SelfImprovementRisk,
    summary: string,
    evidence: string[],
    approvalRequired: boolean,
    repairAction: SelfImprovementRepairAction,
    now: string
  ): SelfImprovementIncident {
    return {
      incidentId: incidentIdFor(key),
      key,
      kind,
      status: "OPEN",
      risk,
      summary,
      evidence,
      detectedAt: now,
      updatedAt: now,
      attempts: 0,
      maxAttempts: 3,
      approvalRequired,
      repairAction
    };
  }

  private mergeFindings(
    previous: SelfImprovementIncident[],
    findings: SelfImprovementIncident[],
    now: string
  ): SelfImprovementIncident[] {
    const oldByKey = new Map(previous.map((item) => [item.key, item]));
    const activeKeys = new Set(findings.map((item) => item.key));
    const merged: SelfImprovementIncident[] = findings.map((finding): SelfImprovementIncident => {
      const old = oldByKey.get(finding.key);
      if (!old) return finding;
      return {
        ...finding,
        incidentId: old.incidentId,
        detectedAt: old.detectedAt,
        attempts: old.attempts,
        maxAttempts: old.maxAttempts,
        status: old.status === "REPAIRING" ? "REPAIRING" : "OPEN",
        updatedAt: now
      };
    });

    for (const old of previous) {
      if (activeKeys.has(old.key)) continue;
      if (old.status === "RESOLVED") {
        merged.push(old);
        continue;
      }
      merged.push({ ...old, status: "RESOLVED", updatedAt: now });
    }

    return merged
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 100);
  }

  private async repairOnce(incidentId: string, approved: boolean): Promise<SelfImprovementReceipt> {
    let state = await this.snapshot();
    const index = state.incidents.findIndex((item) => item.incidentId === incidentId);
    if (index < 0) throw new SelfImprovementError("SELF_IMPROVEMENT_INCIDENT_NOT_FOUND", 404);

    const incident = state.incidents[index]!;
    if (incident.status === "RESOLVED") throw new SelfImprovementError("SELF_IMPROVEMENT_INCIDENT_RESOLVED", 409);
    if (incident.attempts >= incident.maxAttempts) throw new SelfImprovementError("SELF_IMPROVEMENT_ATTEMPTS_EXHAUSTED", 409);
    if (incident.approvalRequired && approved !== true) throw new SelfImprovementError("SELF_IMPROVEMENT_APPROVAL_REQUIRED", 400);
    if (incident.repairAction === "NONE") throw new SelfImprovementError("SELF_IMPROVEMENT_REPAIR_NOT_AVAILABLE", 409);

    const startedAt = iso();
    state.incidents[index] = {
      ...incident,
      status: "REPAIRING",
      attempts: incident.attempts + 1,
      updatedAt: startedAt
    };
    await this.persist(state);

    const evidence: string[] = [];
    let status: SelfImprovementReceipt["status"] = "FAIL";

    try {
      if (incident.repairAction === "START_HERMES") {
        if (!this.options.startHermes) throw new SelfImprovementError("SELF_IMPROVEMENT_HERMES_START_UNAVAILABLE", 503);
        const result = await this.options.startHermes();
        const post = this.options.hermesStatus();
        evidence.push(`startSession=${result.sessionId ?? "UNKNOWN"}`);
        evidence.push(`postRunning=${String(Boolean(post.running))}`);
        evidence.push(`postPid=${String(post.pid ?? result.pid ?? "UNKNOWN")}`);
        status = post.running ? "PASS" : "FAIL";
      } else if (incident.repairAction === "REFRESH_ROUTES") {
        const routes = await this.options.omniRoutes(true);
        const healthy = routes.filter((route) => route.health === "HEALTHY");
        evidence.push(`routes=${routes.length}`);
        evidence.push(`healthy=${healthy.length}`);
        status = healthy.length > 0 ? "PASS" : "FAIL";
      }
    } catch (error) {
      evidence.push(error instanceof Error ? error.message : "repair failed");
      status = error instanceof SelfImprovementError && error.status < 500 ? "BLOCKED" : "FAIL";
    }

    const receipt: SelfImprovementReceipt = {
      receiptId: `REPAIR-${randomUUID()}`,
      incidentId,
      action: incident.repairAction,
      startedAt,
      finishedAt: iso(),
      status,
      evidence
    };

    state = await this.snapshot();
    const latestIndex = state.incidents.findIndex((item) => item.incidentId === incidentId);
    if (latestIndex >= 0) {
      const latest = state.incidents[latestIndex]!;
      state.incidents[latestIndex] = {
        ...latest,
        status: status === "PASS"
          ? "VERIFIED"
          : latest.attempts >= latest.maxAttempts
            ? "ESCALATED"
            : "OPEN",
        evidence: [...latest.evidence, ...evidence].slice(-20),
        updatedAt: receipt.finishedAt
      };
    }
    state.receipts = [receipt, ...state.receipts].slice(0, MAX_RECEIPTS);
    await this.persist(state);
    await this.promoteSkillIfRepeated(receipt.action, state.receipts);
    return receipt;
  }

  private async promoteSkillIfRepeated(
    action: SelfImprovementRepairAction,
    receipts: SelfImprovementReceipt[]
  ): Promise<void> {
    if (action === "NONE") return;
    const successes = receipts.filter((receipt) => receipt.action === action && receipt.status === "PASS");
    if (successes.length < 3) return;

    await mkdir(this.skillsRoot, { recursive: true, mode: 0o700 });
    const path = join(this.skillsRoot, `${action.toLowerCase().replace(/_/g, "-")}.md`);
    const body = [
      "---",
      `name: self-improvement-${action.toLowerCase().replace(/_/g, "-")}`,
      "version: 1.0.0",
      "source: verified-repair-history",
      `successful_receipts: ${successes.length}`,
      "---",
      "",
      `# Learned repair: ${action}`,
      "",
      "This playbook was promoted only after at least three persisted PASS receipts.",
      "It contains no credentials or secret material.",
      "",
      "## Trigger",
      `Incident repair action: ${action}`,
      "",
      "## Verification",
      "A repair remains successful only when its post-condition probe returns PASS.",
      ""
    ].join("\n");
    await writeFile(path, body, { encoding: "utf8", mode: 0o600 });
  }

  private async persist(state: SelfImprovementSnapshot): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const tmp = `${this.statePath}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(tmp, this.statePath);
  }
}
