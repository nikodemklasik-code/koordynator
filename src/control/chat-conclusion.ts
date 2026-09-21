import { canonicalDigest } from "../crypto/canonical-digest.js";
import { parseAgreedPlan, type ProjectConsensus } from "./chat-consensus.js";

export type ConclusionSourceMessage = {
  id: string;
  role: string;
  content: string;
};

export type ConclusionEvidence = {
  messageId: string;
  quote: string;
};

export type ConclusionTaskCandidate = ProjectConsensus & {
  title: string;
  evidence: ConclusionEvidence[];
};

export type DeterminedConversationTask = ConclusionTaskCandidate & {
  fingerprint: string;
  source: "EXPLICIT_PLAN" | "MODEL_GROUNDED";
};

export type ConversationConclusion = {
  sourceFingerprint: string;
  tasks: DeterminedConversationTask[];
};

function normalizeSpace(value: string): string {
  return value.normalize("NFKC").replace(/\\s+/g, " ").trim();
}

function cleanList(values: unknown, max = 40): string[] {
  if (!Array.isArray(values)) return [];
  const result = values
    .filter((value): value is string => typeof value === "string")
    .map(normalizeSpace)
    .filter(Boolean)
    .slice(0, max);
  return [...new Set(result)];
}

function safeRelativePath(path: string): boolean {
  return Boolean(path)
    && !path.startsWith("/")
    && !path.includes("..")
    && !/[\\u0000-\\u001f]/.test(path);
}

function groundedEvidence(
  evidence: ConclusionEvidence[],
  messages: ConclusionSourceMessage[]
): ConclusionEvidence[] {
  const byId = new Map(messages.map((message) => [message.id, message]));
  const result: ConclusionEvidence[] = [];
  for (const item of evidence) {
    const message = byId.get(item.messageId);
    const quote = normalizeSpace(item.quote);
    if (!message || quote.length < 3) continue;
    const haystack = normalizeSpace(message.content);
    if (!haystack.includes(quote)) continue;
    result.push({ messageId: item.messageId, quote });
  }
  return result;
}

function normalizeCandidate(
  candidate: ConclusionTaskCandidate,
  messages: ConclusionSourceMessage[],
  source: DeterminedConversationTask["source"]
): DeterminedConversationTask | null {
  const objective = normalizeSpace(candidate.objective);
  const title = normalizeSpace(candidate.title || objective).slice(0, 160);
  const modules = cleanList(candidate.modules);
  const allowedPaths = cleanList(candidate.allowedPaths).filter(safeRelativePath);
  const acceptanceCriteria = cleanList(candidate.acceptanceCriteria);
  const evidence = groundedEvidence(candidate.evidence || [], messages);

  if (objective.length < 3 || !modules.length || !allowedPaths.length || !acceptanceCriteria.length) {
    return null;
  }
  if (source === "MODEL_GROUNDED" && !evidence.length) return null;

  const fingerprint = canonicalDigest({
    objective: objective.toLowerCase(),
    modules: [...modules].map((item) => item.toLowerCase()).sort(),
    allowedPaths: [...allowedPaths].map((item) => item.toLowerCase()).sort(),
    acceptanceCriteria: [...acceptanceCriteria].map((item) => item.toLowerCase()).sort()
  });

  return {
    title,
    objective,
    modules,
    allowedPaths,
    acceptanceCriteria,
    evidence,
    fingerprint,
    source
  };
}

function explicitPlanCandidates(messages: ConclusionSourceMessage[]): DeterminedConversationTask[] {
  const tasks: DeterminedConversationTask[] = [];
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    const plan = parseAgreedPlan(message.content);
    if (!plan) continue;
    const candidate = normalizeCandidate({
      ...plan,
      title: plan.objective,
      evidence: [{ messageId: message.id, quote: plan.objective }]
    }, messages, "EXPLICIT_PLAN");
    if (candidate) tasks.push(candidate);
  }
  return tasks;
}

