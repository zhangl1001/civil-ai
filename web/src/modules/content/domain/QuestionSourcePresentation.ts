import type { QuestionSetLibraryEntry, QuestionSetSourceSummary } from '../contracts/ContentRepository';
import { QuestionOriginType, type QuestionOriginType as QuestionOriginTypeCode } from './QuestionSourceCodes';

const originLabels: Readonly<Record<QuestionOriginTypeCode, string>> = {
  [QuestionOriginType.Official]: '官方真题',
  [QuestionOriginType.Imported]: '导入题',
  [QuestionOriginType.UserCreated]: '自建题',
  [QuestionOriginType.AiGenerated]: 'AI 训练',
  [QuestionOriginType.AiVariant]: 'AI 变式',
  [QuestionOriginType.DiagnosticAnchor]: '诊断锚点'
};

export function questionOriginLabel(originType?: QuestionOriginTypeCode): string {
  return originType ? originLabels[originType] : '练习题';
}

export function questionSourceTitle(source?: QuestionSetSourceSummary): string {
  if (!source) return '';
  return source.paperName?.trim()
    || [
      source.examYear ? `${source.examYear}年` : '',
      source.province?.trim(),
      source.sectionName?.trim()
    ].filter(Boolean).join(' ')
    || questionOriginLabel(source.sourceType);
}

export function questionSetLibraryTitle(entry: QuestionSetLibraryEntry): string {
  return questionSourceTitle(entry.sourceMetadata) || questionOriginLabel(entry.originType);
}
