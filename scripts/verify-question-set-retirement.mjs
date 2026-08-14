import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web');
const server = await createServer({
  root,
  configFile: false,
  resolve: { alias: { '@': path.join(root, 'src') } },
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: 'custom'
});

try {
  const [content, retireModule, essayModule] = await Promise.all([
    server.ssrLoadModule('/src/modules/content/public.ts'),
    server.ssrLoadModule('/src/modules/content/application/RetireQuestionSet.ts'),
    server.ssrLoadModule('/src/features/practice/EssayPracticeCenterFeature.ts')
  ]);

  await verifyObjectiveRetirement(content, retireModule);
  await verifyEssayRetirement(content, essayModule);
  console.log('Question-set retirement verification passed.');
} finally {
  await server.close();
}

async function verifyObjectiveRetirement(content, { RetireQuestionSet }) {
  const calls = [];
  const bundle = { questionSet: { id: 'QuestionSetId:ready', status: content.QuestionSetStatus.Ready } };
  const repository = {
    findQuestionSet: async () => bundle,
    retireQuestionSet: async (id, context) => calls.push({ id, context })
  };
  const context = { transaction: 'test' };
  const unitOfWork = {
    run: async (work) => work(context),
    runAutocommit: async (work) => work(context)
  };
  const useCase = new RetireQuestionSet(unitOfWork, repository);

  assert.equal(await useCase.execute(bundle.questionSet.id), true);
  assert.deepEqual(calls, [{ id: bundle.questionSet.id, context }]);

  bundle.questionSet.status = content.QuestionSetStatus.Retired;
  assert.equal(await useCase.execute(bundle.questionSet.id), false);
  assert.equal(calls.length, 1, 'retiring an already retired set must be idempotent');
}

async function verifyEssayRetirement(content, { EssayPracticeCenterFeature }) {
  const retired = [];
  const cancelled = [];
  const runtime = {
    candidateRepository: {
      findCurrentCycle: async () => ({ examCycle: { id: 'ExamCycleId:test' } })
    },
    getAgentRunViews: {
      execute: async () => [{
        id: 'AgentRunId:enrichment',
        isActive: true,
        questionSetId: 'EssayQuestionSetId:test',
        targetResourceId: '',
        actionParams: {}
      }]
    },
    cancelAgentRun: {
      execute: async (input) => cancelled.push(input)
    },
    learningAssetStore: {
      retireBusinessKey: async (cycleId, kind, key) => retired.push({ cycleId, kind, key })
    }
  };
  const feature = new EssayPracticeCenterFeature(runtime);
  await feature.retireSet({
    key: 'EssayQuestionSetId:test',
    updatedAt: 1,
    classification: content.LearningAssetPurpose.Practice,
    context: {
      questionSetId: 'EssayQuestionSetId:test',
      date: '2026-08-12',
      topic: '归纳概括',
      type: 'short',
      entryMode: 'self',
      purpose: 'practice'
    }
  });

  assert.deepEqual(retired.map((item) => item.kind), [
    content.LearningAssetKind.EssayQuestion,
    content.LearningAssetKind.EssayDraft
  ]);
  assert.equal(
    retired.some((item) => item.kind === content.LearningAssetKind.EssayAttempt),
    false,
    'completed essay attempts and assessment evidence must remain available'
  );
  assert.equal(cancelled.length, 1, 'unfinished work for the retired set should be cancelled');
}
