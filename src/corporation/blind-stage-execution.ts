import { randomUUID } from "node:crypto";
import { canonicalDigest } from "../crypto/canonical-digest.js";
import type { CapabilityLeaseReceipt } from "./receipts.js";
import { verifyCapabilityLeaseReceipt } from "./receipts.js";

/**
 * Blind execution transport.
 *
 * This module deliberately does NOT:
 * - synthesize HLL truth;
 * - compare against an expected HLL fragment;
 * - ratify a stage;
 * - issue the next stage lease.
 *
 * It only constrains what the executor sees and produces tamper-evident execution
 * evidence for the authoritative HLL/VERA boundary to interpret.
 */

export type BlindStageElement = {
  elementId: string;
  order: number;
  operationId: string;
  instruction: string;
  input: unknown;
  instructionFingerprint: string;
  inputFingerprint: string;
};

export type BlindStageAssignment = {
  assignmentId: string;
  protocolVersion: "BLIND-STAGE/1";
  taskId: string;
  stageId: string;
  executorId: string;
  capabilityLeaseId: string;
  stageContractRef: string;
  stageContractFingerprint: string;
  elements: BlindStageElement[];
  issuedAt: string;
};

export type BlindTraceEvent = {
  eventId: string;
  sequence: number;
  taskId: string;
  stageId: string;
  elementId: string;
  operationId: string;
  executorId: string;
  capabilityLeaseId: string;
  instructionFingerprint: string;
  inputFingerprint: string;
  outputFingerprint: string;
  effectFingerprints: string[];
  evidenceFingerprints: string[];
  previousEventFingerprint: string | null;
  observedAt: string;
  eventFingerprint: string;
};

export type ExecutionEvidenceBundle = {
  bundleId: string;
  protocolVersion: "BLIND-STAGE/1";
  taskId: string;
  stageId: string;
  executorId: string;
  capabilityLeaseId: string;
  stageContractRef: string;
  stageContractFingerprint: string;
  assignmentFingerprint: string;
  traceRoot: string;
  outputFingerprints: string[];
  effectFingerprints: string[];
  evidenceFingerprints: string[];
  createdAt: string;
  bundleFingerprint: string;
};

export type BlindStageElementInput = {
  elementId: string;
  order: number;
  operationId: string;
  instruction: string;
  input: unknown;
};

function uniqSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function traceEventBase(
  input: Omit<BlindTraceEvent, "eventId" | "eventFingerprint"> & { eventId?: string }
) {
  return {
    eventId: input.eventId ?? `TRACE-${randomUUID().slice(0, 10).toUpperCase()}`,
    sequence: input.sequence,
    taskId: input.taskId,
    stageId: input.stageId,
    elementId: input.elementId,
    operationId: input.operationId,
    executorId: input.executorId,
    capabilityLeaseId: input.capabilityLeaseId,
    instructionFingerprint: input.instructionFingerprint,
    inputFingerprint: input.inputFingerprint,
    outputFingerprint: input.outputFingerprint,
    effectFingerprints: uniqSorted(input.effectFingerprints),
    evidenceFingerprints: uniqSorted(input.evidenceFingerprints),
    previousEventFingerprint: input.previousEventFingerprint,
    observedAt: input.observedAt
  };
}

export function createBlindStageAssignment(input: {
  taskId: string;
  stageId: string;
  executorId: string;
  capabilityLease: CapabilityLeaseReceipt;
  stageContractRef: string;
  stageContractFingerprint: string;
  elements: BlindStageElementInput[];
}): BlindStageAssignment {
  verifyCapabilityLeaseReceipt(input.capabilityLease);

  if (input.capabilityLease.taskId !== input.taskId) {
    throw new Error("BLIND_STAGE_LEASE_TASK_MISMATCH");
  }
  if (input.capabilityLease.stageId !== input.stageId) {
    throw new Error("BLIND_STAGE_LEASE_STAGE_MISMATCH");
  }
  if (input.capabilityLease.executorId !== input.executorId) {
    throw new Error("BLIND_STAGE_LEASE_EXECUTOR_MISMATCH");
  }
  if (!input.stageContractRef.trim() || !input.stageContractFingerprint.trim()) {
    throw new Error("BLIND_STAGE_CONTRACT_BINDING_REQUIRED");
  }
  if (!input.elements.length) throw new Error("BLIND_STAGE_ELEMENTS_REQUIRED");

  const ordered = [...input.elements].sort((a, b) => a.order - b.order);
  ordered.forEach((element, index) => {
    if (element.order !== index + 1) throw new Error("BLIND_STAGE_ELEMENT_ORDER_INVALID");
  });
  if (new Set(ordered.map((element) => element.elementId)).size !== ordered.length) {
    throw new Error("BLIND_STAGE_ELEMENT_ID_DUPLICATE");
  }

  return {
    assignmentId: `BLIND-${randomUUID().slice(0, 10).toUpperCase()}`,
    protocolVersion: "BLIND-STAGE/1",
    taskId: input.taskId,
    stageId: input.stageId,
    executorId: input.executorId,
    capabilityLeaseId: input.capabilityLease.leaseId,
    stageContractRef: input.stageContractRef,
    stageContractFingerprint: input.stageContractFingerprint,
    elements: ordered.map((element) => ({
      elementId: element.elementId,
      order: element.order,
      operationId: element.operationId,
      instruction: element.instruction,
      input: structuredClone(element.input),
      instructionFingerprint: canonicalDigest({
        operationId: element.operationId,
        instruction: element.instruction
      }),
      inputFingerprint: canonicalDigest(element.input)
    })),
    issuedAt: new Date().toISOString()
  };
}

