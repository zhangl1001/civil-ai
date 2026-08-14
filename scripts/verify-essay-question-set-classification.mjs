import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
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
  const [
    identity,
    navigation,
    tasks,
    featureModule,
    repositoryModule,
    indexedRepositoryModule,
    sqliteRepositoryModule,
    answerModule,
    questionTextModule,
    autosaveModule,
    tutorPlanModule
  ] = await Promise.all([
    server.ssrLoadModule('/src/domain/essayQuestionSet.ts'),
    server.ssrLoadModule('/src/features/practice/EssayNavigation.ts'),
    server.ssrLoadModule('/src/services/GenerationTaskContract.ts'),
    server.ssrLoadModule('/src/features/practice/EssayPracticeCenterFeature.ts'),
    server.ssrLoadModule('/src/services/EssayRepository.ts'),
    server.ssrLoadModule('/src/modules/content/adapters/IndexedDbLearningAssetRepository.ts'),
    server.ssrLoadModule('/src/modules/content/adapters/SqliteLearningAssetRepository.ts'),
    server.ssrLoadModule('/src/domain/essayAnswer.ts'),
    server.ssrLoadModule('/src/domain/essayQuestionText.ts'),
    server.ssrLoadModule('/src/services/EssayDraftAutosave.ts'),
    server.ssrLoadModule('/src/features/practice/EssayTutorPlanFeature.ts')
  ]);

  verifyIdentityAndTaskScope(identity, tasks);
  verifyNavigation(navigation);
  await verifyClassificationAndOrdering(featureModule, identity);
  await verifyHistorySummaryQuery(repositoryModule);
  await verifyIndexedPurposeQuery(indexedRepositoryModule);
  await verifyRepositoryContract(indexedRepositoryModule, sqliteRepositoryModule);
  verifyAnswerPresentation(answerModule, questionTextModule);
  await verifyDraftAutosave(autosaveModule);
  verifyEssayTutorPlan(tutorPlanModule);

  console.log('Essay question-set classification verification passed.');
} finally {
  await server.close();
}

function verifyEssayTutorPlan({ resolveEssayTutorPlanPrescription }) {
  const expression = {
    id: 'capability:essay:structured-expression',
    code: 'essay.structured_expression',
    name: '结构化表达与论证',
    nodeType: 'expression_skill',
    subject: 'essay',
    module: 'essay',
    status: 'active'
  };
  const aptitude = {
    id: 'capability:aptitude:judgment:argument-structure',
    code: 'aptitude.judgment.argument_structure',
    name: '论点、论据与论证结构识别',
    nodeType: 'knowledge_point',
    subject: 'aptitude',
    module: 'judgment',
    status: 'active'
  };
  const item = {
    id: 'DailyPlanItemId:essay-review',
    capabilityNodeId: expression.id,
    itemType: 'review',
    status: 'pending',
    targetCount: 3
  };
  const prescription = resolveEssayTutorPlanPrescription({
    date: '2026-08-12',
    nodes: [aptitude, expression],
    preference: { dailyPlanItemId: item.id, capabilityNodeId: expression.id },
    plan: {
      plan: { id: 'DailyPlanId:1' },
      blocks: [],
      items: [item]
    }
  });
  assert.equal(prescription.context.topic, '结构化表达与论证');
  assert.equal(prescription.context.capabilityNodeId, expression.id);
  assert.equal(prescription.context.dailyPlanItemId, item.id);
  assert.equal(prescription.context.assessmentRole, 'retention');
  assert.equal(prescription.context.type, 'long');
  assert.equal(prescription.questionCount, 1);
  assert.throws(
    () => resolveEssayTutorPlanPrescription({
      date: '2026-08-12',
      nodes: [aptitude, expression],
      preference: { capabilityNodeId: aptitude.id }
    }),
    /不属于申论/,
    'essay launch must fail closed instead of falling back to an aptitude capability'
  );
}

