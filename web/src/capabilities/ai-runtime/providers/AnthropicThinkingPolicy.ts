import { isDeepSeekAnthropicBaseUrl } from './AnthropicCompatibility';

/**
 * https://platform.claude.com/docs/en/build-with-claude/preserved-thinking
 * Dynamic skills, local compaction and checkpoint image removal edit the bound
 * prefix. Native supported models opt into drop_block on EVERY request, including
 * the first and after restart. This can cost extra reasoning/cache misses.
 * Compatible endpoints default to removing ALL thinking every turn, as the
 * documented no-beta alternative; never remove just a middle block. A proxy may
 * opt in only when it forwards both the beta header and block_binding unchanged.
 * DeepSeek serves Claude-style names with its own models, which need their
 * thinking back in a tool chain (https://api-docs.deepseek.com/guides/thinking_mode),
 * so its host never strips; its tool chains normally run with thinking disabled.
 */
export function anthropicThinkingPolicy(baseUrl: string, model: string, bindingControls?: boolean) {
  const boundModel = !isDeepSeekAnthropicBaseUrl(baseUrl)
    && /claude-(?:fable-5-1|opus-5-5|sonnet-5-5)(?![0-9])/i.test(model);
  let native = false;
  try { native = new URL(baseUrl).origin === 'https://api.anthropic.com'; } catch { /* Invalid URL fails at transport. */ }
  const controls = boundModel && (bindingControls ?? native);
  const headers: Readonly<Record<string, string>> = controls
    ? { 'anthropic-beta': 'thinking-binding-controls-2026-08-01' }
    : {};
  return {
    replayReasoning: !boundModel || controls,
    headers,
    thinking: controls ? {
      type: 'adaptive',
      block_binding: { prefix_mismatch_behavior: 'drop_block' }
    } : undefined
  };
}
