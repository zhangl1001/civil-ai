import type { AgentContextSection } from '../contracts/AgentRuntimePorts';

export interface BudgetedAgentContext {
  readonly text: string;
  readonly includedCodes: readonly string[];
  readonly estimatedTokens: number;
}

/** Deterministic client-side budgeter. IDs and required contracts are never dropped. */
export class AgentContextBudgeter {
  compile(sections: readonly AgentContextSection[], tokenBudget: number): BudgetedAgentContext {
    if (!Number.isInteger(tokenBudget) || tokenBudget < 256) {
      throw new RangeError('Agent context token budget must be at least 256');
    }
    const ordered = [...sections].sort((left, right) => (
      Number(right.required) - Number(left.required)
      || right.priority - left.priority
      || left.code.localeCompare(right.code)
    ));
    const chunks: string[] = [];
    const includedCodes: string[] = [];
    let remaining = tokenBudget;
    for (const section of ordered) {
      const sectionBudget = Math.min(section.maxTokens, remaining);
      if (sectionBudget < 16) {
        if (section.required) throw new Error(`Required Agent context exceeds budget: ${section.code}`);
        continue;
      }
      const normalized = section.content.trim();
      if (!normalized) continue;
      const content = truncateByTokenEstimate(normalized, sectionBudget);
      const chunk = `<context code="${section.code}">\n${content}\n</context>`;
      const cost = estimateTokens(chunk);
      if (cost > remaining && !section.required) continue;
      if (cost > remaining) throw new Error(`Required Agent context exceeds budget: ${section.code}`);
      chunks.push(chunk);
      includedCodes.push(section.code);
      remaining -= cost;
    }
    return {
      text: chunks.join('\n\n'),
      includedCodes,
      estimatedTokens: tokenBudget - remaining
    };
  }
}

export function estimateTokens(text: string): number {
  const ascii = text.replace(/[^\x00-\x7F]/g, '').length;
  const nonAscii = text.length - ascii;
  return Math.max(1, Math.ceil(ascii / 4 + nonAscii / 1.6));
}

function truncateByTokenEstimate(text: string, maxTokens: number): string {
  if (estimateTokens(text) <= maxTokens) return text;
  const maxChars = Math.max(32, Math.floor(maxTokens * 1.7));
  const head = Math.floor(maxChars * 0.72);
  const tail = Math.floor(maxChars * 0.22);
  return `${text.slice(0, head)}\n...[context truncated]...\n${text.slice(-tail)}`;
}
