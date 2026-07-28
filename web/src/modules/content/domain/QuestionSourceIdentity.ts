import { sha256Json } from '@/kernel/public';
import type { QuestionOriginType } from './QuestionSourceCodes';

export interface QuestionSourceIdentityInput {
  readonly sourceType: QuestionOriginType;
  readonly provider?: string;
  readonly examType?: string;
  readonly examYear?: number;
  readonly province?: string;
  readonly examBatch?: string;
  readonly paperName?: string;
  readonly sectionName?: string;
  readonly sourceVersion: string;
  readonly contentHash?: string;
}

export function buildQuestionSourceIdentityHash(input: QuestionSourceIdentityInput): Promise<string> {
  const hasNamedIdentity = Boolean(
    input.provider
    || input.examType
    || input.examYear !== undefined
    || input.province
    || input.examBatch
    || input.paperName
    || input.sectionName
  );
  return sha256Json({
    sourceType: input.sourceType,
    provider: identityText(input.provider),
    examType: identityText(input.examType),
    examYear: input.examYear ?? null,
    province: identityText(input.province),
    examBatch: identityText(input.examBatch),
    paperName: identityText(input.paperName),
    sectionName: identityText(input.sectionName),
    sourceVersion: input.sourceVersion.toLocaleLowerCase(),
    anonymousContentHash: hasNamedIdentity ? null : input.contentHash ?? null
  });
}

function identityText(value: string | undefined): string | null {
  return value?.toLocaleLowerCase() ?? null;
}
