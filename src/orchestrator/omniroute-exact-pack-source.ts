import { createHash } from "node:crypto";
import { canonicalDigest } from "../crypto/canonical-digest.js";
import type { Digest, TaskId } from "../domain/ids.js";
import type { CapabilityRequest, SecurityClass } from "../api/capability-api.js";
import type {
  OmniRouteModelSelection,
  OmniRouteModelSelector
} from "../api/omniroute-model-selector.js";
import type { ProviderResult } from "../api/provider-contract.js";
import type { ProviderExecutionReceipt } from "../api/provider-receipt.js";
import type { ExactPackRequestContext, ExactPackSource } from "../engine/exact-pack-agent-materializer.js";
import {
  createExactMaterializationPack,
  type ExactFileOperation,
  type ExactMaterializationPack
} from "../engine/exact-materialization-pack.js";

export type HarmoniaExactPackFileDirective =
  | {
      kind: "create";
      path: string;
      contentContract: string;
    }
  | {
      kind: "replace";
      path: string;
      beforeFp: Digest;
      contentContract: string;
    };

export type HarmoniaExactPackDirective = {
  directiveFp: Digest;
  taskId: TaskId;
  orderFp: Digest;
  files: HarmoniaExactPackFileDirective[];
};

type DirectiveInput = Omit<HarmoniaExactPackDirective, "directiveFp">;

export function createHarmoniaExactPackDirective(input: DirectiveInput): HarmoniaExactPackDirective {
  const base = {
    taskId: input.taskId,
    orderFp: input.orderFp,
    files: input.files.map((file) => ({ ...file }))
  };
  return {
    ...base,
    directiveFp: canonicalDigest({ kind: "harmonia-exact-pack-directive-v1", ...base })
  };
}

export interface PackAiExecutor {
  execute<T>(request: CapabilityRequest): Promise<{
    result: ProviderResult<T>;
    receipts?: readonly ProviderExecutionReceipt[];
  }>;
}

export type OmniRouteExactPackSourceOptions = {
  directive(context: Readonly<ExactPackRequestContext>): HarmoniaExactPackDirective;
  securityClass?: SecurityClass;
  defaultModel?: string;
  maxLatencyMs?: number;
  modelSelector?: OmniRouteModelSelector;
};

export type OmniRoutePackCompositionRecord = {
  taskId: TaskId;
  directiveFp: Digest;
  requestFp: Digest;
  outputFp: Digest;
  packFp: Digest;
  aiRoute: string;
  providerReceiptFps: Digest[];
  modelSelection?: OmniRouteModelSelection;
};

type ChatCompletionBody = {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
};

type ModelEnvelope = {
  files: Array<{ path: string; content: string }>;
};

type ResolvedModel = {
  model: string;
  selection?: OmniRouteModelSelection;
};