async function verifyDraftAutosave({ EssayDraftAutosave }) {
  const writes = [];
  const autosave = new EssayDraftAutosave(async (draft, context) => {
    writes.push(`${context.questionSetId}:${draft}`);
  }, 5);

  autosave.schedule('一', { questionSetId: 'set-a' });
  autosave.schedule('一二', { questionSetId: 'set-a' });
  autosave.schedule('一二三', { questionSetId: 'set-a' });
  await autosave.flush();
  assert.deepEqual(writes, ['set-a:一二三'], 'keystrokes coalesce into a single write');

  // Leaving a set must persist the pending keystrokes, not discard them.
  autosave.schedule('未保存的作答', { questionSetId: 'set-a' });
  await autosave.flush();
  assert.deepEqual(
    writes.at(-1),
    'set-a:未保存的作答',
    'switching away from a set must flush its pending draft'
  );

  autosave.schedule('丢弃我', { questionSetId: 'set-a' });
  autosave.cancel();
  await autosave.flush();
  assert.equal(writes.length, 2, 'an explicitly cancelled draft is never written');

  const ordered = [];
  const serial = new EssayDraftAutosave(async (draft) => {
    await new Promise((resolve) => setTimeout(resolve, draft === 'slow' ? 20 : 0));
    ordered.push(draft);
  }, 0);
  serial.schedule('slow', { questionSetId: 'set-b' });
  await new Promise((resolve) => setTimeout(resolve, 5));
  serial.schedule('fast', { questionSetId: 'set-b' });
  await serial.flush();
  assert.deepEqual(ordered, ['slow', 'fast'], 'writes stay ordered so the last keystroke wins');

  const failures = [];
  const failing = new EssayDraftAutosave(
    async (draft) => { if (draft === 'boom') throw new Error('write failed'); failures.push(draft); },
    0,
    (cause) => failures.push(`caught:${cause.message}`)
  );
  failing.schedule('boom', { questionSetId: 'set-c' });
  await failing.flush();
  failing.schedule('after', { questionSetId: 'set-c' });
  await failing.flush();
  assert.deepEqual(failures, ['caught:write failed', 'after'], 'a failed write must not poison later ones');
}

