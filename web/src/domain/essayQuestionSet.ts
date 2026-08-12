export type EssayQuestionSetMode = 'tutor' | 'self' | 'true';
export type EssayQuestionSetPurpose = 'practice' | 'mock' | 'true_question';

export interface EssayQuestionSetIdentity {
  readonly questionSetId?: string;
  readonly date: string;
  readonly topic: string;
  readonly type: string;
  readonly entryMode?: EssayQuestionSetMode;
  readonly purpose?: EssayQuestionSetPurpose;
}

export function createEssayQuestionSetId(): string {
  return `EssayQuestionSetId:${crypto.randomUUID()}`;
}

export function essayQuestionSetGenerationScope(identity: EssayQuestionSetIdentity): string {
  return [
    'essay-generation',
    normalizeEssayQuestionSetPurpose(identity.purpose, identity.entryMode),
    normalizeEssayQuestionSetMode(identity.entryMode),
    identity.date,
    identity.topic,
    identity.type
  ].join(':');
}

export function essayQuestionSetBusinessKey(identity: EssayQuestionSetIdentity): string {
  const questionSetId = identity.questionSetId?.trim();
  if (questionSetId) return questionSetId;
  throw new TypeError('Essay question-set identity requires questionSetId');
}

export function normalizeEssayQuestionSetMode(value: unknown): EssayQuestionSetMode {
  return value === 'tutor' || value === 'true' ? value : 'self';
}

export function normalizeEssayQuestionSetPurpose(
  value: unknown,
  entryMode?: unknown
): EssayQuestionSetPurpose {
  if (value === 'mock' || value === 'true_question') return value;
  return normalizeEssayQuestionSetMode(entryMode) === 'true' ? 'true_question' : 'practice';
}

export function isEssayMockContext(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const context = value as Record<string, unknown>;
  return normalizeEssayQuestionSetPurpose(context.purpose, context.entryMode) === 'mock';
}
