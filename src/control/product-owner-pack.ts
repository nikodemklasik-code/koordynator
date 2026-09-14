export type ProductOwnerTaskPack = {
  role: "researcher" | "developer" | "qc-pre-build";
  objective: string;
  acceptance: string[];
  nonGoals: string[];
};

export type ProductOwnerContract = {
  role: "product-owner";
  goal: string;
  userEffect: string;
  nonGoals: string[];
  acceptance: string[];
  failure: string[];
  thread: string;
  packs: ProductOwnerTaskPack[];
};

const THREAD_MARKERS = [
  /\bkontynuuj\b/i,
  /\bwznów\b/i,
  /\bwznow\b/i,
  /\bdalej\b/i,
  /\bnie gub\b/i,
  /\bten sam wątek\b/i,
  /\bthis thread\b/i
];

function firstSentence(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  const match = trimmed.match(/^.{12,180}?(?:[.!?]|$)/);
  return (match?.[0] ?? trimmed).trim();
}

function bullets(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

/**
 * Product Owner turns a live request into a contract plus handoff packs.
 * It does not write code. Later roles receive bounded packs, not a lost thread.
 */
export function buildProductOwnerContract(request: string, threadHint = ""): ProductOwnerContract {
  const goal = firstSentence(request) || "Deliver the operator request without losing the current thread.";
  const thread = threadHint.trim() || (THREAD_MARKERS.some((marker) => marker.test(request))
    ? "Continue the current Live Chat thread; do not restart from a blank brief."
    : "Keep this request attached to the current session until the packs are accepted.");
  const nonGoals = bullets([
    "Do not write production code in the Product Owner role",
    "Do not invent a new architecture track",
    "Do not drop the current conversation thread"
  ]);
  const acceptance = bullets([
    "Goal, user effect, non-goals and failure modes are explicit",
    "Each downstream pack names one role and measurable acceptance",
    "The original request remains the source of the packs"
  ]);
  const failure = bullets([
    "A worker starts coding before the packs exist",
    "A later role re-asks the original question from scratch",
    "Acceptance is vague enough that FAIL can be called PASS"
  ]);
  return {
    role: "product-owner",
    goal,
    userEffect: `The operator can continue from this thread with executable packs instead of a lost brief: ${goal}`,
    nonGoals,
    acceptance,
    failure,
    thread,
    packs: [
      {
        role: "researcher",
        objective: `Collect facts needed to execute: ${goal}`,
        acceptance: ["Facts, inferences and unknowns are separated", "No implementation in this pack"],
        nonGoals: ["Do not write code", "Do not change the Product Owner contract"]
      },
      {
        role: "developer",
        objective: `Implement only the scoped change that satisfies: ${goal}`,
        acceptance: ["Changed files match the pack", "Independent tests cover the changed element"],
        nonGoals: ["Do not expand scope", "Do not push"]
      },
      {
        role: "qc-pre-build",
        objective: `Compare the developer pack against the Product Owner contract for: ${goal}`,
        acceptance: ["QC_PRE_BUILD is 0 or 1 with evidence", "A FAIL names the exact missing acceptance"],
        nonGoals: ["Do not implement the fix", "Do not promote the build"]
      }
    ]
  };
}

export function formatLiveChatAnswerStyle(): string {
  return [
    "ANSWER FORMAT FOR LIVE CHAT",
    "Structure every reply with short headings and bullet lists.",
    "Do not write a chain of sentences one under another.",
    "Each bullet is one claim. Paragraphs stay at most two sentences.",
    "Match the operator language. Polish in, Polish out."
  ].join("\n");
}

export function formatProductOwnerContract(contract: ProductOwnerContract): string {
  const packLines = contract.packs.flatMap((pack) => [
    `- ${pack.role}: ${pack.objective}`,
    `  acceptance: ${pack.acceptance.join("; ")}`
  ]);
  return [
    "PRODUCT OWNER CONTRACT",
    `GOAL: ${contract.goal}`,
    `USER_EFFECT: ${contract.userEffect}`,
    `THREAD: ${contract.thread}`,
    `NON_GOALS: ${contract.nonGoals.join("; ")}`,
    `ACCEPTANCE: ${contract.acceptance.join("; ")}`,
    `FAILURE: ${contract.failure.join("; ")}`,
    "PACKS:",
    ...packLines
  ].join("\n");
}
