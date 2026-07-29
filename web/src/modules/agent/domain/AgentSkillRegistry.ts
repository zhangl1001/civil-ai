import { assertAgentManifestName, type AgentToolDefinition, type AgentToolRegistry } from './AgentToolRegistry';
import {
  isAgentExecutionBudgetTier,
  type AgentExecutionBudgetTier
} from './AgentExecutionBudget';

export interface AgentWorkflowStep {
  readonly name: string;
  readonly description: string;
}

export interface AgentSkillWorkflow {
  readonly name: string;
  readonly description: string;
  readonly steps: readonly AgentWorkflowStep[];
  readonly completionCriteria: readonly string[];
  readonly failureRecovery: readonly string[];
}

export interface AgentPromptChapter {
  readonly name: string;
  readonly title: string;
  readonly content: string;
}

export interface AgentSkillResource {
  readonly name: string;
  readonly description: string;
  readonly content: string;
}

export interface AgentSkillValidator {
  readonly name: string;
  readonly description: string;
}

/** Claude-style discoverable Skill manifest plus the content loaded only after activation. */
export interface AgentSkillManifest {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly dependencies: readonly string[];
  readonly conflicts: readonly string[];
  readonly workflow: AgentSkillWorkflow;
  readonly promptChapters: readonly AgentPromptChapter[];
  readonly resources: readonly AgentSkillResource[];
  readonly allowedTools: readonly string[];
  readonly validators: readonly AgentSkillValidator[];
  readonly contextBudgetTokens: number;
  readonly executionBudget: AgentExecutionBudgetTier;
}

/** Immutable runtime payload. Only activated Skills enter the model context. */
export interface AgentSkillActivation {
  readonly name: string;
  readonly version: string;
  readonly instructions: string;
  readonly allowedTools: readonly string[];
  readonly validatorNames: readonly string[];
  readonly requiresOperationalTool: boolean;
  readonly executionBudget: AgentExecutionBudgetTier;
}

export interface AgentSkillBundle {
  readonly skillNames: readonly string[];
  readonly skills: readonly AgentSkillManifest[];
  readonly tools: readonly AgentToolDefinition[];
  readonly activations: readonly AgentSkillActivation[];
  readonly contextBudgetTokens: number;
}

export interface AgentSkillBundleLimits {
  readonly maxSkills?: number;
  readonly maxTools?: number;
  readonly maxContextBudgetTokens?: number;
}

export class AgentSkillRegistry {
  private readonly skills = new Map<string, AgentSkillManifest>();

  constructor(private readonly tools: AgentToolRegistry) {}

  register(skill: AgentSkillManifest): void {
    if (this.skills.has(skill.name)) throw new Error(`Duplicate agent skill: ${skill.name}`);
    validateSkill(skill, this.tools, this.skills);
    this.skills.set(skill.name, freezeSkill(skill));
  }

  registerAll(skills: readonly AgentSkillManifest[]): void {
    const staged = new Map(this.skills);
    skills.forEach((skill) => {
      if (staged.has(skill.name)) throw new Error(`Duplicate agent skill: ${skill.name}`);
      staged.set(skill.name, freezeSkill(skill));
    });
    skills.forEach((skill) => validateSkill(skill, this.tools, staged));
    this.skills.clear();
    staged.forEach((skill, name) => this.skills.set(name, skill));
  }

  get(name: string): AgentSkillManifest | undefined {
    return this.skills.get(name);
  }

  list(): readonly AgentSkillManifest[] {
    return [...this.skills.values()];
  }

  resolve(names: readonly string[]): readonly AgentSkillManifest[] {
    const resolved = new Map<string, AgentSkillManifest>();
    const visiting = new Set<string>();
    const visit = (name: string) => {
      if (resolved.has(name)) return;
      if (visiting.has(name)) throw new Error(`Agent skill dependency cycle: ${name}`);
      const skill = this.skills.get(name) ?? fail(`Unknown agent skill: ${name}`);
      visiting.add(name);
      skill.dependencies.forEach(visit);
      visiting.delete(name);
      resolved.set(name, skill);
    };
    [...new Set(names)].forEach(visit);
    const selected = [...resolved.values()];
    const selectedNames = new Set(selected.map((skill) => skill.name));
    selected.forEach((skill) => {
      const conflict = skill.conflicts.find((name) => selectedNames.has(name));
      if (conflict) throw new Error(`Agent skills conflict: ${skill.name} -> ${conflict}`);
    });
    return selected;
  }
}

