import { randomUUID } from "node:crypto";
import type { ModelProfile } from "./model-selection.js";

export type SkillManifest = {
  skillId: string;
  name: string;
  version: string;
  description: string;
  capabilities: string[];
  requiredToolsets: string[];
  compatibleModelFamilies: string[];
  incompatibleModelIds: string[];
  riskClass: "LOW" | "MEDIUM" | "HIGH";
  source: "CORE" | "PROVIDER" | "LEARNED" | "OPERATOR";
  evidenceRefs: string[];
};

export type SkillTaskRequirement = {
  taskId: string;
  requiredCapabilities: string[];
  requiredToolsets: string[];
  preferredSkills: string[];
  forbiddenSkills: string[];
};

export type SkillBinding = {
  bindingId: string;
  taskId: string;
  modelId: string;
  skillIds: string[];
  coveredCapabilities: string[];
  uncoveredCapabilities: string[];
  rationale: string[];
};

function includesAll(haystack: string[], needles: string[]): boolean {
  const set = new Set(haystack.map((item) => item.toLowerCase()));
  return needles.every((item) => set.has(item.toLowerCase()));
}

function compatible(skill: SkillManifest, model: ModelProfile): boolean {
  if (skill.incompatibleModelIds.includes(model.modelId)) return false;
  if (
    skill.compatibleModelFamilies.length
    && !skill.compatibleModelFamilies.includes(model.family)
  ) return false;
  return includesAll(model.supportedToolsets, skill.requiredToolsets);
}

/**
 * Constitutional principle:
 * skills adapt a model to the assigned job, but they never expand the model's
 * officially supported capability ceiling. Koordynator may compose skills only
 * after model eligibility has already been established.
 */
export function bindSkillsToTask(input: {
  model: ModelProfile;
  skills: SkillManifest[];
  requirement: SkillTaskRequirement;
}): SkillBinding {
  const forbidden = new Set(input.requirement.forbiddenSkills);
  const eligible = input.skills
    .filter((skill) => !forbidden.has(skill.skillId))
    .filter((skill) => compatible(skill, input.model))
    .filter((skill) =>
      skill.capabilities.every((capability) =>
        input.model.supportedCapabilities
          .map((item) => item.toLowerCase())
          .includes(capability.toLowerCase())
      )
    );

  const needed = new Set(input.requirement.requiredCapabilities.map((item) => item.toLowerCase()));
  const selected: SkillManifest[] = [];
  const covered = new Set<string>();

  const ranked = [...eligible].sort((a, b) => {
    const preferredA = input.requirement.preferredSkills.includes(a.skillId) ? 1 : 0;
    const preferredB = input.requirement.preferredSkills.includes(b.skillId) ? 1 : 0;
    if (preferredA !== preferredB) return preferredB - preferredA;

    const coverA = a.capabilities.filter((item) => needed.has(item.toLowerCase())).length;
    const coverB = b.capabilities.filter((item) => needed.has(item.toLowerCase())).length;
    if (coverA !== coverB) return coverB - coverA;

    return a.skillId.localeCompare(b.skillId);
  });

  for (const skill of ranked) {
    const contributes = skill.capabilities.some((capability) => {
      const key = capability.toLowerCase();
      return needed.has(key) && !covered.has(key);
    });
    if (!contributes && !input.requirement.preferredSkills.includes(skill.skillId)) continue;

    selected.push(skill);
    for (const capability of skill.capabilities) {
      if (needed.has(capability.toLowerCase())) covered.add(capability.toLowerCase());
    }
    if ([...needed].every((item) => covered.has(item))) break;
  }

  const uncovered = [...needed].filter((item) => !covered.has(item));

  return {
    bindingId: `SKILLBIND-${randomUUID().slice(0, 10).toUpperCase()}`,
    taskId: input.requirement.taskId,
    modelId: input.model.modelId,
    skillIds: selected.map((item) => item.skillId),
    coveredCapabilities: [...covered],
    uncoveredCapabilities: uncovered,
    rationale: [
      "skills selected for the assigned task",
      "skill compatibility checked against the chosen model",
      "skills cannot expand officially supported model capabilities",
      uncovered.length ? "capability gap remains and requires another model/role/recruitment" : "required capability coverage achieved"
    ]
  };
}
