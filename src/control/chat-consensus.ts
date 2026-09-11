/**
 * Detects the one situation that may materialise a Tasks entry from a chat thread:
 * the USER explicitly asks to send an already-agreed plan to production.
 *
 * Two independent conditions must BOTH hold:
 *   1. the last user turn is an explicit shipping request (not a question, not a refusal);
 *   2. an assistant turn carries a concrete agreed plan (objective + scope + acceptance criteria).
 *
 * Anything less returns null. The assistant proposing to ship is never sufficient.
 */

export type ConsensusMessage = { role: string; content: string };

export type ProjectConsensus = {
  objective: string;
  modules: string[];
  allowedPaths: string[];
  acceptanceCriteria: string[];
};

const PLAN_MARKER = /(?:^|\n)\s*(?:PLAN\s+UZGODNIONY|AGREED\s+PLAN)\s*(?:\n|$)/i;

// Explicit "ship it" phrasings. Kept deliberately narrow: a request, not a musing.
const SHIP_REQUEST = [
  /\bkieruj(?:e|emy)?\s+(?:to\s+|go\s+)?do\s+produkcj/i,
  /\bskieruj\s+(?:to\s+|go\s+)?do\s+produkcj/i,
  /\b(?:idziemy|wchodzimy|przechodzimy)\s+do\s+produkcj/i,
  /\bzatwierdzam\s+do\s+(?:produkcji|realizacji)/i,
  /\b(?:materializuj|zmaterializuj)\b/i,
  /\bdo\s+realizacji\b/i,
  /\bsend\s+(?:it\s+)?to\s+production\b/i,
  /\bship\s+it\b/i
];

// Negations and questions that must never be read as approval.
const NOT_A_REQUEST = [
  /\bnie\s+(?:kieruj|skieruj|materializuj|zmaterializuj|wysyłaj|wysylaj)\b/i,
  /\bjeszcze\s+nie\b/i,
  /\bnie\s+jeszcze\b/i,
  /\bwstrzymaj\b/i,
  /\bczekaj\b/i,
  /\bdon'?t\s+ship\b/i,
  /\bnot\s+yet\b/i,
  // "nie mów 'kieruj do produkcji'", "zanim skierujesz", "dopóki nie…" — conditions, not orders.
  /\b(?:nie|bez)\s+\w+(?:\s+\w+)?\s*["'„»]/i,
  /\bdopóki\b|\bdopoki\b/i,
  /\bzanim\b/i,
  /\bgdy\b|\bkiedy\b|\bjeśli\b|\bjesli\b/i,
  /\bmoże\s+/i
];

function isShipRequest(text: string): boolean {
  const value = text.trim();
  if (!value) return false;
  if (NOT_A_REQUEST.some((pattern) => pattern.test(value))) return false;
  // A trailing question mark means the user is asking, not instructing.
  if (/\?\s*$/.test(value)) return false;
  // A quoted ship phrase is being discussed, not issued.
  if (/["'„»][^"'”«]*(?:do\s+produkcji|to\s+production)/i.test(value)) return false;
  return SHIP_REQUEST.some((pattern) => pattern.test(value));
}

function section(plan: string, labels: string[]): string[] {
  const lines = plan.split("\n");
  const wanted = labels.map((label) => label.toLowerCase());
  const collected: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!.trim();
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const label = line.slice(0, separator).trim().toLowerCase();
    if (!wanted.includes(label)) continue;

    const inline = line.slice(separator + 1).trim();
    if (inline) {
      collected.push(...inline.split(",").map((item) => item.trim()).filter(Boolean));
    }
    // Also absorb any immediately following bullet list.
    for (let next = index + 1; next < lines.length; next += 1) {
      const bullet = lines[next]!.trim();
      const match = /^(?:[-*•]|\d+[.)])\s+(.+)$/.exec(bullet);
      if (!match?.[1]) break;
      collected.push(match[1].trim());
    }
  }
  return collected.filter(Boolean);
}

function parsePlan(plan: string): ProjectConsensus | null {
  const objective = section(plan, ["cel", "objective", "goal"])[0] ?? "";
  const modules = section(plan, ["moduły", "moduly", "modules", "moduł", "modul", "module"]);
  const allowedPaths = section(plan, ["ścieżki", "sciezki", "paths", "allowedpaths", "ścieżka", "sciezka"]);
  const acceptanceCriteria = section(plan, [
    "kryteria akceptacji", "kryteria", "acceptance criteria", "acceptance"
  ]);

  if (objective.length < 3) return null;
  if (modules.length === 0 || allowedPaths.length === 0) return null;
  if (acceptanceCriteria.length === 0) return null;

  return { objective, modules, allowedPaths, acceptanceCriteria };
}

/** Extracts a concrete plan from a single assistant message, or null when it is not one. */
export function parseAgreedPlan(content: string): ProjectConsensus | null {
  const text = String(content ?? "");
  if (!PLAN_MARKER.test(text)) return null;
  return parsePlan(text);
}

export function detectProjectConsensus(messages: ConsensusMessage[]): ProjectConsensus | null {
  if (!Array.isArray(messages) || messages.length === 0) return null;

  // 1. The most recent user turn must be an explicit shipping request.
  let requestIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]!.role !== "user") continue;
    requestIndex = isShipRequest(String(messages[index]!.content ?? "")) ? index : -1;
    break;
  }
  if (requestIndex < 0) return null;

  // 2. The plan must already exist WHEN the user asks — approving something that has not
  //    been proposed yet would let a later plan inherit an earlier, unrelated approval.
  for (let index = requestIndex - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.role !== "assistant") continue;
    const content = String(message.content ?? "");
    if (!PLAN_MARKER.test(content)) continue;
    const parsed = parsePlan(content);
    if (parsed) return parsed;
  }
  return null;
}
