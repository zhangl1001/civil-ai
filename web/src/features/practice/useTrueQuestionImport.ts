import { ref } from 'vue';
import { importAgentAttachments } from '@/composition-root/public';
import { useAIChatStore } from '@/stores/aiChat';
import { TrueQuestionImportFeature } from './TrueQuestionImportFeature';

const trueQuestionImportFeature = new TrueQuestionImportFeature(importAgentAttachments);

export function useTrueQuestionImport(reportError: (message: string) => void) {
  const chat = useAIChatStore();
  const importingTrueQuestion = ref(false);

  async function importTrueQuestion(files: readonly File[]) {
    if (importingTrueQuestion.value) return;
    importingTrueQuestion.value = true;
    reportError('');
    try {
      const prepared = await trueQuestionImportFeature.prepare(files);
      await chat.open(prepared.prompt, prepared.attachments);
    } catch (cause) {
      reportError(cause instanceof Error ? cause.message : '导入真题失败');
    } finally {
      importingTrueQuestion.value = false;
    }
  }

  async function researchTrueQuestions(filterSummary: string) {
    reportError('');
    await chat.open(trueQuestionImportFeature.researchPrompt(filterSummary));
  }

  return { importingTrueQuestion, importTrueQuestion, researchTrueQuestions };
}
