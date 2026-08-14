export const ExplanationDepth = {
  Concise: 'concise',
  Balanced: 'balanced',
  Deep: 'deep'
} as const;

export type ExplanationDepth = typeof ExplanationDepth[keyof typeof ExplanationDepth];

export const ProactiveLevel = {
  Quiet: 'quiet',
  Balanced: 'balanced',
  Active: 'active'
} as const;

export type ProactiveLevel = typeof ProactiveLevel[keyof typeof ProactiveLevel];

const PROACTIVE_LEVELS: readonly string[] = Object.values(ProactiveLevel);

export function parseProactiveLevel(value: unknown): ProactiveLevel | undefined {
  return typeof value === 'string' && PROACTIVE_LEVELS.includes(value) ? value as ProactiveLevel : undefined;
}
