export type ProviderReportedUsage = {
  reportedBy: "PROVIDER";
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  totalTokens?: number | undefined;
  cost?: number | undefined;
  currency?: string | undefined;
};

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as RecordValue : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  return value;
}

function tokenNumber(value: unknown): number | undefined {
  const number = finiteNumber(value);
  return number === undefined ? undefined : Math.trunc(number);
}

function firstNumber(source: RecordValue, keys: string[], tokens = false): number | undefined {
  for (const key of keys) {
    const value = tokens ? tokenNumber(source[key]) : finiteNumber(source[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function firstString(source: RecordValue, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 24).toUpperCase();
  }
  return undefined;
}

function usageCandidate(value: unknown): RecordValue | undefined {
  const root = record(value);
  if (!root) return undefined;
  for (const key of ["usage", "token_usage", "tokenUsage", "usage_metadata", "usageMetadata"]) {
    const candidate = record(root[key]);
    if (candidate) return candidate;
  }
  for (const key of ["result", "response", "data", "message"]) {
    const nested = usageCandidate(root[key]);
    if (nested) return nested;
  }
  const hasDirectTokenField = [
    "prompt_tokens", "completion_tokens", "total_tokens", "input_tokens", "output_tokens",
    "inputTokens", "outputTokens", "totalTokens", "promptTokens", "completionTokens"
  ].some((key) => root[key] !== undefined);
  return hasDirectTokenField ? root : undefined;
}

export function extractProviderReportedUsage(value: unknown): ProviderReportedUsage | undefined {
  const root = record(value);
  const usage = usageCandidate(value);
  if (!usage) return undefined;

  const inputTokens = firstNumber(usage, ["inputTokens", "input_tokens", "promptTokens", "prompt_tokens"], true);
  const outputTokens = firstNumber(usage, ["outputTokens", "output_tokens", "completionTokens", "completion_tokens"], true);
  let totalTokens = firstNumber(usage, ["totalTokens", "total_tokens"], true);
  if (totalTokens === undefined && (inputTokens !== undefined || outputTokens !== undefined)) {
    totalTokens = (inputTokens ?? 0) + (outputTokens ?? 0);
  }

  const cost = firstNumber(usage, ["cost", "totalCost", "total_cost", "amount"])
    ?? (root ? firstNumber(root, ["cost", "totalCost", "total_cost"]) : undefined);
  const currency = firstString(usage, ["currency", "currencyCode", "currency_code"])
    ?? (root ? firstString(root, ["currency", "currencyCode", "currency_code"]) : undefined);

  if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined && cost === undefined) return undefined;
  return {
    reportedBy: "PROVIDER",
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(totalTokens === undefined ? {} : { totalTokens }),
    ...(cost === undefined ? {} : { cost }),
    ...(currency === undefined ? {} : { currency })
  };
}
