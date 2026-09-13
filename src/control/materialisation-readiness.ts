import { access, constants } from "node:fs/promises";
import { delimiter, join } from "node:path";
import type { TaskRole } from "../domain/task-envelope.js";
import { workerForRole } from "../domain/worker-registry.js";
import { workerAgentImplemented } from "./worker-agents.js";
import type { HermesGrantStatus } from "./hermes-grant-store.js";
import type { OmniRouteLiveStatus } from "./omniroute-live-status.js";

export type ReadinessLight = "GREEN" | "AMBER" | "RED";
export type CreativePhase = "POZNAWANIE" | "MYSLENIE" | "RESEARCH" | "PROJEKTOWANIE" | "TWORZENIE" | "WERYFIKACJA" | "GOTOWE";

export type MaterialisationReadinessStage = {
  id: string;
  order: number;
  label: string;
  phase: CreativePhase;
  light: ReadinessLight;
  aiRequired: boolean;
  agent: string;
  worker: string;
  model: string | null;
  detail: string;
  blocking: boolean;
  action: string | null;
};

export type MaterialisationReadiness = {
  overall: ReadinessLight;
  canMaterialise: boolean;
  fullPipelineReady: boolean;
  score: number;
  creativePhase: CreativePhase;
  creativeProgress: number;
  primaryModel: string | null;
  fallbackModels: string[];
  healthyAiRoutes: number;
  connectedAiRoutes: number;
  terminalGrant: boolean;
  stages: MaterialisationReadinessStage[];
  checkedAt: string;
};

export type MaterialisationReadinessInput = {
  projectRoot: string;
  materialisationEnabled: boolean;
  primaryModel?: string;
  fallbackModels?: string[];
  routes: OmniRouteLiveStatus[];
  hermesGrant: HermesGrantStatus;
  path?: string;
};

async function executableAvailable(name: string, projectRoot: string, pathValue = process.env.PATH ?? ""): Promise<boolean> {
  const candidates = [join(projectRoot, "node_modules", ".bin", name)];
  for (const part of pathValue.split(delimiter).filter(Boolean)) candidates.push(join(part, name));
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return true;
    } catch {
      // Continue through PATH. Missing binaries are a readiness fact, not an exception.
    }
  }
  return false;
}

function bestRoute(routes: OmniRouteLiveStatus[], preferred?: string): OmniRouteLiveStatus | null {
  const exact = preferred ? routes.find((route) => route.model === preferred) : undefined;
  if (exact?.health === "HEALTHY") return exact;
  const healthy = routes.find((route) => route.health === "HEALTHY");
  if (healthy) return healthy;
  if (exact) return exact;
  return routes.find((route) => route.health === "RATE_LIMITED" || route.health === "DEGRADED" || route.health === "AUTH_REQUIRED") ?? null;
}

function routeLight(route: OmniRouteLiveStatus | null): ReadinessLight {
  if (!route) return "RED";
  if (route.health === "HEALTHY") return "GREEN";
  if (route.health === "RATE_LIMITED" || route.health === "DEGRADED") return "AMBER";
  return "RED";
}

function workerStage(input: {
  id: string;
  order: number;
  label: string;
  phase: CreativePhase;
  role: TaskRole;
  binary: string | null;
  binaryReady: boolean;
  aiRequired: boolean;
  route: OmniRouteLiveStatus | null;
  blocking: boolean;
  action: string | null;
}): MaterialisationReadinessStage {
  const implemented = workerAgentImplemented(input.role);
  const worker = workerForRole(input.role);
  const ai = input.aiRequired ? routeLight(input.route) : "GREEN";
  let light: ReadinessLight;
  if (!implemented || (input.binary && !input.binaryReady)) light = "RED";
  else if (ai === "RED") light = "RED";
  else if (ai === "AMBER") light = "AMBER";
  else light = "GREEN";

  const parts = [
    implemented ? "process bridge present" : "process bridge missing",
    input.binary ? `${input.binary}: ${input.binaryReady ? "available" : "missing"}` : "no external binary required"
  ];
  if (input.aiRequired) parts.push(input.route ? `AI ${input.route.health}: ${input.route.model}` : "AI route missing");
  return {
    id: input.id,
    order: input.order,
    label: input.label,
    phase: input.phase,
    light,
    aiRequired: input.aiRequired,
    agent: input.role,
    worker,
    model: input.aiRequired ? input.route?.model ?? null : null,
    detail: parts.join(" · "),
    blocking: input.blocking,
    action: light === "GREEN" ? null : input.action
  };
}

function phaseFor(stages: MaterialisationReadinessStage[], fullPipelineReady: boolean): CreativePhase {
  if (fullPipelineReady) return "GOTOWE";
  const blocked = stages.find((stage) => stage.light !== "GREEN" && stage.blocking);
  return blocked?.phase ?? stages.find((stage) => stage.light !== "GREEN")?.phase ?? "GOTOWE";
}

const PHASE_PROGRESS: Record<CreativePhase, number> = {
  POZNAWANIE: 10,
  MYSLENIE: 24,
  RESEARCH: 38,
  PROJEKTOWANIE: 52,
  TWORZENIE: 68,
  WERYFIKACJA: 84,
  GOTOWE: 100
};

