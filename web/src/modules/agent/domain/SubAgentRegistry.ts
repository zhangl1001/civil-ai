export const AgentDelegationMode = {
  AsTool: 'as_tool',
  Handoff: 'handoff'
} as const;

export type AgentDelegationMode = typeof AgentDelegationMode[keyof typeof AgentDelegationMode];

export interface SubAgentDefinition {
  readonly name: string;
  readonly description: string;
  readonly instructionRef: string;
  readonly allowedSkills: readonly string[];
  readonly allowedTools: readonly string[];
  readonly delegationMode: AgentDelegationMode;
  readonly maxTurns: number;
  readonly maxToolCalls: number;
}

/** Registry contains metadata only; sub-agents reuse the same runtime and ProviderGateway. */
export class SubAgentRegistry {
  private readonly definitions = new Map<string, SubAgentDefinition>();

  register(definition: SubAgentDefinition): void {
    if (!/^[a-z][a-z0-9_.-]{2,63}$/.test(definition.name)) throw new Error(`Invalid sub-agent name: ${definition.name}`);
    if (!definition.description.trim() || definition.description.length > 320 || !definition.instructionRef.trim()) {
      throw new Error(`Invalid sub-agent definition: ${definition.name}`);
    }
    if (!Number.isInteger(definition.maxTurns) || definition.maxTurns < 1 || definition.maxTurns > 8) throw new Error(`Invalid sub-agent turn budget: ${definition.name}`);
    if (!Number.isInteger(definition.maxToolCalls) || definition.maxToolCalls < 0 || definition.maxToolCalls > 12) throw new Error(`Invalid sub-agent tool budget: ${definition.name}`);
    if (this.definitions.has(definition.name)) throw new Error(`Duplicate sub-agent: ${definition.name}`);
    this.definitions.set(definition.name, Object.freeze({
      ...definition,
      allowedSkills: Object.freeze([...definition.allowedSkills]),
      allowedTools: Object.freeze([...definition.allowedTools])
    }));
  }

  get(name: string): SubAgentDefinition {
    const definition = this.definitions.get(name);
    if (!definition) throw new Error(`Unknown sub-agent: ${name}`);
    return definition;
  }

  list(): readonly SubAgentDefinition[] {
    return [...this.definitions.values()];
  }
}
