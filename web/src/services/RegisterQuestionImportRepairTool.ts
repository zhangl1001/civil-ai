import type { TutorDatabaseRuntime } from '@/composition-root/public';
import type {
  JsonObject,
  QuestionImportCandidateId,
  QuestionImportDraftId
} from '@/kernel/public';
import type { RegisteredAgentToolExecutor } from '@/modules/agent/public';

export function registerQuestionImportRepairTool(
  executor: RegisteredAgentToolExecutor,
  runtime: TutorDatabaseRuntime
): void {
  executor.register('question_bank.repair', async (call, context) => {
    context.signal?.throwIfAborted();
    const replacements = Array.isArray(call.arguments.replacements)
      ? call.arguments.replacements.map((item) => {
          const row = asJsonRecord(item);
          const question = asJsonRecord(row.question);
          return {
            candidateId: String(row.candidateId || '') as QuestionImportCandidateId,
            raw: question,
            difficulty: optionalNumber(question.difficulty)
          };
        })
      : [];
    if (!replacements.length) {
      throw new Error('自动修正至少需要一个候选题的结构化替换内容。');
    }
    const view = await runtime.confirmQuestionImportDraft.execute({
      draftId: String(call.arguments.draftId || '') as QuestionImportDraftId,
      expectedVersion: Number(call.arguments.expectedVersion),
      repairOnly: true,
      replacements
    });
    return {
      content: JSON.stringify(view),
      resultRef: view.draftId,
      madeProgress: true
    };
  });
}

function asJsonRecord(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('工具参数必须是对象。');
  }
  return value as JsonObject;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
