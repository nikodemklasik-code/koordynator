import { randomUUID } from "node:crypto";
import { DeliveryProcessError, DeliveryProcessStore, type DeliveryProcess } from "./delivery-process-store.js";
import { MaterialisationService } from "./materialisation-service.js";
import { StageZeroService } from "./stage-zero-service.js";
import { canonicalDigest } from "../crypto/canonical-digest.js";
import { runCommand } from "./hermes-repository-runner.js";
import type { TaskId } from "../domain/ids.js";

export type ApproveResult = {
  processId: string;
  taskId: TaskId;
  state: "APPROVED";
  objective: string;
  modules: string[];
  allowedPaths: string[];
  acceptanceCriteria: string[];
};

export class DeliveryApprovalService {
  constructor(
    private readonly options: {
      stateDir: string;
      stageZero: StageZeroService;
      materialisation: MaterialisationService | null;
      projectRoot?: string;
    }
  ) {}

  async approve(sessionId: string): Promise<ApproveResult> {
    const store = new DeliveryProcessStore(this.options.stateDir);
    const existing = await store.getBySessionId(sessionId);
    if (existing) {
      return {
        processId: existing.processId,
        taskId: existing.taskId,
        state: "APPROVED",
        objective: existing.objective,
        modules: existing.modules,
        allowedPaths: existing.allowedPaths,
        acceptanceCriteria: existing.acceptanceCriteria
      };
    }

    const run = await this.options.stageZero.get(sessionId);
    if (!run) throw new DeliveryProcessError("STAGE_ZERO_NOT_FOUND", 404);
    if (run.reading.decision.status !== "allow") {
      throw new DeliveryProcessError("HARMONIA_NOT_ALLOW", 409);
    }
    const milestone = run.roadmap?.milestones[0];
    if (!milestone) throw new DeliveryProcessError("ROADMAP_MISSING", 409);
    if (!this.options.materialisation) {
      throw new DeliveryProcessError("MATERIALISATION_SIGNING_KEY_UNAVAILABLE", 503);
    }

    const created = await this.options.materialisation.materialise({
      objective: milestone.intent || milestone.title,
      modules: milestone.modules,
      allowedPaths: milestone.allowedPaths,
      acceptanceCriteria: milestone.acceptanceCriteria
    });

    const processId = `PROC-${randomUUID().slice(0, 8).toUpperCase()}`;
    const now = new Date().toISOString();
    let baseSha: string | undefined;
    if (this.options.projectRoot) {
      try {
        baseSha = (await runCommand(
          "git",
          ["rev-parse", "HEAD"],
          this.options.projectRoot,
          { ...globalThis.process.env, GIT_TERMINAL_PROMPT: "0" },
          new AbortController().signal
        )).trim();
      } catch {
        /* not a git checkout */
      }
    }
    const record: DeliveryProcess = {
      processId,
      sessionId,
      taskId: created.taskId,
      state: "APPROVED",
      objective: milestone.intent || milestone.title,
      modules: milestone.modules,
      allowedPaths: milestone.allowedPaths,
      acceptanceCriteria: milestone.acceptanceCriteria,
      approvedScopeFingerprint: canonicalDigest({
        modules: milestone.modules,
        allowedPaths: milestone.allowedPaths,
        acceptanceCriteria: milestone.acceptanceCriteria
      }),
      workOrderFingerprint: created.orderFp,
      ...(baseSha === undefined ? {} : { baseSha }),
      createdAt: now,
      updatedAt: now
    };
    await store.put(record);
    return {
      processId,
      taskId: created.taskId,
      state: "APPROVED",
      objective: record.objective,
      modules: record.modules,
      allowedPaths: record.allowedPaths,
      acceptanceCriteria: record.acceptanceCriteria
    };
  }
}
