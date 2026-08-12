import { ref } from 'vue';
import { enqueueBusinessAgentTask, importAgentAttachments } from '@/composition-root/public';
import { useAIChatStore } from '@/stores/aiChat';
import { TrueQuestionImportFeature, type TrueQuestionImportSubject } from './TrueQuestionImportFeature';
import { trueQuestionResearchScope, type TrueQuestionResearchCriteria } from './TrueQuestionResearchCriteria';

const trueQuestionImportFeature = new TrueQuestionImportFeature(importAgentAttachments);

export function useTrueQuestionImport(
  reportError: (message: string) => void,
  subject: TrueQuestionImportSubject = 'aptitude'
) {
  const chat = useAIChatStore();
  const importingTrueQuestion = ref(false);
  const researchingTrueQuestion = ref(false);

  async function importTrueQuestion(files: readonly File[]) {
    if (importingTrueQuestion.value) return;
    importingTrueQuestion.value = true;
    reportError('');
    try {
      const prepared = await trueQuestionImportFeature.prepare(files, subject);
      await chat.open(prepared.prompt, prepared.attachments, prepared.invocation);
    } catch (cause) {
      reportError(cause instanceof Error ? cause.message : '导入真题失败');
    } finally {
      importingTrueQuestion.value = false;
    }
  }

  async function researchTrueQuestions(criteria: TrueQuestionResearchCriteria) {
    if (researchingTrueQuestion.value) return;
    researchingTrueQuestion.value = true;
    reportError('');
    try {
      const scope = trueQuestionResearchScope(criteria);
      return await enqueueBusinessAgentTask({
        intent: 'trueQuestionResearch',
        title: '联网真题研究',
        detail: scope,
        sourceId: scope,
        payload: { scope, maxQuestions: criteria.maxQuestions }
      });
    } catch (cause) {
      reportError(cause instanceof Error ? cause.message : '创建联网真题研究任务失败');
    } finally {
      researchingTrueQuestion.value = false;
    }
    return undefined;
  }

  return { importingTrueQuestion, researchingTrueQuestion, importTrueQuestion, researchTrueQuestions };
}
