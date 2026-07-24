import type { ProviderResponse } from '../contracts/ProviderGateway';

export function parseOpenAIResponse(input: unknown): ProviderResponse {
  const root = asRecord(input, 'OpenAI response');
  const choices = Array.isArray(root.choices) ? root.choices : [];
  const choice = choices[0] ? asRecord(choices[0], 'OpenAI response choice') : undefined;
  const message = choice?.message ? asRecord(choice.message, 'OpenAI response message') : undefined;
  const text = readTextContent(message?.content) || readOptionalString(root.output_text) || readOptionalString(choice?.text);
  const usage = root.usage ? asRecord(root.usage, 'OpenAI response usage') : undefined;
  return {
    text,
    finishReason: readOptionalString(choice?.finish_reason),
    providerRequestId: readOptionalString(root.id),
    usage: {
      inputTokens: readOptionalNumber(usage?.prompt_tokens ?? usage?.input_tokens),
      outputTokens: readOptionalNumber(usage?.completion_tokens ?? usage?.output_tokens)
    }
  };
}

export function parseAnthropicResponse(input: unknown): ProviderResponse {
  const root = asRecord(input, 'Anthropic response');
  const usage = root.usage ? asRecord(root.usage, 'Anthropic response usage') : undefined;
  return {
    text: readTextContent(root.content),
    finishReason: readOptionalString(root.stop_reason),
    providerRequestId: readOptionalString(root.id),
    usage: {
      inputTokens: readOptionalNumber(usage?.input_tokens),
      outputTokens: readOptionalNumber(usage?.output_tokens)
    }
  };
}

export function openAITextDelta(input: unknown): string {
  const root = asRecord(input, 'OpenAI stream event');
  const choices = Array.isArray(root.choices) ? root.choices : [];
  if (!choices[0]) return '';
  const choice = asRecord(choices[0], 'OpenAI stream choice');
  const delta = choice.delta ? asRecord(choice.delta, 'OpenAI stream delta') : undefined;
  return readTextContent(delta?.content);
}

export function anthropicTextDelta(input: unknown): string {
  const root = asRecord(input, 'Anthropic stream event');
  if (root.type !== 'content_block_delta') return '';
  const delta = root.delta ? asRecord(root.delta, 'Anthropic stream delta') : undefined;
  return delta?.type === 'text_delta' ? readOptionalString(delta.text) : '';
}

function readTextContent(input: unknown): string {
  if (typeof input === 'string') return input;
  if (!Array.isArray(input)) return '';
  return input.map((item) => {
    if (typeof item === 'string') return item;
    if (!item || typeof item !== 'object' || Array.isArray(item)) return '';
    return readOptionalString((item as Record<string, unknown>).text);
  }).join('');
}

function asRecord(input: unknown, label: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError(`${label} must be an object`);
  return input as Record<string, unknown>;
}

function readOptionalString(input: unknown): string {
  return typeof input === 'string' ? input : '';
}

function readOptionalNumber(input: unknown): number | undefined {
  return typeof input === 'number' && Number.isFinite(input) && input >= 0 ? input : undefined;
}
