import type { SubjectCode } from '@/kernel/public';

export type EssayMockType = 'short' | 'long';

/**
 * Start preferences for one mock exam run. These are a local UI convenience,
 * not a domain fact: which subjects exist and how each is answered comes from
 * the installed curriculum package.
 */
export interface ExamStartContext {
  readonly subjectCode: SubjectCode;
  readonly date: string;
  readonly questionCount: number;
  readonly durationMinutes: number;
  readonly tags: readonly string[];
  readonly essayType: EssayMockType;
}