/**
 * MUST be called by the trusted trace writer/supervisor, not by the worker model.
 * Hash chaining is tamper-evident evidence, not semantic truth and not hardware
 * attestation.
 */
export function createBlindTraceEvent(
  input: Omit<BlindTraceEvent, "eventId" | "eventFingerprint"> & { eventId?: string }
): BlindTraceEvent {
  const base = traceEventBase(input);
  return {
    ...base,
    eventFingerprint: canonicalDigest(base)
  };
}

export function verifyBlindTrace(
  assignment: BlindStageAssignment,
  trace: BlindTraceEvent[]
): void {
  if (trace.length !== assignment.elements.length) {
    throw new Error("BLIND_TRACE_CARDINALITY_MISMATCH");
  }

  let previous: string | null = null;

  for (let index = 0; index < trace.length; index += 1) {
    const event = trace[index]!;
    const element = assignment.elements[index]!;
    const base = traceEventBase(event);

    if (event.eventFingerprint !== canonicalDigest(base)) {
      throw new Error("BLIND_TRACE_EVENT_TAMPERED");
    }
    if (event.sequence !== index + 1) throw new Error("BLIND_TRACE_SEQUENCE_INVALID");
    if (event.previousEventFingerprint !== previous) throw new Error("BLIND_TRACE_CHAIN_INVALID");
    if (event.taskId !== assignment.taskId || event.stageId !== assignment.stageId) {
      throw new Error("BLIND_TRACE_STAGE_BINDING_MISMATCH");
    }
    if (event.executorId !== assignment.executorId) throw new Error("BLIND_TRACE_EXECUTOR_MISMATCH");
    if (event.capabilityLeaseId !== assignment.capabilityLeaseId) {
      throw new Error("BLIND_TRACE_LEASE_MISMATCH");
    }
    if (event.elementId !== element.elementId || event.operationId !== element.operationId) {
      throw new Error("BLIND_TRACE_ELEMENT_MISMATCH");
    }
    if (event.instructionFingerprint !== element.instructionFingerprint) {
      throw new Error("BLIND_TRACE_INSTRUCTION_MISMATCH");
    }
    if (event.inputFingerprint !== element.inputFingerprint) {
      throw new Error("BLIND_TRACE_INPUT_MISMATCH");
    }

    previous = event.eventFingerprint;
  }
}

export function buildExecutionEvidenceBundle(
  assignment: BlindStageAssignment,
  trace: BlindTraceEvent[]
): ExecutionEvidenceBundle {
  verifyBlindTrace(assignment, trace);

  const base = {
    bundleId: `EBUNDLE-${randomUUID().slice(0, 10).toUpperCase()}`,
    protocolVersion: "BLIND-STAGE/1" as const,
    taskId: assignment.taskId,
    stageId: assignment.stageId,
    executorId: assignment.executorId,
    capabilityLeaseId: assignment.capabilityLeaseId,
    stageContractRef: assignment.stageContractRef,
    stageContractFingerprint: assignment.stageContractFingerprint,
    assignmentFingerprint: canonicalDigest(assignment),
    traceRoot: trace.at(-1)?.eventFingerprint ?? "",
    outputFingerprints: uniqSorted(trace.map((event) => event.outputFingerprint)),
    effectFingerprints: uniqSorted(trace.flatMap((event) => event.effectFingerprints)),
    evidenceFingerprints: uniqSorted(trace.flatMap((event) => event.evidenceFingerprints)),
    createdAt: new Date().toISOString()
  };

  return {
    ...base,
    bundleFingerprint: canonicalDigest(base)
  };
}
