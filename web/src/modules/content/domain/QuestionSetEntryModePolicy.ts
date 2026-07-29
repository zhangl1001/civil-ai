import { QuestionSetEntryMode } from './ContentCodes';

export function resolveQuestionSetEntryMode(
  constraints: Readonly<Record<string, unknown>>
): QuestionSetEntryMode {
  if (constraints.entryMode === QuestionSetEntryMode.Self) return QuestionSetEntryMode.Self;
  if (constraints.entryMode === QuestionSetEntryMode.Tutor) return QuestionSetEntryMode.Tutor;
  return constraints.source === 'custom' ? QuestionSetEntryMode.Self : QuestionSetEntryMode.Tutor;
}
