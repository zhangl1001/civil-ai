import type { ProviderToolDefinition } from '@/capabilities/ai-runtime/public';
import type { AgentToolDefinition } from '../domain/AgentToolRegistry';

/** Keeps the provider-visible tool surface small and activates schemas on demand. */
export class ActiveAgentToolSet {
  private readonly available = new Map<string, AgentToolDefinition>();
  private readonly definitions = new Map<string, AgentToolDefinition>();
  private readonly byProviderName = new Map<string, AgentToolDefinition>();

  constructor(initial: readonly AgentToolDefinition[], available: readonly AgentToolDefinition[] = initial) {
    available.forEach((definition) => this.available.set(definition.name, definition));
    initial.forEach((definition) => this.register(definition));
  }

  get providerTools(): readonly ProviderToolDefinition[] {
    return [...this.definitions.values()].map(toProviderTool);
  }

  get names(): Iterable<string> {
    return this.definitions.keys();
  }

  byName(name: string): AgentToolDefinition | undefined {
    return this.definitions.get(name);
  }

  byProvider(name: string): AgentToolDefinition | undefined {
    return this.byProviderName.get(name);
  }

  activate(toolNames: readonly string[]): void {
    toolNames.forEach((name) => {
      const definition = this.available.get(name);
      if (!definition) throw new Error(`Agent requested unavailable tool activation: ${name}`);
      if (!this.definitions.has(name)) this.register(definition);
    });
  }

  private register(definition: AgentToolDefinition): void {
    const providerName = providerToolName(definition.name);
    const existing = this.byProviderName.get(providerName);
    if (existing && existing.name !== definition.name) {
      throw new Error(`Agent tools map to the same provider name: ${providerName}`);
    }
    this.definitions.set(definition.name, definition);
    this.byProviderName.set(providerName, definition);
  }
}

export function toProviderTool(tool: AgentToolDefinition): ProviderToolDefinition {
  return { name: providerToolName(tool.name), description: tool.description, inputSchema: tool.inputSchema };
}

export function providerToolName(name: string): string {
  const normalized = name.trim().replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  if (!normalized || !/^[a-zA-Z0-9_-]+$/.test(normalized)) {
    throw new Error(`Agent tool name cannot be mapped to a provider function name: ${name}`);
  }
  return normalized;
}