export async function buildMaterialisationReadiness(input: MaterialisationReadinessInput): Promise<MaterialisationReadiness> {
  const [hermesBinary, opencodeBinary, playwrightBinary, npxBinary] = await Promise.all([
    executableAvailable("hermes", input.projectRoot, input.path),
    executableAvailable("opencode", input.projectRoot, input.path),
    executableAvailable("playwright", input.projectRoot, input.path),
    executableAvailable("npx", input.projectRoot, input.path)
  ]);

  const route = bestRoute(input.routes, input.primaryModel);
  const routeStatus = routeLight(route);
  const configuredFallbacks = (input.fallbackModels ?? []).filter(Boolean);
  const model = route?.model ?? input.primaryModel ?? null;

  const stages: MaterialisationReadinessStage[] = [
    {
      id: "harmonia",
      order: 1,
      label: "Harmonia · poznawanie",
      phase: "POZNAWANIE",
      light: routeStatus,
      aiRequired: true,
      agent: "harmonia",
      worker: "in-process cognition",
      model,
      detail: route ? `Harmonia can read through ${route.model} · ${route.health}` : "No executable AI route for Harmonia",
      blocking: true,
      action: routeStatus === "GREEN" ? null : "Connect or restore at least one healthy AI route"
    },
    {
      id: "brain",
      order: 2,
      label: "Mózg · plan i mapa",
      phase: "MYSLENIE",
      light: routeStatus,
      aiRequired: true,
      agent: "brain",
      worker: "in-process roadmap writer",
      model,
      detail: route ? `Roadmap planning route ${route.model} · ${route.health}` : "No executable AI route for roadmap planning",
      blocking: true,
      action: routeStatus === "GREEN" ? null : "Restore AI routing before planning"
    },
    workerStage({
      id: "research",
      order: 3,
      label: "Researcher · Hermes",
      phase: "RESEARCH",
      role: "research",
      binary: "hermes",
      binaryReady: hermesBinary,
      aiRequired: true,
      route,
      blocking: true,
      action: hermesBinary ? "Restore a healthy AI route" : "Install/restore Hermes executable"
    }),
    {
      id: "design",
      order: 4,
      label: "Projektowanie · innovation",
      phase: "PROJEKTOWANIE",
      light: routeStatus,
      aiRequired: true,
      agent: "planner",
      worker: "Koordynator route policy",
      model,
      detail: route ? `Design reasoning can use ${route.model} · ${route.health}` : "No AI route available for design reasoning",
      blocking: true,
      action: routeStatus === "GREEN" ? null : "Restore a healthy reasoning route"
    },
    workerStage({
      id: "build",
      order: 5,
      label: "Builder · OpenCode",
      phase: "TWORZENIE",
      role: "code",
      binary: "opencode",
      binaryReady: opencodeBinary,
      aiRequired: true,
      route,
      blocking: true,
      action: opencodeBinary ? "Restore a healthy build route" : "Install/restore OpenCode executable"
    }),
    workerStage({
      id: "browser",
      order: 6,
      label: "Frontend verify · Playwright",
      phase: "WERYFIKACJA",
      role: "browser",
      binary: "playwright",
      binaryReady: playwrightBinary || npxBinary,
      aiRequired: false,
      route: null,
      blocking: true,
      action: playwrightBinary || npxBinary ? null : "Install Playwright / npm tooling"
    }),
    workerStage({
      id: "audit",
      order: 7,
      label: "Security / independent audit",
      phase: "WERYFIKACJA",
      role: "audit",
      binary: null,
      binaryReady: true,
      aiRequired: false,
      route: null,
      blocking: false,
      action: "Implement the audit worker process bridge"
    }),
    workerStage({
      id: "deploy",
      order: 8,
      label: "Release / deploy",
      phase: "GOTOWE",
      role: "deploy",
      binary: null,
      binaryReady: true,
      aiRequired: false,
      route: null,
      blocking: false,
      action: "Implement the deploy worker process bridge and keep owner approval gate"
    })
  ];

  if (!input.materialisationEnabled) {
    stages.unshift({
      id: "signing",
      order: 0,
      label: "Materialisation signing",
      phase: "POZNAWANIE",
      light: "RED",
      aiRequired: false,
      agent: "control-plane",
      worker: "MaterialisationService",
      model: null,
      detail: "Materialisation signing key is unavailable",
      blocking: true,
      action: "Provide the materialisation signing key"
    });
  }

  const blocking = stages.filter((stage) => stage.blocking);
  const canMaterialise = blocking.every((stage) => stage.light === "GREEN");
  const fullPipelineReady = stages.every((stage) => stage.light === "GREEN");
  const scoreUnits = stages.reduce((sum, stage) => sum + (stage.light === "GREEN" ? 1 : stage.light === "AMBER" ? 0.5 : 0), 0);
  const score = Math.round((scoreUnits / stages.length) * 100);
  const creativePhase = phaseFor(stages, fullPipelineReady);
  const healthyAiRoutes = input.routes.filter((item) => item.health === "HEALTHY").length;
  const connectedAiRoutes = input.routes.filter((item) => item.model !== "-" && item.health !== "UNAVAILABLE").length;
  const overall: ReadinessLight = fullPipelineReady ? "GREEN" : canMaterialise ? "AMBER" : "RED";

  return {
    overall,
    canMaterialise,
    fullPipelineReady,
    score,
    creativePhase,
    creativeProgress: PHASE_PROGRESS[creativePhase],
    primaryModel: model,
    fallbackModels: configuredFallbacks,
    healthyAiRoutes,
    connectedAiRoutes,
    terminalGrant: input.hermesGrant.terminal,
    stages: stages.sort((a, b) => a.order - b.order),
    checkedAt: new Date().toISOString()
  };
}
