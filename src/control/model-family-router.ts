import type { ChatModelBillingSource, ChatModelEntry } from "./chat-model-catalog.js";

export const FAMILY_PREFIX = "family/";

export type ModelFamily = {
  id: string;
  key: string;
  label: string;
  family: string;
  billingSource: ChatModelBillingSource;
  providers: string[];
  candidates: ChatModelEntry[];
};

/**
 * Vendor effort/thinking suffixes are presentation flags on the same weights, not
 * separate models. Collapsing them keeps one picker row per real model.
 */
const EFFORT_SUFFIX_RE = /-(?:high|low|medium|minimal|thinking|reasoning|effort|nonthinking|no-thinking)$/;

/** Free markers live on the route, never on the model identity. */
const FREE_MARKER_RE = /:(?:free|nitro|floor|online|extended|beta|preview)$/;

/**
 * Free routes come first so a free provider transparently substitutes the same
 * model billed elsewhere; paid API is the last resort.
 */
const SOURCE_RANK: Record<ChatModelBillingSource, number> = {
  FREE_CONFIRMED: 0,
  FREE_OAUTH: 1,
  SUBSCRIPTION_HARNESS: 2,
  FREE_REQUESTED: 3,
  UNKNOWN: 4,
  PAID_API: 5
};

/** Native CLI/OAuth harnesses answer as chat. GitHub Copilot (`gh/`) dumps tool traces into the transcript. */
const NATIVE_PREFIX = new Set(["gc", "cc", "cx", "agy", "cl", "kc", "kmc", "cu", "aq", "of", "kimi"]);

export function routePreference(model: string): number {
  const prefix = model.trim().toLowerCase().split("/")[0] ?? "";
  if (NATIVE_PREFIX.has(prefix)) return 0;
  if (prefix === "gh" || prefix === "github-copilot") return 8;
  return 4;
}

export function familyKey(model: string): string {
  const tail = model.trim().toLowerCase().split("/").pop() ?? "";
  let key = tail.replace(FREE_MARKER_RE, "");
  let previous = "";
  while (key !== previous) {
    previous = key;
    key = key.replace(EFFORT_SUFFIX_RE, "");
  }
  // `claude-opus-4-8` and `claude-opus-4.8` are the same model spelled two ways.
  return key.replace(/(\d)[-_](\d)/g, "$1.$2").replace(/^-+|-+$/g, "");
}

function label(key: string): string {
  return key
    .split("-")
    .filter(Boolean)
    .map((part) => (/^\d/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(" ");
}

const AGENT_GROUP_ORDER = ["Claude", "Gemini", "GPT", "Grok", "Qwen", "Kimi", "Llama", "Command", "Other"];

/**
 * Picker groups by the model family the operator asked for (Claude, Gemini, GPT),
 * not by whichever provider currently owns a live route.
 */
export function agentGroup(model: string, provider?: string): string {
  const value = `${provider ?? ""}/${model}`.toLowerCase();
  if (/\b(?:anthropic|claude)\b/.test(value)) return "Claude";
  if (/\b(?:google|gemini)\b/.test(value)) return "Gemini";
  if (/\b(?:openai|codex)\b/.test(value) || /(?:^|\/)gpt[-._]/.test(value)) return "GPT";
  if (/\b(?:xai|grok)\b/.test(value)) return "Grok";
  if (/\bqwen\b/.test(value)) return "Qwen";
  if (/\b(?:kimi|moonshot)\b/.test(value)) return "Kimi";
  if (/\b(?:meta|llama)\b/.test(value)) return "Llama";
  if (/\b(?:cohere|command|c4ai)\b/.test(value)) return "Command";
  return "Other";
}

export function buildModelFamilies(entries: ChatModelEntry[]): ModelFamily[] {
  const grouped = new Map<string, ChatModelEntry[]>();
  for (const entry of entries) {
    const key = familyKey(entry.id);
    if (!key) continue;
    const bucket = grouped.get(key);
    if (bucket) bucket.push(entry);
    else grouped.set(key, [entry]);
  }

  const families: ModelFamily[] = [];
  for (const [key, bucket] of grouped) {
    const candidates = bucket
      .map((entry, index) => ({ entry, index }))
      .sort((a, b) =>
        (SOURCE_RANK[a.entry.billingSource] - SOURCE_RANK[b.entry.billingSource])
        || (routePreference(a.entry.id) - routePreference(b.entry.id))
        || (a.index - b.index)
      )
      .map((item) => item.entry);
    const best = candidates[0]!;
    const providers: string[] = [];
    for (const candidate of candidates) if (!providers.includes(candidate.provider)) providers.push(candidate.provider);
    families.push({
      id: `${FAMILY_PREFIX}${key}`,
      key,
      label: label(key),
      family: agentGroup(best.id, best.provider),
      billingSource: best.billingSource,
      providers,
      candidates
    });
  }

  const groupRank = (name: string) => {
    const index = AGENT_GROUP_ORDER.indexOf(name);
    return index >= 0 ? index : AGENT_GROUP_ORDER.length;
  };
  return families.sort((a, b) => (groupRank(a.family) - groupRank(b.family)) || (SOURCE_RANK[a.billingSource] - SOURCE_RANK[b.billingSource]) || a.key.localeCompare(b.key));
}

export function familyCandidates(model: string, families: ModelFamily[]): string[] {
  if (!model.startsWith(FAMILY_PREFIX)) return [];
  const key = model.slice(FAMILY_PREFIX.length);
  return families.find((family) => family.key === key)?.candidates.map((candidate) => candidate.id) ?? [];
}