function verifyAnswerPresentation(
  { countEssayWords, parseEssayWordLimit, describeEssayWordCount },
  { splitEssayMaterial, splitEssayRequirement }
) {
  assert.equal(countEssayWords('概括 主要\n问题。'), 7, 'whitespace never counts toward a 申论 word count');

  assert.deepEqual(parseEssayWordLimit('不超过300字'), { max: 300 });
  assert.deepEqual(parseEssayWordLimit('字数200字以内'), { max: 200 });
  assert.deepEqual(parseEssayWordLimit('不少于150字'), { min: 150 });
  assert.deepEqual(parseEssayWordLimit('200-300字'), { min: 200, max: 300 });
  assert.deepEqual(parseEssayWordLimit('500字左右'), { min: 450, max: 550 });
  assert.deepEqual(parseEssayWordLimit('概括主要内容。'), {}, 'a requirement without a 字数 rule must not invent one');
  assert.deepEqual(
    parseEssayWordLimit('(1) 不超过200字；(2) 不超过300字'),
    { max: 500 },
    'one answer sheet holds every task, so per-task budgets add up'
  );

  const withinLimit = describeEssayWordCount('一'.repeat(120), '不超过300字');
  assert.equal(withinLimit.tone, 'neutral');
  assert.equal(withinLimit.label, '120 / 300 字');
  const overLimit = describeEssayWordCount('一'.repeat(320), '不超过300字');
  assert.equal(overLimit.tone, 'danger');
  assert.match(overLimit.label, /超出 20 字/);
  assert.equal(describeEssayWordCount('一'.repeat(80), '不少于150字').tone, 'warning');
  assert.equal(describeEssayWordCount('', '不少于150字').tone, 'neutral', 'an untouched answer is not yet too short');

  assert.deepEqual(
    splitEssayMaterial('给定资料：材料一：甲。资料二：乙。'),
    ['材料一：甲。', '资料二：乙。']
  );
  assert.deepEqual(splitEssayMaterial('   '), []);
  assert.deepEqual(
    splitEssayRequirement('要求：(1) 全面准确；(2) 条理清晰'),
    ['全面准确；', '条理清晰']
  );
  assert.deepEqual(
    splitEssayRequirement('概括主要问题，不超过300字。'),
    ['概括主要问题，不超过300字。'],
    'a single-task requirement stays whole'
  );
  assert.deepEqual(
    splitEssayRequirement('概括 主要 问题，不超过300字。'),
    ['概括 主要 问题，不超过300字。'],
    'spaces inside a task must never be treated as task boundaries'
  );
  assert.deepEqual(
    splitEssayRequirement('一、概括问题。二、提出对策。'),
    ['概括问题。', '提出对策。']
  );
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
      // What EssayFlowService actually sends. The old fixture passed a subject
      // display name, which no caller ever set.
      deliveryKind: 'subjective',
      questionSetId: firstId,
      entryMode: 'tutor',
      essayTopic: '归纳概括',
      essayType: 'long',
      purpose: 'practice',
      date: '2026-08-12',
      dailyPlanId: 'DailyPlanId:1',
      dailyPlanItemId: 'DailyPlanItemId:1',
      capabilityNodeId: 'capability:essay:structured-expression',
      assessmentRole: 'retention'
    }
  });
  assert.equal(actionParams.entryMode, 'tutor');
  assert.equal(actionParams.questionSetId, firstId);
  assert.equal(actionParams.type, 'long');
  assert.equal(actionParams.purpose, 'practice');
  assert.equal(actionParams.dailyPlanId, 'DailyPlanId:1');
  assert.equal(actionParams.dailyPlanItemId, 'DailyPlanItemId:1');
  assert.equal(actionParams.capabilityNodeId, 'capability:essay:structured-expression');
  assert.equal(actionParams.assessmentRole, 'retention');
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
    asset('EssayQuestionSetId:legacy-1', 'self', '旧版未分类题', 250, 'legacy_unknown'),
    asset('EssayQuestionSetId:tutor-1', 'tutor', '私教题旧版本', 50),
    asset('EssayQuestionSetId:mock-1', 'self', '申论模考', 500, 'mock')
  ];
  const runtime = runtimeWithAssets(assets);
  const sets = await new EssayPracticeCenterFeature(runtime).listSets();
  assert.equal(sets.length, 5);
  assert.deepEqual(sets.map((item) => item.key), [
    'EssayQuestionSetId:self-2',
    'EssayQuestionSetId:self-1',
    'EssayQuestionSetId:legacy-1',
    'EssayQuestionSetId:true-1',
    'EssayQuestionSetId:tutor-1'
  ]);
  assert.equal(sets.filter((item) => item.context.entryMode === 'tutor').length, 1);
  assert.equal(sets.filter((item) => item.context.entryMode === 'self' && item.classification !== 'legacy_unknown').length, 2);
  assert.equal(sets.filter((item) => item.context.entryMode === 'true').length, 1);
  assert.equal(sets.find((item) => item.key === 'EssayQuestionSetId:legacy-1').classification, 'legacy_unknown');
  assert(sets.every((item) => item.context.questionSetId === item.key));
  assert.equal(isEssayMockContext(assets.at(-1).payload.essayContext), true);
  assert.equal(isEssayMockContext(assets[0].payload.essayContext), false);
  assert.deepEqual(runtime.queries[0].purposes, ['practice', 'true_question', 'legacy_unknown']);
  assert.equal(runtime.queries[0].latestPerBusinessKey, true);
}

