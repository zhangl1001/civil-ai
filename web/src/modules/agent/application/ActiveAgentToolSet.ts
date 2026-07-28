import type { ProviderToolDefinition } from '@/capabilities/ai-runtime/public';
import type { AgentToolDefinition } from '../domain/AgentToolRegistry';

/** Keeps the provider-visible tool surface small and activates schemas on demand. */
export class ActiveAgentToolSet {
  private readonly available = new Map<string, AgentToolDefinition>();
  private readonly definitions = new Map<string, AgentToolDefinition>();
  private readonly byProviderName = new Map<string, AgentToolDefinition>();

  constructor(initial: readonly AgentToolDefinition[], available: readonly AgentToolDefinition[] = initial) {
    available.forEach((definition) => this.available.set(definition.code, definition));
    initial.forEach((definition) => this.register(definition));
  }

  get providerTools(): readonly ProviderToolDefinition[] {
    return [...this.definitions.values()].map(toProviderTool);
  }

  get codes(): Iterable<string> {
    return this.definitions.keys();
  }

  byCode(code: string): AgentToolDefinition | undefined {
    return this.definitions.get(code);
  }

  byProvider(name: string): AgentToolDefinition | undefined {
    return this.byProviderName.get(name);
  }

  activate(toolCodes: readonly string[]): void {
    toolCodes.forEach((code) => {
      const definition = this.available.get(code);
      if (!definition) throw new Error(`Agent requested unavailable tool activation: ${code}`);
      if (!this.definitions.has(code)) this.register(definition);
    });
  }

  private register(definition: AgentToolDefinition): void {
    const providerName = providerToolName(definition.code);
    const existing = this.byProviderName.get(providerName);
    if (existing && existing.code !== definition.code) {
      throw new Error(`Agent tools map to the same provider name: ${providerName}`);
    }
    this.definitions.set(definition.code, definition);
    this.byProviderName.set(providerName, definition);
  }
}

export function toProviderTool(tool: AgentToolDefinition): ProviderToolDefinition {
  return { name: providerToolName(tool.code), description: tool.description, inputSchema: tool.inputSchema };
}

export function providerToolName(code: string): string {
  const normalized = code.trim().replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  if (!normalized || !/^[a-zA-Z0-9_-]+$/.test(normalized)) {
    throw new Error(`Agent tool code cannot be mapped to a provider function name: ${code}`);
  }
  return normalized;
}
