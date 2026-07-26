export const AgentDelegationMode = {
  AsTool: 'as_tool',
  Handoff: 'handoff'
} as const;

export type AgentDelegationMode = typeof AgentDelegationMode[keyof typeof AgentDelegationMode];

export interface SubAgentDefinition {
  readonly code: string;
  readonly description: string;
  readonly instructionRef: string;
  readonly skillCodes: readonly string[];
  readonly toolCodes: readonly string[];
  readonly delegationMode: AgentDelegationMode;
  readonly maxTurns: number;
  readonly maxToolCalls: number;
}

/** Registry contains metadata only; sub-agents reuse the same runtime and ProviderGateway. */
export class SubAgentRegistry {
  private readonly definitions = new Map<string, SubAgentDefinition>();

  register(definition: SubAgentDefinition): void {
    if (!/^[a-z][a-z0-9_.-]{2,63}$/.test(definition.code)) throw new Error(`Invalid sub-agent code: ${definition.code}`);
    if (!definition.description.trim() || !definition.instructionRef.trim()) throw new Error(`Invalid sub-agent definition: ${definition.code}`);
    if (!Number.isInteger(definition.maxTurns) || definition.maxTurns < 1 || definition.maxTurns > 8) throw new Error(`Invalid sub-agent turn budget: ${definition.code}`);
    if (!Number.isInteger(definition.maxToolCalls) || definition.maxToolCalls < 0 || definition.maxToolCalls > 12) throw new Error(`Invalid sub-agent tool budget: ${definition.code}`);
    if (this.definitions.has(definition.code)) throw new Error(`Duplicate sub-agent: ${definition.code}`);
    this.definitions.set(definition.code, Object.freeze({
      ...definition,
      skillCodes: Object.freeze([...definition.skillCodes]),
      toolCodes: Object.freeze([...definition.toolCodes])
    }));
  }

  get(code: string): SubAgentDefinition {
    const definition = this.definitions.get(code);
    if (!definition) throw new Error(`Unknown sub-agent: ${code}`);
    return definition;
  }

  list(): readonly SubAgentDefinition[] {
    return [...this.definitions.values()];
  }
}
