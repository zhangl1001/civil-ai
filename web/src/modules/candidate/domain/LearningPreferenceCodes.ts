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
