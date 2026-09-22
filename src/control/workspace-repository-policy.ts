export type WorkspaceId = "general" | "corporation" | "harmonia-legal";

export type WorkspaceRepositoryPolicy = {
  id: WorkspaceId;
  repository: string | null;
  localWorkspace: boolean;
  protectedBranches: string[];
  defaultPublishBranch: string | null;
};

export const WORKSPACE_REPOSITORY_POLICIES: Record<WorkspaceId, WorkspaceRepositoryPolicy> = {
  general: {
    id: "general",
    repository: null,
    localWorkspace: false,
    protectedBranches: [],
    defaultPublishBranch: null
  },
  corporation: {
    id: "corporation",
    repository: "nikodemklasik-code/koordynator",
    localWorkspace: true,
    protectedBranches: ["main", "integration/control-corporation-v1"],
    defaultPublishBranch: "integration/control-corporation-v1"
  },
  "harmonia-legal": {
    id: "harmonia-legal",
    repository: "nikodemklasik-code/Harmonia-Legal-Platform",
    localWorkspace: true,
    protectedBranches: ["develop", "main"],
    defaultPublishBranch: "develop"
  }
};

export function safeWorkspaceId(value: unknown): WorkspaceId {
  if (value === undefined || value === null || value === "") return "general";
  if (value === "general" || value === "corporation" || value === "harmonia-legal") return value;
  throw new Error("WORKSPACE_INVALID");
}

export function fixedRepositoryForWorkspace(workspace: WorkspaceId): string | null {
  return WORKSPACE_REPOSITORY_POLICIES[workspace].repository;
}

export function assertWorkspaceRepository(workspace: WorkspaceId, requestedRepository?: string): string | undefined {
  const policy = WORKSPACE_REPOSITORY_POLICIES[workspace];
  if (policy.repository) {
    if (requestedRepository && requestedRepository.toLowerCase() !== policy.repository.toLowerCase()) {
      throw new Error("WORKSPACE_REPOSITORY_FIXED");
    }
    return policy.repository;
  }
  return requestedRepository?.trim() || undefined;
}

function branchToken(value: string): string {
  return value.replace(/^refs\/heads\//, "").trim();
}

export function explicitProtectedPushRequest(
  text: string,
  repository: string | undefined,
  workspace: WorkspaceId
): { repository: string; branch: string } | null {
  if (!repository) return null;
  const normalizedRepo = repository.toLowerCase();
  const matchingPolicies = Object.values(WORKSPACE_REPOSITORY_POLICIES)
    .filter((item) => item.repository?.toLowerCase() === normalizedRepo);
  if (matchingPolicies.length === 0) return null;

  const preferredPolicy = matchingPolicies.find((item) => item.id === workspace);
  const protectedBranches = [...new Set(matchingPolicies.flatMap((item) => item.protectedBranches))];
  if (protectedBranches.length === 0) return null;

  const value = String(text || "").trim();
  if (!value) return null;
  const asksPush = /\b(push|pushuj|pushnij|wypchnij|opublikuj)\b/i.test(value)
    || /\bprosz[eę]\b[\s\S]{0,40}\bpush\b/i.test(value);
  if (!asksPush) return null;

  const lower = value.toLowerCase();
  const explicit = protectedBranches.find((branch) => {
    const token = branch.toLowerCase();
    return lower.includes(token) || lower.includes(`refs/heads/${token}`);
  });
  const branch = explicit ?? preferredPolicy?.defaultPublishBranch ?? null;
  return branch ? { repository, branch: branchToken(branch) } : null;
}

export function protectedBranchesForRepository(repository: string): string[] {
  const normalized = repository.toLowerCase();
  return [...new Set(
    Object.values(WORKSPACE_REPOSITORY_POLICIES)
      .filter((item) => item.repository?.toLowerCase() === normalized)
      .flatMap((item) => item.protectedBranches)
  )];
}
