import type { AgentSkillDefinition, AgentToolDefinition, AgentToolRegistry } from './AgentToolRegistry';

export interface ToolExposurePlan {
  readonly skillCodes: readonly string[];
  readonly skills: readonly AgentSkillDefinition[];
  readonly tools: readonly AgentToolDefinition[];
  readonly contextBudgetTokens: number;
}

export interface ToolExposureLimits {
  readonly maxSkills?: number;
  readonly maxTools?: number;
  readonly maxContextBudgetTokens?: number;
}

export class ToolExposurePlanner {
  constructor(private readonly registry: AgentToolRegistry) {}

  plan(
    skillCodes: readonly string[],
    audience: string,
    limits: ToolExposureLimits = {}
  ): ToolExposurePlan {
    const maxSkills = boundedInteger(limits.maxSkills, 2, 1, 4);
    const maxTools = boundedInteger(limits.maxTools, 8, 0, 16);
    const maxContextBudgetTokens = boundedInteger(limits.maxContextBudgetTokens, 2_400, 128, 8_192);
    const selectedCodes = [...new Set(skillCodes)].slice(0, maxSkills);
    if (!selectedCodes.length) {
      return { skillCodes: [], skills: [], tools: [], contextBudgetTokens: 0 };
    }
    const resolved = this.registry.resolve(selectedCodes, audience);
    return {
      skillCodes: selectedCodes,
      skills: resolved.skills,
      tools: resolved.tools.slice(0, maxTools),
      contextBudgetTokens: Math.min(
        maxContextBudgetTokens,
        resolved.skills.reduce((total, skill) => total + skill.contextBudgetTokens, 0)
      )
    };
  }
}

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  const next = value ?? fallback;
  if (!Number.isInteger(next) || next < min || next > max) {
    throw new Error(`Agent exposure limit must be an integer between ${min} and ${max}`);
  }
  return next;
}
