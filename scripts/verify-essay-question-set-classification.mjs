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
  const [identity, navigation, tasks, featureModule, repositoryModule, indexedRepositoryModule] = await Promise.all([
    server.ssrLoadModule('/src/domain/essayQuestionSet.ts'),
    server.ssrLoadModule('/src/features/practice/EssayNavigation.ts'),
    server.ssrLoadModule('/src/services/GenerationTaskContract.ts'),
    server.ssrLoadModule('/src/features/practice/EssayPracticeCenterFeature.ts'),
    server.ssrLoadModule('/src/services/EssayRepository.ts'),
    server.ssrLoadModule('/src/modules/content/adapters/IndexedDbLearningAssetRepository.ts')
  ]);

  verifyIdentityAndTaskScope(identity, tasks);
  verifyNavigation(navigation);
  await verifyClassificationAndOrdering(featureModule, identity);
  await verifyHistorySummaryQuery(repositoryModule);
  await verifyIndexedPurposeQuery(indexedRepositoryModule);

  console.log('Essay question-set classification verification passed.');
} finally {
  await server.close();
}

function verifyIdentityAndTaskScope(identity, tasks) {
  const firstId = identity.createEssayQuestionSetId();
  const secondId = identity.createEssayQuestionSetId();
  assert.notEqual(firstId, secondId);

  const context = { date: '2026-08-12', topic: '归纳概括', type: 'short', entryMode: 'tutor', purpose: 'practice' };
  const scope = identity.essayQuestionSetGenerationScope(context);
  assert.equal(
    tasks.generationTaskScope('project-1', { intent: 'mock', sourceId: firstId, scopeId: scope }),
    tasks.generationTaskScope('project-1', { intent: 'mock', sourceId: secondId, scopeId: scope }),
    'output identity must not disable active-task deduplication'
  );
  assert.equal(identity.essayQuestionSetBusinessKey({ ...context, questionSetId: firstId }), firstId);
  assert.throws(() => identity.essayQuestionSetBusinessKey(context), /questionSetId/);
  assert.notEqual(
    scope,
    identity.essayQuestionSetGenerationScope({ ...context, purpose: 'mock' }),
    'practice and mock generation must never share an active-task scope'
  );

  const actionParams = tasks.generationTaskActionParams({
    intent: 'mock',
    payload: {
      subject: '申论',
      questionSetId: firstId,
      entryMode: 'tutor',
      essayTopic: '归纳概括',
      essayType: 'long',
      purpose: 'practice',
      date: '2026-08-12'
    }
  });
  assert.equal(actionParams.entryMode, 'tutor');
  assert.equal(actionParams.questionSetId, firstId);
  assert.equal(actionParams.type, 'long');
  assert.equal(actionParams.purpose, 'practice');
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
    type: 'long',
    purpose: 'practice'
  });
  assert.equal(target.questionSetId, 'EssayQuestionSetId:1');
  assert.equal(target.entryMode, 'tutor', 'old task links remain readable while new links use entryMode');
  assert.equal(target.type, 'long');
  assert.equal(target.purpose, 'practice');
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

async function verifyClassificationAndOrdering({ EssayPracticeCenterFeature }, { isEssayMockContext }) {
  const assets = [
    asset('EssayQuestionSetId:tutor-1', 'tutor', '私教题一', 100),
    asset('EssayQuestionSetId:self-2', 'self', '自主题二', 400),
    asset('EssayQuestionSetId:self-1', 'self', '自主题一', 300),
    asset('EssayQuestionSetId:true-1', 'true', '真题一', 200),
    asset('EssayQuestionSetId:tutor-1', 'tutor', '私教题旧版本', 50),
    asset('EssayQuestionSetId:mock-1', 'self', '申论模考', 500, 'mock')
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
  assert.equal(isEssayMockContext(assets.at(-1).payload.essayContext), true);
  assert.equal(isEssayMockContext(assets[0].payload.essayContext), false);
  assert.deepEqual(runtime.queries[0].purposes, ['practice', 'true_question']);
  assert.equal(runtime.queries[0].latestPerBusinessKey, true);
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
  assert(history.every((item) => 'question' in item && 'updatedAt' in item && !('state' in item)));
  assert.deepEqual(counters, { cycle: 1, list: 1, findLatest: 0 }, 'history summaries must not load every set detail');
  assert.deepEqual(runtime.queries[0].purposes, ['practice', 'true_question']);
  assert.equal(runtime.queries[0].latestPerBusinessKey, true);
}

async function verifyIndexedPurposeQuery({ IndexedDbLearningAssetRepository }) {
  const calls = { indexed: 0, full: 0 };
  const database = {
    getAllByIndex: async (_store, index, key) => {
      calls.indexed += 1;
      assert.equal(index, 'by_cycle_kind_purpose_status');
      return [asset(`EssayQuestionSetId:${key[2]}`, key[2] === 'true_question' ? 'true' : 'self', String(key[2]), 100, key[2])];
    },
    getAll: async () => {
      calls.full += 1;
      return [];
    }
  };
  const repository = new IndexedDbLearningAssetRepository(database, {});
  const result = await repository.list({
    examCycleId: 'ExamCycleId:test',
    kinds: ['essay_question'],
    purposes: ['practice', 'true_question'],
    status: 'ready',
    latestPerBusinessKey: true,
    limit: 20
  });
  assert.equal(result.length, 2);
  assert.deepEqual(calls, { indexed: 2, full: 0 }, 'purpose history must use the compound index instead of loading the full asset table');
}

function runtimeWithAssets(assets, counters = { cycle: 0, list: 0, findLatest: 0 }) {
  const runtime = {
    queries: [],
    candidateRepository: {
      findCurrentCycle: async () => {
        counters.cycle += 1;
        return { examCycle: { id: 'ExamCycleId:test' } };
      }
    },
    learningAssetStore: {
      list: async (query) => {
        counters.list += 1;
        runtime.queries.push(query);
        const filtered = assets
          .filter((item) => !query.kinds?.length || query.kinds.includes(item.kind))
          .filter((item) => !query.status || item.status === query.status)
          .filter((item) => !query.purposes?.length || query.purposes.includes(item.purpose))
          .sort((left, right) => right.updatedAt - left.updatedAt);
        const latest = new Map();
        filtered.forEach((item) => {
          if (!latest.has(item.businessKey)) latest.set(item.businessKey, item);
        });
        const deduped = query.latestPerBusinessKey ? [...latest.values()] : filtered;
        return deduped.slice(query.offset || 0, (query.offset || 0) + query.limit);
      },
      count: async (query) => (await runtime.learningAssetStore.list({ ...query, limit: 500 })).length,
      findLatest: async () => {
        counters.findLatest += 1;
        return undefined;
      }
    }
  };
  return runtime;
}

function asset(businessKey, entryMode, title, updatedAt, purpose = entryMode === 'true' ? 'true_question' : 'practice') {
  return {
    id: `asset:${businessKey}:${updatedAt}`,
    examCycleId: 'ExamCycleId:test',
    kind: 'essay_question',
    businessKey,
    title,
    status: 'ready',
    purpose,
    payload: {
      essayContext: { date: '2026-08-12', topic: '归纳概括', type: 'short', entryMode, purpose },
      question: { id: `question:${title}`, title, material: '材料', requirement: '要求' }
    },
    version: 1,
    createdAt: updatedAt,
    updatedAt
  };
}
