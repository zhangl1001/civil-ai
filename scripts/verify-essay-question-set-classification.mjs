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
  const [identity, navigation, tasks, featureModule, repositoryModule] = await Promise.all([
    server.ssrLoadModule('/src/domain/essayQuestionSet.ts'),
    server.ssrLoadModule('/src/features/practice/EssayNavigation.ts'),
    server.ssrLoadModule('/src/services/GenerationTaskContract.ts'),
    server.ssrLoadModule('/src/features/practice/EssayPracticeCenterFeature.ts'),
    server.ssrLoadModule('/src/services/EssayRepository.ts')
  ]);

  verifyIdentityAndTaskScope(identity, tasks);
  verifyNavigation(navigation);
  await verifyClassificationAndOrdering(featureModule);
  await verifyHistorySummaryQuery(repositoryModule);

  console.log('Essay question-set classification verification passed.');
} finally {
  await server.close();
}

function verifyIdentityAndTaskScope(identity, tasks) {
  const firstId = identity.createEssayQuestionSetId();
  const secondId = identity.createEssayQuestionSetId();
  assert.notEqual(firstId, secondId);

  const context = { date: '2026-08-12', topic: '归纳概括', type: 'short', entryMode: 'tutor' };
  const scope = identity.essayQuestionSetGenerationScope(context);
  assert.equal(
    tasks.generationTaskScope('project-1', { intent: 'mock', sourceId: firstId, scopeId: scope }),
    tasks.generationTaskScope('project-1', { intent: 'mock', sourceId: secondId, scopeId: scope }),
    'output identity must not disable active-task deduplication'
  );
  assert.equal(identity.essayQuestionSetBusinessKey({ ...context, questionSetId: firstId }), firstId);

  const actionParams = tasks.generationTaskActionParams({
    intent: 'mock',
    payload: { subject: '申论', questionSetId: firstId, entryMode: 'tutor', essayTopic: '归纳概括', date: '2026-08-12' }
  });
  assert.equal(actionParams.entryMode, 'tutor');
  assert.equal(actionParams.questionSetId, firstId);
  assert.equal('mode' in actionParams, false, 'essay task navigation must use entryMode consistently');

  const legacyParams = tasks.generationTaskActionParams({
    intent: 'essayGrade',
    payload: { entryMode: 'self', essayTopic: '归纳概括', essayDate: '2026-08-12' }
  });
  assert.equal('questionSetId' in legacyParams, false, 'missing ids must be omitted instead of serialized as empty query values');
}

function verifyNavigation(navigation) {
  assert.deepEqual(navigation.essayCenterLocation('true'), {
    path: '/vue/practice',
    query: { subject: 'essay', mode: 'true' }
  });
  assert.equal(navigation.essayQuestionSetTargetFromQuery({ entryMode: 'tutor' }), undefined);
  assert.throws(() => navigation.essayQuestionSetLocation({ questionSetId: '', date: '2026-08-12', topic: '归纳概括', type: 'short' }));

  const target = navigation.essayQuestionSetTargetFromQuery({
    questionSetId: 'EssayQuestionSetId:1',
    mode: 'tutor',
    date: '2026-08-12',
    topic: '归纳概括',
    type: 'long'
  });
  assert.equal(target.questionSetId, 'EssayQuestionSetId:1');
  assert.equal(target.entryMode, 'tutor', 'old task links remain readable while new links use entryMode');
  assert.equal(target.type, 'long');
  assert.deepEqual(navigation.essayHistoryLocation({ date: '2026-08-12', title: '申论' }), navigation.essayCenterLocation('self'));
  assert.equal(navigation.essayHistoryLocation({
    questionSetId: 'EssayQuestionSetId:2',
    essayEntryMode: 'true',
    date: '2026-08-12',
    essayTopic: '申发论述',
    essayType: 'long',
    title: '真题'
  }).query.questionSetId, 'EssayQuestionSetId:2');
}

async function verifyClassificationAndOrdering({ EssayPracticeCenterFeature }) {
  const assets = [
    asset('EssayQuestionSetId:tutor-1', 'tutor', '私教题一', 100),
    asset('EssayQuestionSetId:self-2', 'self', '自主题二', 400),
    asset('EssayQuestionSetId:self-1', 'self', '自主题一', 300),
    asset('EssayQuestionSetId:true-1', 'true', '真题一', 200),
    asset('EssayQuestionSetId:tutor-1', 'tutor', '私教题旧版本', 50)
  ];
  const runtime = runtimeWithAssets(assets);
  const sets = await new EssayPracticeCenterFeature(runtime).listSets();
  assert.equal(sets.length, 4);
  assert.deepEqual(sets.map((item) => item.key), [
    'EssayQuestionSetId:self-2',
    'EssayQuestionSetId:self-1',
    'EssayQuestionSetId:true-1',
    'EssayQuestionSetId:tutor-1'
  ]);
  assert.equal(sets.filter((item) => item.context.entryMode === 'tutor').length, 1);
  assert.equal(sets.filter((item) => item.context.entryMode === 'self').length, 2);
  assert.equal(sets.filter((item) => item.context.entryMode === 'true').length, 1);
  assert(sets.every((item) => item.context.questionSetId === item.key));
}

async function verifyHistorySummaryQuery({ EssayRepository }) {
  const counters = { cycle: 0, list: 0, findLatest: 0 };
  const assets = [
    asset('EssayQuestionSetId:2', 'self', '新题', 200),
    asset('EssayQuestionSetId:1', 'tutor', '旧题', 100)
  ];
  const runtime = runtimeWithAssets(assets, counters);
  const repository = new EssayRepository(async () => runtime);
  const history = await repository.listStates();
  assert.deepEqual(history.map((item) => item.key), ['EssayQuestionSetId:2', 'EssayQuestionSetId:1']);
  assert.deepEqual(counters, { cycle: 1, list: 1, findLatest: 0 }, 'history summaries must not load every set detail');
}

function runtimeWithAssets(assets, counters = { cycle: 0, list: 0, findLatest: 0 }) {
  return {
    candidateRepository: {
      findCurrentCycle: async () => {
        counters.cycle += 1;
        return { examCycle: { id: 'ExamCycleId:test' } };
      }
    },
    learningAssetStore: {
      list: async () => {
        counters.list += 1;
        return assets;
      },
      findLatest: async () => {
        counters.findLatest += 1;
        return undefined;
      }
    }
  };
}

function asset(businessKey, entryMode, title, updatedAt) {
  return {
    id: `asset:${businessKey}:${updatedAt}`,
    examCycleId: 'ExamCycleId:test',
    kind: 'essay_question',
    businessKey,
    title,
    status: 'ready',
    payload: {
      essayContext: { date: '2026-08-12', topic: '归纳概括', type: 'short', entryMode },
      question: { id: `question:${title}`, title, material: '材料', requirement: '要求' }
    },
    version: 1,
    createdAt: updatedAt,
    updatedAt
  };
}
