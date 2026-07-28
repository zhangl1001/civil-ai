export interface AgentSkillRoutingInput {
  readonly text: string;
}

export interface AgentSkillRoutingRule {
  readonly skillCode: string;
  readonly priority: number;
  matches(input: AgentSkillRoutingInput): boolean;
}

export class AgentSkillRouter {
  constructor(
    private readonly rules: readonly AgentSkillRoutingRule[],
    private readonly maxSkills = 2
  ) {
    if (!Number.isInteger(maxSkills) || maxSkills < 1 || maxSkills > 4) {
      throw new Error('Agent skill routing limit must be between 1 and 4');
    }
  }

  route(input: AgentSkillRoutingInput): readonly string[] {
    const selected = this.rules
      .map((rule, index) => ({ rule, index }))
      .filter(({ rule }) => rule.matches(input))
      .sort((left, right) => right.rule.priority - left.rule.priority || left.index - right.index);
    return [...new Set(selected.map(({ rule }) => rule.skillCode))].slice(0, this.maxSkills);
  }
}
