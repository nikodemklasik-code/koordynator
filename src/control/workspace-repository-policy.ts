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
    localWorkspace: false,
    protectedBranches: ["main", "develop"],
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
  const policy = Object.values(WORKSPACE_REPOSITORY_POLICIES)
    .find((item) => item.repository?.toLowerCase() === normalizedRepo);
  if (!policy || policy.protectedBranches.length === 0) return null;

  const value = String(text || "").trim();
  if (!value) return null;
  const asksPush = /\b(push|pushuj|pushnij|wypchnij|opublikuj)\b/i.test(value)
    || /\bprosz[eę]\b[\s\S]{0,40}\bpush\b/i.test(value);
  if (!asksPush) return null;

  const lower = value.toLowerCase();
  const explicit = policy.protectedBranches.find((branch) => {
    const token = branch.toLowerCase();
    return lower.includes(token) || lower.includes(`refs/heads/${token}`);
  });
  const branch = explicit ?? (
    workspace === policy.id || policy.repository.toLowerCase() === normalizedRepo
      ? policy.defaultPublishBranch
      : null
  );
  return branch ? { repository: policy.repository, branch: branchToken(branch) } : null;
}

export function protectedBranchesForRepository(repository: string): string[] {
  const normalized = repository.toLowerCase();
  return Object.values(WORKSPACE_REPOSITORY_POLICIES)
    .find((item) => item.repository?.toLowerCase() === normalized)
    ?.protectedBranches.slice() ?? [];
}