export function conversationSourceFingerprint(messages: ConclusionSourceMessage[]): string {
  return canonicalDigest(messages.map((message) => ({
    id: message.id,
    role: message.role,
    content: message.content
  })));
}

export function parseGroundedConclusionPayload(
  payload: unknown,
  messages: ConclusionSourceMessage[]
): DeterminedConversationTask[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const rawTasks = (payload as { tasks?: unknown }).tasks;
  if (!Array.isArray(rawTasks)) return [];

  const tasks: DeterminedConversationTask[] = [];
  for (const item of rawTasks.slice(0, 40)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const evidenceRaw = Array.isArray(row.evidence) ? row.evidence : [];
    const evidence: ConclusionEvidence[] = evidenceRaw.flatMap((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
      const record = entry as Record<string, unknown>;
      if (typeof record.messageId !== "string" || typeof record.quote !== "string") return [];
      return [{ messageId: record.messageId, quote: record.quote }];
    });
    const candidate = normalizeCandidate({
      title: typeof row.title === "string" ? row.title : "",
      objective: typeof row.objective === "string" ? row.objective : "",
      modules: cleanList(row.modules),
      allowedPaths: cleanList(row.allowedPaths),
      acceptanceCriteria: cleanList(row.acceptanceCriteria),
      evidence
    }, messages, "MODEL_GROUNDED");
    if (candidate) tasks.push(candidate);
  }
  return tasks;
}

export function concludeConversation(input: {
  messages: ConclusionSourceMessage[];
  modelCandidates?: DeterminedConversationTask[];
}): ConversationConclusion {
  const sourceFingerprint = conversationSourceFingerprint(input.messages);
  const explicit = explicitPlanCandidates(input.messages);
  const combined = [...explicit, ...(input.modelCandidates || [])];
  const deduped = new Map<string, DeterminedConversationTask>();
  for (const task of combined) if (!deduped.has(task.fingerprint)) deduped.set(task.fingerprint, task);
  return { sourceFingerprint, tasks: [...deduped.values()] };
}

export function conclusionExtractionPrompt(messages: ConclusionSourceMessage[]): string {
  const transcript = messages
    .filter((message) => normalizeSpace(message.content))
    .map((message) => "[" + message.id + "] " + message.role.toUpperCase() + ": " + message.content)
    .join("\n\n");

  return [
    "Extract only concrete conclusions that are ready to become deterministic Koordynator tasks.",
    'Return JSON only: {"tasks":[{"title":string,"objective":string,"modules":string[],"allowedPaths":string[],"acceptanceCriteria":string[],"evidence":[{"messageId":string,"quote":string}]}]}.',
    "Every task must be grounded in the transcript. Evidence.quote MUST be an exact contiguous quote from the referenced message.",
    "Do not invent repository paths. allowedPaths may contain only relative paths explicitly present in the transcript.",
    "Do not create a task when objective, modules, allowedPaths or acceptance criteria are unresolved.",
    "Separate independent conclusions into separate tasks. Preserve dependencies in the objective or acceptance criteria when stated.",
    'If nothing is sufficiently determined, return {"tasks":[]}.',
    "",
    transcript.slice(0, 96000)
  ].join("\n");
}

export function parseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fence = String.fromCharCode(96).repeat(3);
  let unfenced = trimmed;
  if (unfenced.startsWith(fence)) {
    unfenced = unfenced.slice(fence.length).replace(/^json\s*/i, "");
    if (unfenced.endsWith(fence)) unfenced = unfenced.slice(0, -fence.length);
    unfenced = unfenced.trim();
  }
  try {
    return JSON.parse(unfenced);
  } catch {
    const start = unfenced.indexOf("{");
    const end = unfenced.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try { return JSON.parse(unfenced.slice(start, end + 1)); }
    catch { return null; }
  }
}