/** Compiles the selected Skill workflows and minimum Tool schemas for one Agent run. */
export class AgentSkillBundleCompiler {
  constructor(
    private readonly skills: AgentSkillRegistry,
    private readonly tools: AgentToolRegistry
  ) {}

  compile(
    skillNames: readonly string[],
    audience: string,
    limits: AgentSkillBundleLimits = {}
  ): AgentSkillBundle {
    const maxSkills = boundedInteger(limits.maxSkills, 2, 1, 4);
    const maxTools = boundedInteger(limits.maxTools, 8, 0, 16);
    const maxContextBudgetTokens = boundedInteger(limits.maxContextBudgetTokens, 2_400, 128, 8_192);
    const requested = [...new Set(skillNames)].slice(0, maxSkills);
    if (!requested.length) {
      return { skillNames: [], skills: [], tools: [], activations: [], contextBudgetTokens: 0 };
    }
    const skills = this.skills.resolve(requested);
    const toolNames = [...new Set(skills.flatMap((skill) => skill.allowedTools))];
    if (toolNames.length > maxTools) {
      throw new Error(`Agent skill bundle exceeds tool limit: ${toolNames.length}/${maxTools}`);
    }
    const tools = this.tools.resolve(toolNames, audience);
    if (tools.length !== toolNames.length) {
      throw new Error('Agent skill bundle contains tools unavailable to the current audience');
    }
    const contextBudgetTokens = skills.reduce((total, skill) => total + skill.contextBudgetTokens, 0);
    if (contextBudgetTokens > maxContextBudgetTokens) {
      throw new Error(`Agent skill bundle exceeds context budget: ${contextBudgetTokens}/${maxContextBudgetTokens}`);
    }
    return {
      skillNames: skills.map((skill) => skill.name),
      skills,
      tools,
      activations: skills.map(compileActivation),
      contextBudgetTokens
    };
  }
}

function compileActivation(skill: AgentSkillManifest): AgentSkillActivation {
  const workflow = skill.workflow;
  const sections = [
    `# Skill: ${skill.name}@${skill.version}`,
    skill.description,
    '以下工作流是专业建议，不是不可变脚本。应根据用户目标和工具结果调整顺序、跳过无关步骤或补充必要步骤。',
    `## Recommended workflow: ${workflow.name}`,
    workflow.description,
    ...workflow.steps.map((step, index) => `${index + 1}. ${step.name}：${step.description}`),
    '## Completion checks',
    ...workflow.completionCriteria.map((item) => `- ${item}`),
    '## Suggested recovery',
    ...workflow.failureRecovery.map((item) => `- ${item}`)
  ];
  skill.promptChapters.forEach((chapter) => sections.push(`## ${chapter.title}`, chapter.content));
  if (skill.resources.length) {
    sections.push('## Resources');
    skill.resources.forEach((resource) => sections.push(`### ${resource.name}`, resource.description, resource.content));
  }
  if (skill.validators.length) {
    sections.push('## Validators', ...skill.validators.map((validator) => `- ${validator.name}：${validator.description}`));
  }
  return Object.freeze({
    name: skill.name,
    version: skill.version,
    instructions: sections.join('\n\n'),
    allowedTools: Object.freeze([...skill.allowedTools]),
    validatorNames: Object.freeze(skill.validators.map((validator) => validator.name)),
    requiresOperationalTool: skill.allowedTools.length > 0,
    executionBudget: skill.executionBudget
  });
}

