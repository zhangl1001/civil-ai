import type { CompiledPrompt, PromptBundle, PromptVariables } from './PromptContracts';
import { PromptRegistry } from './PromptRegistry';

export class PromptCompiler {
  constructor(private readonly registry: PromptRegistry) {}

  compile(
    promptCode: string,
    variables: PromptVariables,
    userPayload: unknown,
    version?: string
  ): CompiledPrompt {
    return this.compileBundle(this.registry.resolve(promptCode, version), variables, userPayload);
  }

  /**
   * Compiles a prompt the caller already resolved. Durable work pins a prompt
   * version when it is created and must keep using exactly that wording — going
   * back through the registry would re-resolve against whatever pack is active
   * now, and against in-memory content that may differ from what was stored.
   */
  compileBundle(bundle: PromptBundle, variables: PromptVariables, userPayload: unknown): CompiledPrompt {
    assertVariables(bundle, variables);
    const system = bundle.sections
      .slice()
      .sort((left, right) => left.order - right.order)
      .map((section, index) => [
        `# 第${index + 1}章 ${section.title}`,
        interpolate(section.template, variables)
      ].join('\n\n'))
      .join('\n\n');
    return {
      promptCode: bundle.promptCode,
      version: bundle.version,
      contentHash: bundle.contentHash,
      system,
      user: `# 本次生成规格\n\n${JSON.stringify(userPayload, null, 2)}`,
      responseSchema: bundle.responseSchema
    };
  }
}

function assertVariables(bundle: PromptBundle, variables: PromptVariables): void {
  const missing = bundle.requiredVariables.filter((name) => variables[name] === undefined);
  if (missing.length) throw new Error(`Prompt ${bundle.promptCode} is missing variables: ${missing.join(', ')}`);
}

function interpolate(template: string, variables: PromptVariables): string {
  return template.replace(/\{\{([A-Z][A-Z0-9_]*)\}\}/g, (_match, name: string) => {
    const value = variables[name];
    if (value === undefined) throw new Error(`Prompt template variable ${name} is not declared`);
    return String(value);
  });
}
