const DEEPSEEK_ANTHROPIC_HOST = 'api.deepseek.com';
const DEEPSEEK_FLASH_MODEL = 'deepseek-v4-flash';
const DEEPSEEK_MODEL_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  'deepseek-v4-falsh': DEEPSEEK_FLASH_MODEL
});

export function normalizeAnthropicModelName(baseUrl: string, model: string): string {
  const normalized = model.trim();
  if (!isDeepSeekAnthropicBaseUrl(baseUrl)) return normalized;
  return DEEPSEEK_MODEL_ALIASES[normalized.toLowerCase()] ?? normalized;
}

export function anthropicMessagesEndpoint(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '');
  if (normalized.endsWith('/messages')) return normalized;
  // DeepSeek's Anthropic-compatible endpoint is /anthropic/messages,
  // unlike the native Anthropic /v1/messages endpoint.
  if (isDeepSeekAnthropicBaseUrl(normalized) && normalized.endsWith('/anthropic')) {
    return `${normalized}/messages`;
  }
  if (normalized.endsWith('/v1')) return `${normalized}/messages`;
  return `${normalized}/v1/messages`;
}

export function requiresDisabledThinkingForForcedTools(baseUrl: string): boolean {
  return isDeepSeekAnthropicBaseUrl(baseUrl);
}

export function anthropicInputSchema(baseUrl: string, schema: object): object {
  if (!isDeepSeekAnthropicBaseUrl(baseUrl)) return schema;
  const root = asRecord(schema);
  const definitions = asRecord(root?.$defs);
  const properties = asRecord(root?.properties);
  if (!root || !definitions || !properties) return schema;
  const inlined = Object.fromEntries(Object.entries(properties).map(([key, value]) => {
    const property = asRecord(value);
    const reference = typeof property?.$ref === 'string' ? property.$ref : '';
    const match = reference.match(/^#\/\$defs\/([^/]+)$/);
    const definition = match ? asRecord(definitions[match[1]]) : undefined;
    return [key, definition ? { ...definition } : value];
  }));
  return { ...root, properties: inlined };
}

function isDeepSeekAnthropicBaseUrl(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname.toLowerCase() === DEEPSEEK_ANTHROPIC_HOST;
  } catch {
    return baseUrl.toLowerCase().includes(DEEPSEEK_ANTHROPIC_HOST);
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
