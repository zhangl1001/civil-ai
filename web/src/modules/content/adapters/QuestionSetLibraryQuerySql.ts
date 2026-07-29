import type { QuestionSetLibraryQuery } from '../contracts/ContentRepository';

export function appendQuestionSetLibraryQuery(
  filters: string[],
  params: Array<string | number>,
  query: QuestionSetLibraryQuery
): void {
  appendInFilter(filters, params, 'question_set.capability_node_id', query.capabilityNodeIds);
  appendInFilter(filters, params, 'question_set.origin_type', query.originTypes);
  appendInFilter(filters, params, 'question_set.entry_mode', query.entryModes);
  appendInFilter(filters, params, 'question_set.module', query.modules);
  appendInFilter(filters, params, 'question_set.practice_status', query.practiceStatuses);
  appendInFilter(filters, params, 'source.exam_year', query.examYears);
  appendInFilter(filters, params, 'source.province', query.provinces);
  if (query.cursor) {
    filters.push('(question_set.created_at < ? OR (question_set.created_at = ? AND question_set.id < ?))');
    params.push(query.cursor.createdAt, query.cursor.createdAt, query.cursor.id);
  }
}

function appendInFilter(
  filters: string[],
  params: Array<string | number>,
  column: string,
  values?: readonly (string | number)[]
): void {
  const normalized = [...new Set((values ?? []).filter((value) => (
    typeof value === 'number' ? Number.isFinite(value) : Boolean(value.trim())
  )))];
  if (!normalized.length) return;
  filters.push(`${column} IN (${normalized.map(() => '?').join(', ')})`);
  params.push(...normalized);
}
