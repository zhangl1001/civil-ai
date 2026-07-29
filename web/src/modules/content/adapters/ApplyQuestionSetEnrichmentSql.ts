import type { SqlTransaction } from '@/capabilities/database/contracts/SqlDatabase';
import type { QuestionSetEnrichmentPatch } from '../contracts/ContentRepository';

export async function applyQuestionSetEnrichmentSql(
  transaction: SqlTransaction,
  patch: QuestionSetEnrichmentPatch
): Promise<boolean> {
  const versions = await transaction.query<{ content_version: number }>(
    'SELECT content_version FROM question_sets WHERE id = ? LIMIT 1',
    [patch.questionSetId]
  );
  if (versions[0]?.content_version !== patch.expectedContentVersion) return false;

  if (patch.lecture) {
    const document = patch.lecture.document;
    const updatedDocument = await transaction.run(
      `UPDATE content_documents
       SET content_json = ?, content_hash = ?, content_version = ?
       WHERE id = ? AND content_version = ?`,
      [
        JSON.stringify(document.content),
        document.contentHash,
        document.contentVersion,
        document.id,
        document.contentVersion - 1
      ]
    );
    if (updatedDocument.changes !== 1) throw new Error('Lecture enrichment version conflict');
    await transaction.run(
      'UPDATE lectures SET version = version + 1 WHERE id = ?',
      [patch.lecture.lectureId]
    );
  }

  for (const question of patch.questions) {
    const updatedQuestion = await transaction.run(
      `UPDATE questions
       SET content_json = ?, content_hash = ?, content_version = ?
       WHERE id = ? AND question_set_id = ? AND content_version = ?`,
      [
        JSON.stringify(question.content),
        question.contentHash,
        question.contentVersion,
        question.id,
        patch.questionSetId,
        question.contentVersion - 1
      ]
    );
    if (updatedQuestion.changes !== 1) throw new Error('Question enrichment version conflict');
  }

  const updatedQuestionSet = await transaction.run(
    `UPDATE question_sets
     SET content_hash = ?, content_version = content_version + 1
     WHERE id = ? AND content_version = ?`,
    [patch.nextContentHash, patch.questionSetId, patch.expectedContentVersion]
  );
  if (updatedQuestionSet.changes !== 1) throw new Error('Question set enrichment version conflict');
  return true;
}
