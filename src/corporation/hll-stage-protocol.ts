import { randomBytes, randomUUID } from "node:crypto";
import { canonicalDigest } from "../crypto/canonical-digest.js";
import {
  createCapabilityLeaseReceipt,
  type CapabilityLeaseReceipt
} from "./receipts.js";

/**
 * Blind Execution & Dynamic HLL Synthesis
 *
 * The executor receives BlindStageAssignment only.
 * It MUST NOT receive PrivateStageCommitment.expectedFragment, commitmentNonce,
 * the global HLL graph or the semantic target for the stage.
 *
 * This TypeScript module is a protocol/reference implementation. It is not allowed
 * to become an alternative truth authority beside Harmonia HLL.
 */

export type HllStageElementFragment = {
  elementId: string;
  order: number;
  instructionFingerprint: string;
  inputFingerprint: string;
  outputFingerprint: string;
  effectFingerprints: string[];
  evidenceFingerprints: string[];
};

export type HllLocalStageFragment = {
  protocolVersion: "HLL-BLIND-STAGE/1";
  taskId: string;
  stageId: string;
  elements: HllStageElementFragment[];
  traceRoot: string;
  artifactFingerprints: string[];
};

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
  protocolVersion: "HLL-BLIND-STAGE/1";
  taskId: string;
  stageId: string;
  executorId: string;
  capabilityLeaseId: string;
  commitmentId: string;
  commitmentFingerprint: string;
  elements: BlindStageElement[];
  issuedAt: string;
};

export type PrivateStageCommitment = {
  commitmentId: string;
  protocolVersion: "HLL-BLIND-STAGE/1";
  taskId: string;
  stageId: string;
  executorId: string;
  capabilityLeaseId: string;
  expectedFragment: HllLocalStageFragment;
  commitmentNonce: string;
  commitmentFingerprint: string;
  createdAt: string;
};

