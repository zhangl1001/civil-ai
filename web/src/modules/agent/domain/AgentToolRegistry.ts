import type { JsonObject } from '@/kernel/public';

export const AgentToolRisk = { Read: 'read', Write: 'write', Destructive: 'destructive' } as const;
export type AgentToolRisk = typeof AgentToolRisk[keyof typeof AgentToolRisk];

export interface AgentToolDefinition {
  readonly code: string;
  readonly description: string;
  readonly inputSchema: JsonObject;
  readonly risk: AgentToolRisk;
  readonly requiresConfirmation: boolean;
  readonly enabledFor: readonly string[];
}

export interface AgentSkillDefinition {
  readonly code: string;
  readonly description: string;
  readonly toolCodes: readonly string[];
  readonly contextBudgetTokens: number;
}

export interface AgentCapabilityBundle {
  readonly tools: readonly AgentToolDefinition[];
  readonly skills: readonly AgentSkillDefinition[];
}

/** Static registry. It exposes tool metadata to a model but never an executor or prompt body. */
export class AgentToolRegistry {
  private readonly tools = new Map<string, AgentToolDefinition>();
  private readonly skills = new Map<string, AgentSkillDefinition>();

  registerTool(tool: AgentToolDefinition): void {
    registerTool(this.tools, tool);
  }

  registerSkill(skill: AgentSkillDefinition): void {
    registerSkill(this.tools, this.skills, skill);
  }

  registerBundle(bundle: AgentCapabilityBundle): void {
    const nextTools = new Map(this.tools);
    const nextSkills = new Map(this.skills);
    bundle.tools.forEach((tool) => registerTool(nextTools, tool));
    bundle.skills.forEach((skill) => registerSkill(nextTools, nextSkills, skill));
    this.tools.clear();
    nextTools.forEach((tool, code) => this.tools.set(code, tool));
    this.skills.clear();
    nextSkills.forEach((skill, code) => this.skills.set(code, skill));
  }

  listTools(): readonly AgentToolDefinition[] {
    return [...this.tools.values()];
  }

  listSkills(): readonly AgentSkillDefinition[] {
    return [...this.skills.values()];
  }

  skillCodesForTool(toolCode: string): readonly string[] {
    return [...this.skills.values()]
      .filter((skill) => skill.toolCodes.includes(toolCode))
      .map((skill) => skill.code);
  }

  resolve(skillCodes: readonly string[], audience: string): { readonly skills: readonly AgentSkillDefinition[]; readonly tools: readonly AgentToolDefinition[] } {
    const skills = skillCodes.map((code) => this.skills.get(code) ?? fail(`Unknown agent skill: ${code}`));
    const allowedCodes = new Set(skills.flatMap((skill) => skill.toolCodes));
    const tools = [...allowedCodes].map((code) => this.tools.get(code)!).filter((tool) => tool.enabledFor.includes(audience));
    return { skills, tools };
  }
}

function registerTool(
  tools: Map<string, AgentToolDefinition>,
  tool: AgentToolDefinition
): void {
  assertCode(tool.code, 'Tool');
  if (!tool.description.trim() || !tool.enabledFor.length) throw new Error(`Invalid agent tool: ${tool.code}`);
  if (tools.has(tool.code)) throw new Error(`Duplicate agent tool: ${tool.code}`);
  tools.set(tool.code, freezeTool(tool));
}

function registerSkill(
  tools: ReadonlyMap<string, AgentToolDefinition>,
  skills: Map<string, AgentSkillDefinition>,
  skill: AgentSkillDefinition
): void {
  assertCode(skill.code, 'Skill');
  if (!skill.description.trim() || !Number.isInteger(skill.contextBudgetTokens) || skill.contextBudgetTokens < 64 || skill.contextBudgetTokens > 8_192) {
    throw new Error(`Invalid agent skill: ${skill.code}`);
  }
  if (skill.toolCodes.some((code) => !tools.has(code))) throw new Error(`Agent skill references unknown tool: ${skill.code}`);
  if (skills.has(skill.code)) throw new Error(`Duplicate agent skill: ${skill.code}`);
  skills.set(skill.code, Object.freeze({ ...skill, toolCodes: Object.freeze([...skill.toolCodes]) }));
}

function assertCode(value: string, label: string): void {
  if (!/^[a-z][a-z0-9_.-]{2,63}$/.test(value)) throw new Error(`${label} code is invalid: ${value}`);
}
function freezeTool(tool: AgentToolDefinition): AgentToolDefinition { return Object.freeze({ ...tool, enabledFor: Object.freeze([...tool.enabledFor]) }); }
function fail(message: string): never { throw new Error(message); }