function validateSkill(
  skill: AgentSkillManifest,
  tools: AgentToolRegistry,
  knownSkills: ReadonlyMap<string, AgentSkillManifest>
): void {
  assertAgentManifestName(skill.name, 'Skill');
  if (!/^\d+\.\d+\.\d+$/.test(skill.version)) throw new Error(`Invalid agent skill version: ${skill.name}`);
  if (!skill.description.trim() || skill.description.length > 320) throw new Error(`Invalid agent skill: ${skill.name}`);
  if (!Number.isInteger(skill.contextBudgetTokens) || skill.contextBudgetTokens < 64 || skill.contextBudgetTokens > 8_192) {
    throw new Error(`Invalid agent skill budget: ${skill.name}`);
  }
  if (!isAgentExecutionBudgetTier(skill.executionBudget)) {
    throw new Error(`Invalid agent execution budget: ${skill.name}`);
  }
  if (!skill.workflow.steps.length || !skill.workflow.completionCriteria.length) {
    throw new Error(`Agent skill requires workflow and completion criteria: ${skill.name}`);
  }
  if (!skill.workflow.name.trim() || !skill.workflow.description.trim()) {
    throw new Error(`Agent skill workflow is invalid: ${skill.name}`);
  }
  skill.workflow.steps.forEach((step) => assertNamedContent(step.name, step.description, `workflow step in ${skill.name}`));
  skill.promptChapters.forEach((chapter) => assertNamedContent(chapter.name, chapter.content, `prompt chapter in ${skill.name}`));
  skill.resources.forEach((resource) => assertNamedContent(resource.name, resource.content, `resource in ${skill.name}`));
  skill.validators.forEach((validator) => assertNamedContent(validator.name, validator.description, `validator in ${skill.name}`));
  assertUnique(skill.allowedTools, `Agent skill contains duplicate tools: ${skill.name}`);
  assertUnique(skill.dependencies, `Agent skill contains duplicate dependencies: ${skill.name}`);
  assertUnique(skill.conflicts, `Agent skill contains duplicate conflicts: ${skill.name}`);
  skill.allowedTools.forEach((name) => {
    if (!tools.get(name)) throw new Error(`Agent skill references unknown tool: ${skill.name} -> ${name}`);
  });
  skill.dependencies.forEach((name) => {
    if (name === skill.name || !knownSkills.has(name)) throw new Error(`Agent skill dependency is unavailable: ${skill.name} -> ${name}`);
  });
  skill.conflicts.forEach((name) => {
    if (name === skill.name || !knownSkills.has(name)) throw new Error(`Agent skill conflict is unavailable: ${skill.name} -> ${name}`);
  });
}

function assertNamedContent(name: string, content: string, label: string): void {
  if (!name.trim() || !content.trim()) throw new Error(`Agent ${label} has empty content`);
}

function assertUnique(values: readonly string[], message: string): void {
  if (new Set(values).size !== values.length) throw new Error(message);
}

function freezeSkill(skill: AgentSkillManifest): AgentSkillManifest {
  return Object.freeze({
    ...skill,
    dependencies: Object.freeze([...skill.dependencies]),
    conflicts: Object.freeze([...skill.conflicts]),
    allowedTools: Object.freeze([...skill.allowedTools]),
    workflow: Object.freeze({
      ...skill.workflow,
      steps: Object.freeze(skill.workflow.steps.map((step) => Object.freeze({ ...step }))),
      completionCriteria: Object.freeze([...skill.workflow.completionCriteria]),
      failureRecovery: Object.freeze([...skill.workflow.failureRecovery])
    }),
    promptChapters: Object.freeze(skill.promptChapters.map((chapter) => Object.freeze({ ...chapter }))),
    resources: Object.freeze(skill.resources.map((resource) => Object.freeze({ ...resource }))),
    validators: Object.freeze(skill.validators.map((validator) => Object.freeze({ ...validator })))
  });
}

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  const next = value ?? fallback;
  if (!Number.isInteger(next) || next < min || next > max) {
    throw new Error(`Agent Skill bundle limit must be an integer between ${min} and ${max}`);
  }
  return next;
}

function fail(message: string): never {
  throw new Error(message);
}
