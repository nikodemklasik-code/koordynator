import { canonicalDigest } from "../crypto/canonical-digest.js";
import type { Digest } from "../domain/ids.js";
import type {
  OmniRouteModelRuntimeTelemetry,
  OmniRouteRuntimeSnapshot,
  OmniRouteRuntimeTelemetry
} from "./omniroute-runtime-telemetry.js";

export type OmniRouteModelPurpose = "EXACT_PACK" | "CODE" | "REVIEW" | "REASONING" | "RESEARCH";

export type OmniRouteModelSelectionRequest = {
  purpose: OmniRouteModelPurpose;
  maxLatencyMs?: number;
  fallbackModel?: string;
};

export type OmniRouteModelSelection = {
  modelId: string;
  score: number;
  reasons: string[];
  snapshotAt: string;
  selectionFp: Digest;
};

export interface OmniRouteModelSelector {
  select(request: Readonly<OmniRouteModelSelectionRequest>): Promise<OmniRouteModelSelection>;
}

export function isForbiddenModel(modelId: string): boolean {
  return modelId.toLowerCase().includes("deepseek");
}

function fidelityScore(modelId: string, purpose: OmniRouteModelPurpose): number {
  const id = modelId.toLowerCase();
  let score = 50;

  if (id.includes("gpt-5.6-sol")) score = 100;
  else if (id.includes("claude-sonnet-5")) score = 97;
  else if (id.includes("claude-opus-5")) score = 95;
  else if (id.includes("gpt-5.6")) score = 92;
  else if (id.includes("claude-sonnet")) score = 89;
  else if (id.includes("claude-opus")) score = 87;
  else if (id.includes("gpt-5")) score = 84;
  else if (id.includes("claude")) score = 82;
  else if (id.includes("gemini")) score = 76;
  else if (id.includes("qwen")) score = 72;
  else if (id.includes("llama")) score = 66;

  if (["EXACT_PACK", "CODE"].includes(purpose) && (id.includes("code") || id.includes("coder"))) score += 5;
  if (purpose === "REVIEW" && (id.includes("opus") || id.includes("sonnet"))) score += 4;
  if (purpose === "REASONING" && (id.includes("reason") || id.includes("thinking"))) score += 4;
  if (id.includes("mini") || id.includes("nano") || id.includes("1.5b")) score -= 8;
  return score;
}

function latencyAdjustment(latencyMs: number | undefined): number {
  if (latencyMs === undefined) return 0;
  if (latencyMs <= 1000) return 10;
  if (latencyMs <= 3000) return 7;
  if (latencyMs <= 8000) return 3;
  if (latencyMs <= 15000) return 0;
  if (latencyMs <= 30000) return -4;
  return -10;
}

function costAdjustment(cost: number | undefined): number {
  if (cost === undefined) return 0;
  if (cost <= 0) return 8;
  if (cost <= 0.1) return 5;
  if (cost <= 1) return 2;
  if (cost <= 5) return 0;
  return -5;
}

function isFreeLike(model: OmniRouteModelRuntimeTelemetry): boolean {
  const id = model.modelId.toLowerCase();
  return model.estimatedCost === 0 || id.includes("free") || id.includes("best-free");
}

function allowedByRuntime(model: OmniRouteModelRuntimeTelemetry, snapshot: OmniRouteRuntimeSnapshot, maxLatencyMs: number | undefined): boolean {
  if (isForbiddenModel(model.modelId)) return false;
  if (model.rateLimited === true) return false;
  if (model.tokenHealthy === false) return false;
  if (maxLatencyMs !== undefined && model.latencyMs !== undefined && model.latencyMs > maxLatencyMs) return false;
  if (snapshot.budget.exhausted && !isFreeLike(model)) return false;
  return true;
}

function scoreModel(model: OmniRouteModelRuntimeTelemetry, purpose: OmniRouteModelPurpose): { score: number; reasons: string[] } {
  const fidelity = fidelityScore(model.modelId, purpose);
  const latency = latencyAdjustment(model.latencyMs);
  const cost = costAdjustment(model.estimatedCost);
  return {
    score: fidelity + latency + cost,
    reasons: [
      `fidelity=${fidelity}`,
      ...(model.latencyMs === undefined ? ["latency=unknown"] : [`latencyMs=${model.latencyMs}`, `latencyScore=${latency}`]),
      ...(model.estimatedCost === undefined ? ["cost=unknown"] : [`estimatedCost=${model.estimatedCost}`, `costScore=${cost}`])
    ]
  };
}

export class DeterministicOmniRouteModelSelector implements OmniRouteModelSelector {
  constructor(private readonly telemetry: Pick<OmniRouteRuntimeTelemetry, "snapshot">) {}

  async select(request: Readonly<OmniRouteModelSelectionRequest>): Promise<OmniRouteModelSelection> {
    const snapshot = await this.telemetry.snapshot();
    const candidates = snapshot.models
      .filter((model) => allowedByRuntime(model, snapshot, request.maxLatencyMs))
      .map((model) => ({ model, ...scoreModel(model, request.purpose) }))
      .sort((a, b) => b.score - a.score || a.model.modelId.localeCompare(b.model.modelId));

    let chosen = candidates[0];
    if (chosen === undefined && request.fallbackModel !== undefined && !isForbiddenModel(request.fallbackModel)) {
      const fallback = snapshot.models.find((model) => model.modelId === request.fallbackModel);
      if (fallback !== undefined && allowedByRuntime(fallback, snapshot, request.maxLatencyMs)) {
        chosen = { model: fallback, ...scoreModel(fallback, request.purpose) };
      }
    }

    if (chosen === undefined) {
      if (snapshot.budget.exhausted) throw new Error("OMNIROUTE_RUNTIME_BUDGET_EXHAUSTED");
      throw new Error("OMNIROUTE_NO_ELIGIBLE_MODEL");
    }

    const selectionBase = {
      modelId: chosen.model.modelId,
      score: chosen.score,
      reasons: chosen.reasons,
      snapshotAt: snapshot.takenAt,
      purpose: request.purpose
    };
    return {
      modelId: chosen.model.modelId,
      score: chosen.score,
      reasons: chosen.reasons,
      snapshotAt: snapshot.takenAt,
      selectionFp: canonicalDigest({ kind: "omniroute-model-selection-v1", ...selectionBase })
    };
  }
}
