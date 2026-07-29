import type { JsonObject } from '@/kernel/public';

export const AgentToolRisk = { Read: 'read', Write: 'write', Destructive: 'destructive' } as const;
export type AgentToolRisk = typeof AgentToolRisk[keyof typeof AgentToolRisk];

export const AgentToolRole = {
  Operational: 'operational',
  SkillSelector: 'skill_selector',
  CompletionVerifier: 'completion_verifier'
} as const;
export type AgentToolRole = typeof AgentToolRole[keyof typeof AgentToolRole];

/** Provider-visible Tool manifest. Implementations and business policies stay outside this registry. */
export interface AgentToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonObject;
  readonly risk: AgentToolRisk;
  readonly role?: AgentToolRole;
  readonly requiresConfirmation: boolean;
  readonly enabledFor: readonly string[];
}

/** Registers immutable Tool manifests without owning executors. */
export class AgentToolRegistry {
  private readonly tools = new Map<string, AgentToolDefinition>();

  register(tool: AgentToolDefinition): void {
    assertName(tool.name, 'Tool');
    const description = tool.description.trim();
    if (!description || description.length > 320 || !tool.enabledFor.length) {
      throw new Error(`Invalid agent tool: ${tool.name}`);
    }
    if (tool.role && !Object.values(AgentToolRole).includes(tool.role)) {
      throw new Error(`Invalid agent tool role: ${tool.name}`);
    }
    if (this.tools.has(tool.name)) throw new Error(`Duplicate agent tool: ${tool.name}`);
    this.tools.set(tool.name, freezeTool(tool));
  }

  registerAll(tools: readonly AgentToolDefinition[]): void {
    const next = new AgentToolRegistry();
    this.list().forEach((tool) => next.register(tool));
    tools.forEach((tool) => next.register(tool));
    this.tools.clear();
    next.list().forEach((tool) => this.tools.set(tool.name, tool));
  }

  get(name: string): AgentToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(): readonly AgentToolDefinition[] {
    return [...this.tools.values()];
  }

  resolve(names: readonly string[], audience: string): readonly AgentToolDefinition[] {
    return [...new Set(names)]
      .map((name) => this.tools.get(name) ?? fail(`Unknown agent tool: ${name}`))
      .filter((tool) => tool.enabledFor.includes(audience));
  }
}

export function assertAgentManifestName(value: string, label: string): void {
  if (!/^[a-z][a-z0-9_.-]{2,63}$/.test(value)) throw new Error(`${label} name is invalid: ${value}`);
}

function assertName(value: string, label: string): void {
  assertAgentManifestName(value, label);
}

function freezeTool(tool: AgentToolDefinition): AgentToolDefinition {
  return Object.freeze({
    ...tool,
    inputSchema: cloneAndFreezeJson(tool.inputSchema),
    enabledFor: Object.freeze([...tool.enabledFor])
  });
}

function cloneAndFreezeJson<T>(value: T): T {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry) => cloneAndFreezeJson(entry))) as T;
  }
  if (!value || typeof value !== 'object') return value;
  const clone = Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, cloneAndFreezeJson(entry)])
  );
  return Object.freeze(clone) as T;
}

function fail(message: string): never {
  throw new Error(message);
}