async function verifyHistorySummaryQuery({ EssayRepository }) {
  const counters = { cycle: 0, list: 0, findLatest: 0 };
  const assets = [
    asset('EssayQuestionSetId:2', 'self', '新题', 200),
    asset('EssayQuestionSetId:legacy', 'self', '旧版未分类题', 150, 'legacy_unknown'),
    asset('EssayQuestionSetId:1', 'tutor', '旧题', 100)
  ];
  const runtime = runtimeWithAssets(assets, counters);
  const repository = new EssayRepository(async () => runtime);
  const history = await repository.listStates();
  assert.deepEqual(history.map((item) => item.key), ['EssayQuestionSetId:2', 'EssayQuestionSetId:legacy', 'EssayQuestionSetId:1']);
  assert.equal(history[1].classification, 'legacy_unknown');
  assert(history.every((item) => 'question' in item && 'updatedAt' in item && !('state' in item)));
  assert.deepEqual(counters, { cycle: 1, list: 1, findLatest: 0 }, 'history summaries must not load every set detail');
  assert.deepEqual(runtime.queries[0].purposes, ['practice', 'true_question', 'legacy_unknown']);
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

async function verifyRepositoryContract({ IndexedDbLearningAssetRepository }, { SqliteLearningAssetRepository }) {
  const records = [
    contractAsset('a-v1', 'set-a', 1, 300, 'practice', 'ready'),
    contractAsset('a-v2', 'set-a', 2, 100, 'practice', 'ready'),
    contractAsset('b-v1', 'set-b', 1, 400, 'practice', 'ready'),
    contractAsset('b-v2', 'set-b', 2, 500, 'mock', 'ready'),
    contractAsset('c-v1', 'set-c', 1, 200, 'practice', 'ready'),
    contractAsset('c-v2', 'set-c', 2, 600, 'practice', 'retired')
  ];
  const indexedDatabase = {
    getAllByIndex: async (_store, _index, key) => records.filter((item) => (
      item.examCycleId === key[0] && item.kind === key[1] && item.purpose === key[2] && item.status === key[3]
    )),
    getAll: async () => records
  };
  const indexed = new IndexedDbLearningAssetRepository(indexedDatabase, {});

  const native = new DatabaseSync(':memory:');
  native.exec(`CREATE TABLE learning_assets(
    id TEXT PRIMARY KEY,
    exam_cycle_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    business_key TEXT NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL,
    purpose TEXT,
    payload_json TEXT NOT NULL,
    source_agent_run_id TEXT,
    version INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
  const insert = native.prepare(`INSERT INTO learning_assets(
    id,exam_cycle_id,kind,business_key,title,status,purpose,payload_json,source_agent_run_id,version,created_at,updated_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const item of records) insert.run(
    item.id, item.examCycleId, item.kind, item.businessKey, item.title, item.status,
    item.purpose, JSON.stringify(item.payload), null, item.version, item.createdAt, item.updatedAt
  );
  const sqlite = new SqliteLearningAssetRepository({
    query: async (sql, parameters = []) => native.prepare(sql).all(...parameters)
  }, {});
  const query = {
    examCycleId: 'ExamCycleId:test',
    kinds: ['essay_question'],
    purposes: ['practice'],
    status: 'ready',
    latestPerBusinessKey: true,
    limit: 20
  };
  const [indexedItems, sqliteItems, indexedCount, sqliteCount] = await Promise.all([
    indexed.list(query),
    sqlite.list(query),
    indexed.count(query),
    sqlite.count(query)
  ]);
  const expectedIds = ['b-v1', 'c-v1', 'a-v2'];
  assert.deepEqual(indexedItems.map((item) => item.id), expectedIds);
  assert.deepEqual(sqliteItems.map((item) => item.id), expectedIds);
  assert.equal(indexedCount, 3);
  assert.equal(sqliteCount, 3);
  assert.deepEqual((await indexed.list({ ...query, offset: 1, limit: 1 })).map((item) => item.id), ['c-v1']);
  assert.deepEqual((await sqlite.list({ ...query, offset: 1, limit: 1 })).map((item) => item.id), ['c-v1']);
  native.close();
}

function contractAsset(id, businessKey, version, updatedAt, purpose, status) {
  return {
    id,
    examCycleId: 'ExamCycleId:test',
    kind: 'essay_question',
    businessKey,
    title: id,
    status,
    purpose,
    payload: {},
    version,
    createdAt: updatedAt,
    updatedAt
  };
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