export type TraceEvent = {
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

export type HllStageValidationReceipt = {
  validationReceiptId: string;
  protocolVersion: "HLL-BLIND-STAGE/1";
  taskId: string;
  stageId: string;
  commitmentId: string;
  commitmentFingerprint: string;
  expectedFragmentFingerprint: string;
  computedFragmentFingerprint: string;
  traceRoot: string;
  status: "PASS" | "FAIL";
  reasons: string[];
  validatedAt: string;
  receiptFingerprint: string;
};

export type DeterministicElementExpectation = {
  elementId: string;
  order: number;
  operationId: string;
  instruction: string;
  input: unknown;
  expectedOutput: unknown;
  expectedEffects?: unknown[];
  expectedEvidence?: unknown[];
};

function uniqSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function digestMany(values: unknown[]): string[] {
  return uniqSorted(values.map((value) => canonicalDigest(value)));
}

function stageCommitmentDigest(input: {
  commitmentId: string;
  taskId: string;
  stageId: string;
  executorId: string;
  capabilityLeaseId: string;
  expectedFragment: HllLocalStageFragment;
  commitmentNonce: string;
}): string {
  return canonicalDigest(input);
}

export function createBlindStageProtocol(input: {
  taskId: string;
  stageId: string;
  executorId: string;
  capabilityLease: CapabilityLeaseReceipt;
  elements: DeterministicElementExpectation[];
}): {
  blindAssignment: BlindStageAssignment;
  privateCommitment: PrivateStageCommitment;
} {
  if (input.capabilityLease.taskId !== input.taskId) throw new Error("HLL_STAGE_LEASE_TASK_MISMATCH");
  if (input.capabilityLease.stageId !== input.stageId) throw new Error("HLL_STAGE_LEASE_STAGE_MISMATCH");
  if (input.capabilityLease.executorId !== input.executorId) throw new Error("HLL_STAGE_LEASE_EXECUTOR_MISMATCH");
  if (!input.elements.length) throw new Error("HLL_STAGE_ELEMENTS_REQUIRED");

  const ordered = [...input.elements].sort((a, b) => a.order - b.order);
  ordered.forEach((element, index) => {
    if (element.order !== index + 1) throw new Error("HLL_STAGE_ELEMENT_ORDER_INVALID");
  });
  if (new Set(ordered.map((element) => element.elementId)).size !== ordered.length) {
    throw new Error("HLL_STAGE_ELEMENT_ID_DUPLICATE");
  }

  const blindElements: BlindStageElement[] = ordered.map((element) => ({
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
  }));

  // The expected semantic fragment is authority-side only.
  // Runtime-only traceRoot cannot be known before execution, so the expected
  // fragment commits to the deterministic element semantics and uses a
  // protocol-defined zero root. Validation normalises both fragments before match.
  const expectedFragment: HllLocalStageFragment = {
    protocolVersion: "HLL-BLIND-STAGE/1",
    taskId: input.taskId,
    stageId: input.stageId,
    elements: ordered.map((element, index) => ({
      elementId: element.elementId,
      order: element.order,
      instructionFingerprint: blindElements[index]!.instructionFingerprint,
      inputFingerprint: blindElements[index]!.inputFingerprint,
      outputFingerprint: canonicalDigest(element.expectedOutput),
      effectFingerprints: digestMany(element.expectedEffects ?? []),
      evidenceFingerprints: digestMany(element.expectedEvidence ?? [])
    })),
    traceRoot: "RUNTIME_TRACE_ROOT",
    artifactFingerprints: uniqSorted(ordered.map((element) => canonicalDigest(element.expectedOutput)))
  };

  const commitmentId = `HLLCOMMIT-${randomUUID().slice(0, 10).toUpperCase()}`;
  const commitmentNonce = randomBytes(32).toString("hex");
  const commitmentFingerprint = stageCommitmentDigest({
    commitmentId,
    taskId: input.taskId,
    stageId: input.stageId,
    executorId: input.executorId,
    capabilityLeaseId: input.capabilityLease.leaseId,
    expectedFragment,
    commitmentNonce
  });

  const at = new Date().toISOString();
  return {
    blindAssignment: {
      assignmentId: `BLIND-${randomUUID().slice(0, 10).toUpperCase()}`,
      protocolVersion: "HLL-BLIND-STAGE/1",
      taskId: input.taskId,
      stageId: input.stageId,
      executorId: input.executorId,
      capabilityLeaseId: input.capabilityLease.leaseId,
      commitmentId,
      commitmentFingerprint,
      elements: blindElements,
      issuedAt: at
    },
    privateCommitment: {
      commitmentId,
      protocolVersion: "HLL-BLIND-STAGE/1",
      taskId: input.taskId,
      stageId: input.stageId,
      executorId: input.executorId,
      capabilityLeaseId: input.capabilityLease.leaseId,
      expectedFragment,
      commitmentNonce,
      commitmentFingerprint,
      createdAt: at
    }
  };
}

function traceEventBase(input: Omit<TraceEvent, "eventId" | "eventFingerprint"> & { eventId?: string }) {
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

/**
 * MUST be called by the trusted trace writer / supervisor, not by the LLM worker.
 * Hash chaining is tamper-evident. It is not hardware attestation by itself.
 */
export function createTraceEvent(
  input: Omit<TraceEvent, "eventId" | "eventFingerprint"> & { eventId?: string }
): TraceEvent {
  const base = traceEventBase(input);
  return {
    ...base,
    eventFingerprint: canonicalDigest(base)
  };
}

export function verifyTrace(assignment: BlindStageAssignment, trace: TraceEvent[]): void {
  if (trace.length !== assignment.elements.length) throw new Error("HLL_TRACE_CARDINALITY_MISMATCH");

  let previous: string | null = null;
  for (let index = 0; index < trace.length; index += 1) {
    const event = trace[index]!;
    const element = assignment.elements[index]!;

    const base = traceEventBase(event);
    if (event.eventFingerprint !== canonicalDigest(base)) throw new Error("HLL_TRACE_EVENT_TAMPERED");
    if (event.sequence !== index + 1) throw new Error("HLL_TRACE_SEQUENCE_INVALID");
    if (event.previousEventFingerprint !== previous) throw new Error("HLL_TRACE_CHAIN_INVALID");
    if (event.taskId !== assignment.taskId || event.stageId !== assignment.stageId) {
      throw new Error("HLL_TRACE_STAGE_BINDING_MISMATCH");
    }
    if (event.executorId !== assignment.executorId) throw new Error("HLL_TRACE_EXECUTOR_MISMATCH");
    if (event.capabilityLeaseId !== assignment.capabilityLeaseId) throw new Error("HLL_TRACE_LEASE_MISMATCH");
    if (event.elementId !== element.elementId || event.operationId !== element.operationId) {
      throw new Error("HLL_TRACE_ELEMENT_MISMATCH");
    }
    if (event.instructionFingerprint !== element.instructionFingerprint) {
      throw new Error("HLL_TRACE_INSTRUCTION_MISMATCH");
    }
    if (event.inputFingerprint !== element.inputFingerprint) throw new Error("HLL_TRACE_INPUT_MISMATCH");

    previous = event.eventFingerprint;
  }
}

export function synthesizeLocalHll(
  assignment: BlindStageAssignment,
  trace: TraceEvent[]
): HllLocalStageFragment {
  verifyTrace(assignment, trace);

  return {
    protocolVersion: "HLL-BLIND-STAGE/1",
    taskId: assignment.taskId,
    stageId: assignment.stageId,
    elements: trace.map((event) => ({
      elementId: event.elementId,
      order: event.sequence,
      instructionFingerprint: event.instructionFingerprint,
      inputFingerprint: event.inputFingerprint,
      outputFingerprint: event.outputFingerprint,
      effectFingerprints: uniqSorted(event.effectFingerprints),
      evidenceFingerprints: uniqSorted(event.evidenceFingerprints)
    })),
    traceRoot: trace.at(-1)?.eventFingerprint ?? "",
    artifactFingerprints: uniqSorted(trace.map((event) => event.outputFingerprint))
  };
}

function semanticComparable(fragment: HllLocalStageFragment): HllLocalStageFragment {
  return {
    ...structuredClone(fragment),
    traceRoot: "RUNTIME_TRACE_ROOT"
  };
}

function verifyPrivateCommitment(
  assignment: BlindStageAssignment,
  commitment: PrivateStageCommitment
): void {
  if (assignment.commitmentId !== commitment.commitmentId) throw new Error("HLL_STAGE_COMMITMENT_ID_MISMATCH");
  if (assignment.commitmentFingerprint !== commitment.commitmentFingerprint) {
    throw new Error("HLL_STAGE_PUBLIC_COMMITMENT_MISMATCH");
  }
  if (
    commitment.commitmentFingerprint !== stageCommitmentDigest({
      commitmentId: commitment.commitmentId,
      taskId: commitment.taskId,
      stageId: commitment.stageId,
      executorId: commitment.executorId,
      capabilityLeaseId: commitment.capabilityLeaseId,
      expectedFragment: commitment.expectedFragment,
      commitmentNonce: commitment.commitmentNonce
    })
  ) {
    throw new Error("HLL_STAGE_PRIVATE_COMMITMENT_TAMPERED");
  }
  if (
    commitment.taskId !== assignment.taskId
    || commitment.stageId !== assignment.stageId
    || commitment.executorId !== assignment.executorId
    || commitment.capabilityLeaseId !== assignment.capabilityLeaseId
  ) {
    throw new Error("HLL_STAGE_COMMITMENT_BINDING_MISMATCH");
  }
}

export function validateBlindStage(input: {
  assignment: BlindStageAssignment;
  privateCommitment: PrivateStageCommitment;
  trace: TraceEvent[];
}): {
  computedFragment: HllLocalStageFragment;
  receipt: HllStageValidationReceipt;
} {
  verifyPrivateCommitment(input.assignment, input.privateCommitment);
  const computedFragment = synthesizeLocalHll(input.assignment, input.trace);

  const expectedComparable = semanticComparable(input.privateCommitment.expectedFragment);
  const computedComparable = semanticComparable(computedFragment);
  const expectedFragmentFingerprint = canonicalDigest(expectedComparable);
  const computedFragmentFingerprint = canonicalDigest(computedComparable);
  const reasons: string[] = [];

  if (expectedFragmentFingerprint !== computedFragmentFingerprint) {
    reasons.push("HLL_LOCAL_FRAGMENT_MISMATCH");
  }

  const base = {
    validationReceiptId: `HLLVAL-${randomUUID().slice(0, 10).toUpperCase()}`,
    protocolVersion: "HLL-BLIND-STAGE/1" as const,
    taskId: input.assignment.taskId,
    stageId: input.assignment.stageId,
    commitmentId: input.privateCommitment.commitmentId,
    commitmentFingerprint: input.privateCommitment.commitmentFingerprint,
    expectedFragmentFingerprint,
    computedFragmentFingerprint,
    traceRoot: computedFragment.traceRoot,
    status: reasons.length ? "FAIL" as const : "PASS" as const,
    reasons,
    validatedAt: new Date().toISOString()
  };

  return {
    computedFragment,
    receipt: {
      ...base,
      receiptFingerprint: canonicalDigest(base)
    }
  };
}

export function verifyStageValidationReceipt(receipt: HllStageValidationReceipt): void {
  const { receiptFingerprint, ...base } = receipt;
  if (receiptFingerprint !== canonicalDigest(base)) throw new Error("HLL_STAGE_VALIDATION_RECEIPT_TAMPERED");
}

export function issueNextStageLease(input: {
  validationReceipt: HllStageValidationReceipt;
  taskId: string;
  stageId: string;
  candidateId: string;
  roleId: string;
  executorId: string;
  allowedCapabilities: string[];
  allowedEffects: string[];
  allowedTools: string[];
  ttlMs?: number;
}): CapabilityLeaseReceipt {
  verifyStageValidationReceipt(input.validationReceipt);
  if (input.validationReceipt.status !== "PASS") throw new Error("HLL_STAGE_NOT_RATIFIED");
  if (input.validationReceipt.taskId !== input.taskId) throw new Error("HLL_NEXT_STAGE_TASK_MISMATCH");

  return createCapabilityLeaseReceipt({
    taskId: input.taskId,
    stageId: input.stageId,
    candidateId: input.candidateId,
    roleId: input.roleId,
    executorId: input.executorId,
    allowedCapabilities: input.allowedCapabilities,
    allowedEffects: input.allowedEffects,
    allowedTools: input.allowedTools,
    ...(input.ttlMs === undefined ? {} : { ttlMs: input.ttlMs })
  });
}
