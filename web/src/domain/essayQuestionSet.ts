export type EssayQuestionSetMode = 'tutor' | 'self' | 'true';

export interface EssayQuestionSetIdentity {
  readonly questionSetId?: string;
  readonly date: string;
  readonly topic: string;
  readonly type: string;
  readonly entryMode?: EssayQuestionSetMode;
}

export function createEssayQuestionSetId(): string {
  return `EssayQuestionSetId:${crypto.randomUUID()}`;
}

export function essayQuestionSetGenerationScope(identity: EssayQuestionSetIdentity): string {
  return [
    'essay-generation',
    normalizeEssayQuestionSetMode(identity.entryMode),
    identity.date,
    identity.topic,
    identity.type
  ].join(':');
}

export function essayQuestionSetBusinessKey(identity: EssayQuestionSetIdentity): string {
  const questionSetId = identity.questionSetId?.trim();
  if (questionSetId) return questionSetId;
  const mode = identity.entryMode && identity.entryMode !== 'self' ? `:${identity.entryMode}` : '';
  return `essay:${identity.date}:${identity.topic}:${identity.type}${mode}`;
}

export function normalizeEssayQuestionSetMode(value: unknown): EssayQuestionSetMode {
  return value === 'tutor' || value === 'true' ? value : 'self';
}