function bytesDigest(value: string): Digest {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], code: string): void {
  const keys = Object.keys(value).sort();
  const expected = [...allowed].sort();
  if (canonicalDigest(keys) !== canonicalDigest(expected)) throw new Error(code);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function scopeAllows(pattern: string, path: string): boolean {
  const normalized = pattern.replace(/\\/g, "/").replace(/^\.\//, "");
  if (normalized === "**" || normalized === "**/*") return true;
  if (normalized.endsWith("/**")) {
    const base = normalized.slice(0, -3).replace(/\/$/, "");
    return path === base || path.startsWith(`${base}/`);
  }
  if (normalized.endsWith("/*")) {
    const base = normalized.slice(0, -2).replace(/\/$/, "");
    if (!path.startsWith(`${base}/`)) return false;
    return !path.slice(base.length + 1).includes("/");
  }
  if (normalized.includes("*")) return false;
  return path === normalized;
}

function validateDirective(directive: Readonly<HarmoniaExactPackDirective>, context: Readonly<ExactPackRequestContext>): void {
  const order = context.order;
  if (order.initiative !== "brak") throw new Error("AGENT_INITIATIVE_FORBIDDEN");
  if (directive.taskId !== order.taskId) throw new Error("HARMONIA_PACK_TASK_MISMATCH");
  if (directive.orderFp !== canonicalDigest(order)) throw new Error("HARMONIA_PACK_ORDER_MISMATCH");

  const expectedDirectiveFp = canonicalDigest({
    kind: "harmonia-exact-pack-directive-v1",
    taskId: directive.taskId,
    orderFp: directive.orderFp,
    files: directive.files
  });
  if (directive.directiveFp !== expectedDirectiveFp) throw new Error("HARMONIA_PACK_DIRECTIVE_FINGERPRINT_MISMATCH");
  if (directive.files.length === 0) throw new Error("HARMONIA_PACK_FILES_REQUIRED");

  const seen = new Set<string>();
  for (const file of directive.files) {
    if (!file.path.trim() || file.path.startsWith("/") || file.path.includes("\\") || file.path.split("/").some((part) => !part || part === "." || part === "..")) {
      throw new Error(`HARMONIA_PACK_PATH_INVALID:${file.path}`);
    }
    if (seen.has(file.path)) throw new Error(`HARMONIA_PACK_DUPLICATE_PATH:${file.path}`);
    seen.add(file.path);
    if (!order.allowedPaths.some((pattern) => scopeAllows(pattern, file.path))) throw new Error(`HARMONIA_PACK_PATH_OUT_OF_SCOPE:${file.path}`);
    if (!file.contentContract.trim()) throw new Error(`HARMONIA_PACK_CONTENT_CONTRACT_REQUIRED:${file.path}`);
    if (file.kind === "replace" && !/^sha256:[a-f0-9]{64}$/i.test(file.beforeFp)) throw new Error(`HARMONIA_PACK_BEFORE_FP_INVALID:${file.path}`);
  }
}

function extractContent(output: unknown): string {
  if (!isObject(output)) throw new Error("OMNIROUTE_PACK_RESPONSE_INVALID");
  const body = output as ChatCompletionBody;
  const content = body.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new Error("OMNIROUTE_PACK_CONTENT_MISSING");
  return content.trim();
}

function parseEnvelope(content: string): ModelEnvelope {
  if (!content.startsWith("{") || !content.endsWith("}")) throw new Error("OMNIROUTE_PACK_JSON_ONLY_REQUIRED");
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("OMNIROUTE_PACK_JSON_INVALID");
  }
  if (!isObject(parsed)) throw new Error("OMNIROUTE_PACK_ENVELOPE_INVALID");
  exactKeys(parsed, ["files"], "OMNIROUTE_PACK_ENVELOPE_KEYS_INVALID");
  if (!Array.isArray(parsed.files)) throw new Error("OMNIROUTE_PACK_FILES_INVALID");

  const files: Array<{ path: string; content: string }> = [];
  for (const item of parsed.files) {
    if (!isObject(item)) throw new Error("OMNIROUTE_PACK_FILE_INVALID");
    exactKeys(item, ["path", "content"], "OMNIROUTE_PACK_FILE_KEYS_INVALID");
    if (typeof item.path !== "string" || typeof item.content !== "string") throw new Error("OMNIROUTE_PACK_FILE_INVALID");
    files.push({ path: item.path, content: item.content });
  }
  return { files };
}

function assertModelAllowed(model: string): void {
  if (model.toLowerCase().includes("deepseek")) throw new Error("FORBIDDEN_MODEL_ROUTE");
}

async function resolveModel(
  route: string,
  fallback: string,
  selector: OmniRouteModelSelector | undefined,
  maxLatencyMs: number
): Promise<ResolvedModel> {
  const trimmed = route.trim();
  if (trimmed && trimmed.toLowerCase() !== "omniroute") {
    assertModelAllowed(trimmed);
    return { model: trimmed };
  }

  if (selector === undefined) {
    assertModelAllowed(fallback);
    return { model: fallback };
  }

  const selection = await selector.select({
    purpose: "EXACT_PACK",
    maxLatencyMs,
    fallbackModel: fallback
  });
  assertModelAllowed(selection.modelId);
  return { model: selection.modelId, selection };
}

export class OmniRouteExactPackSource implements ExactPackSource {
  private readonly history: OmniRoutePackCompositionRecord[] = [];

  constructor(
    private readonly executor: PackAiExecutor,
    private readonly options: OmniRouteExactPackSourceOptions
  ) {}

  records(): readonly OmniRoutePackCompositionRecord[] {
    return this.history;
  }

  async next(context: Readonly<ExactPackRequestContext>): Promise<ExactMaterializationPack> {
    const directive = this.options.directive(context);
    validateDirective(directive, context);

    const maxLatencyMs = this.options.maxLatencyMs ?? Math.max(1000, context.currentRequest.signedWorkOrder.order.budget.timeSec * 1000);
    const resolvedModel = await resolveModel(
      context.conditions.aiRoute,
      this.options.defaultModel ?? "auto/best-free",
      this.options.modelSelector,
      maxLatencyMs
    );
    const model = resolvedModel.model;
    const correction = context.correction?.trim();
    const immutableSpec = {
      taskId: context.order.taskId,
      instructions: context.order.instructions,
      expectedResult: context.order.expectedResult,
      allowedPaths: [...context.order.allowedPaths],
      directiveFp: directive.directiveFp,
      files: directive.files.map((file) => ({
        kind: file.kind,
        path: file.path,
        contentContract: file.contentContract,
        ...(file.kind === "replace" ? { beforeFp: file.beforeFp } : {})
      })),
      ...(correction ? { correction } : {})
    };
    const input = {
      model,
      messages: [
        {
          role: "system",
          content: "Jesteś źródłem materiału wykonawczego Harmonii. Nie projektujesz, nie zmieniasz zakresu i nie dodajesz plików. Zwróć WYŁĄCZNIE jeden obiekt JSON o postaci {\"files\":[{\"path\":\"...\",\"content\":\"...\"}]}. Każdy i tylko każdy path z wejścia ma wystąpić dokładnie raz. Nie zwracaj Markdown ani komentarza poza JSON."
        },
        {
          role: "user",
          content: JSON.stringify(immutableSpec)
        }
      ],
      response_format: { type: "json_object" }
    };
    const request: CapabilityRequest = {
      requestId: `${context.order.taskId}:exact-pack:${context.conditions.generation}:${directive.directiveFp.slice(7, 19)}`,
      taskId: context.order.taskId,
      tenantId: context.currentRequest.signedWorkOrder.order.workspaceId,
      role: "PLANNER",
      capability: "ai.code",
      input,
      inputFp: canonicalDigest(input),
      securityClass: this.options.securityClass ?? "S2",
      purposeId: "harmonia-exact-pack-composition",
      idempotencyKey: canonicalDigest({
        kind: "omniroute-exact-pack-request-v1",
        directiveFp: directive.directiveFp,
        generation: context.conditions.generation,
        model,
        correction: correction ?? null
      }),
      requirements: {
        externalProviderAllowed: true,
        allowProviderFailover: false,
        allowPaidApiFallback: true,
        billingPolicy: "API_FIRST",
        maxCost: context.currentRequest.signedWorkOrder.order.budget.costLimit,
        maxLatencyMs
      }
    };

    const outcome = await this.executor.execute<unknown>(request);
    const envelope = parseEnvelope(extractContent(outcome.result.output));
    const expectedPaths = directive.files.map((file) => file.path);
    if (envelope.files.length !== expectedPaths.length) throw new Error("OMNIROUTE_PACK_FILE_COUNT_MISMATCH");

    const returned = new Map<string, string>();
    for (const file of envelope.files) {
      if (returned.has(file.path)) throw new Error(`OMNIROUTE_PACK_DUPLICATE_RETURNED_PATH:${file.path}`);
      returned.set(file.path, file.content);
    }
    for (const path of returned.keys()) {
      if (!expectedPaths.includes(path)) throw new Error(`OMNIROUTE_PACK_UNDECLARED_PATH:${path}`);
    }

    const operations: ExactFileOperation[] = directive.files.map((file) => {
      const content = returned.get(file.path);
      if (content === undefined) throw new Error(`OMNIROUTE_PACK_MISSING_PATH:${file.path}`);
      const afterFp = bytesDigest(content);
      return file.kind === "create"
        ? { kind: "create", path: file.path, content, afterFp }
        : { kind: "replace", path: file.path, content, beforeFp: file.beforeFp, afterFp };
    });
    const pack = createExactMaterializationPack(operations);
    const outputFp = canonicalDigest(envelope);
    const providerReceiptFps = (outcome.receipts ?? []).map((receipt) => receipt.receiptFp);
    this.history.push({
      taskId: context.order.taskId,
      directiveFp: directive.directiveFp,
      requestFp: canonicalDigest(request),
      outputFp,
      packFp: pack.packFp,
      aiRoute: model,
      providerReceiptFps,
      ...(resolvedModel.selection === undefined ? {} : { modelSelection: resolvedModel.selection })
    });
    return pack;
  }
}
