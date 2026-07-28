import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(scriptDirectory, '../web');
const server = await createServer({
  root: webRoot,
  configFile: false,
  resolve: { alias: { '@': path.join(webRoot, 'src') } },
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: 'custom'
});

try {
  const content = await server.ssrLoadModule('/src/modules/content/public.ts');
  let sequence = 0;
  const ids = {
    next(namespace) {
      sequence += 1;
      return `${namespace}:${sequence}`;
    }
  };
  const clock = { now: () => 1785100000000, monotonicNowMs: () => 10 };
  const transactionContext = { id: 'reference-pack-test' };
  const unitOfWork = {
    run: (operation) => operation(transactionContext),
    runAutocommit: (operation) => operation(transactionContext)
  };
  const questions = [
    question('QuestionId:true:1', 1, 0.35, '某地推出公共服务改革，下列最能削弱其论证的是？', [
      '样本只来自单一街道',
      '改革得到多数居民支持',
      '服务窗口数量有所增加',
      '其他地区也采取类似做法'
    ]),
    question('QuestionId:true:2', 2, 0.55, '研究者据此认为措施有效，下列质疑最有力的是？', [
      '实验组与对照组起点不同',
      '研究报告篇幅较长',
      '参与者来自多个年龄段',
      '研究采用了问卷方式'
    ]),
    question('QuestionId:true:3', 3, 0.75, '要使上述结论成立，最需要补充哪项前提？', [
      '观察期足以排除短期波动',
      '政策名称容易理解',
      '执行人员接受过培训',
      '材料使用了公开数据'
    ])
  ];
  const questionSet = {
    generationSpec: {},
    generationWorkflow: {},
    documents: [],
    lectures: [],
    questionSet: {
      id: 'QuestionSetId:true:1',
      status: 'ready',
      questionCount: questions.length
    },
    lectureLinks: [],
    questions,
    capabilityLinks: []
  };
  const queryLog = [];
  const contentRepository = {
    async queryQuestionSetLibrary(query) {
      queryLog.push(query);
      return [{
        id: 'QuestionSetId:true:1',
        examCycleId: 'ExamCycleId:1',
        capabilityNodeId: 'CapabilityNodeId:weaken',
        purpose: 'anchor',
        assessmentRole: 'anchor',
        module: 'judgment',
        questionCount: 3,
        practiceStatus: 'not_started',
        entryMode: 'self',
        originType: 'official',
        sourceId: 'QuestionSourceId:1',
        sourceMetadata: {
          sourceType: 'official',
          examType: 'provincial',
          examYear: 2026,
          province: '江苏'
        },
        createdAt: 1785000000000
      }];
    },
    async findQuestionSet() {
      return questionSet;
    }
  };
  const packs = new Map();
  const referencePackRepository = {
    find(id) {
      return Promise.resolve(packs.get(id));
    },
    findByContentHash(hash) {
      return Promise.resolve([...packs.values()].find((pack) => pack.contentHash === hash));
    },
    save(pack) {
      packs.set(pack.id, pack);
      return Promise.resolve();
    }
  };
  const builder = new content.BuildTrueQuestionReferencePack(
    unitOfWork,
    contentRepository,
    referencePackRepository,
    clock,
    ids
  );
  const firstPack = await builder.execute({
    examCycleId: 'ExamCycleId:1',
    capabilityNodeId: 'CapabilityNodeId:weaken'
  });
  assert(firstPack);
  assert.equal(firstPack.representativeQuestions.length, 3);
  assert.equal(firstPack.comparisonQuestions.length, 3);
  assert.equal(firstPack.policyVersion, 'true-question-reference.v2');
  assert.equal(firstPack.sourceQuestionCount, 3);
  assert.equal(firstPack.examScope.sampledQuestionCount, 3);
  assert.deepEqual(queryLog[0].capabilityNodeIds, ['CapabilityNodeId:weaken']);
  assert.deepEqual(queryLog[0].originTypes, ['official', 'imported', 'user_created']);
  const reusedPack = await builder.execute({
    examCycleId: 'ExamCycleId:1',
    capabilityNodeId: 'CapabilityNodeId:weaken'
  });
  assert.equal(reusedPack.id, firstPack.id);
  assert.equal(packs.size, 1);

  const generatedQuestion = generated(
    '新的政策评估同时控制地区差异和时间趋势，以下哪项最能削弱结论？',
    ['仍有关键变量未被记录', '样本规模超过往年', '报告公开了计算过程', '研究持续了两年']
  );
  const differenceValidator = new content.TrueQuestionStructuralDifferenceValidator();
  const accepted = differenceValidator.evaluate({
    raw: {},
    lecture: document('讲义'),
    questions: [generatedQuestion],
    referenceQuestionIds: ['QuestionId:true:1']
  }, firstPack);
  assert.equal(accepted.referenceQuestionIds[0], 'QuestionId:true:1');
  assert.equal(accepted.metrics.acceptedVariantCount, 1);

  const nearDuplicate = differenceValidator.evaluate({
    raw: {},
    lecture: document('讲义'),
    questions: [generated(
      '某地推出公共服务改革，下列最能削弱其论证的是？',
      ['样本只来自单一街道', '改革得到多数居民支持', '服务窗口数量有所增加', '其他地区也采取类似做法']
    )],
    referenceQuestionIds: ['QuestionId:true:1']
  }, firstPack);
  assert.equal(nearDuplicate.referenceQuestionIds[0], undefined);
  assert.equal(nearDuplicate.metrics.nearDuplicateCount, 1);
  assert.deepEqual(nearDuplicate.nearDuplicateIndexes, [0]);

  const commitBuilder = new content.GeneratedContentCommitBuilder(clock, ids);
  const commit = await commitBuilder.build({
    id: 'GenerationSpecId:1',
    examCycleId: 'ExamCycleId:1',
    capabilityNodeId: 'CapabilityNodeId:weaken',
    contentKind: 'lecture_with_questions',
    assessmentRole: 'practice',
    questionTemplateVersionId: 'QuestionTemplateVersionId:1',
    contentSchemaVersionId: 'ContentSchemaVersionId:question',
    promptVersionId: 'PromptVersionId:1',
    referencePackId: firstPack.id,
    referencePolicyVersion: firstPack.policyVersion,
    requestedCount: 1,
    difficulty: { min: 0.4, max: 0.6 },
    constraints: {},
    contextSnapshot: {
      capability: { name: '削弱论证', module: 'judgment' }
    },
    contentHash: 'sha256:generation',
    createdAt: 1785100000000
  }, {
    id: 'WorkflowId:1',
    examCycleId: 'ExamCycleId:1',
    generationSpecId: 'GenerationSpecId:1',
    workflowType: 'lecture_with_questions',
    status: 'committed',
    currentStep: 'complete',
    attemptCount: 1,
    validation: {},
    idempotencyKey: 'reference-pack-test',
    startedAt: 1785100000000,
    completedAt: 1785100000000,
    updatedAt: 1785100000000,
    version: 9
  }, 'ContentSchemaVersionId:lecture', {
    raw: {},
    lecture: document('削弱论证讲义'),
    questions: [generatedQuestion],
    referenceQuestionIds: ['QuestionId:true:1']
  }, firstPack);
  assert.equal(commit.bundle.questions[0].originType, 'ai_variant');
  assert.equal(commit.bundle.questions[0].isOfficial, false);
  assert.equal(commit.lineages.length, 1);
  assert.equal(commit.lineages[0].parentQuestionId, 'QuestionId:true:1');
  assert.equal(commit.lineages[0].derivationType, 'variant');

  const comparisonMigration = await readFile(path.join(
    webRoot,
    'src/capabilities/database/migrations/028_reference_pack_comparison_questions.sql'
  ), 'utf8');
  const migrationRegistry = await readFile(path.join(
    webRoot,
    'src/capabilities/database/migrations/tutorMigrations.ts'
  ), 'utf8');
  const comparisonChecksum = crypto.createHash('sha256').update(comparisonMigration).digest('hex');
  assert.match(comparisonMigration, /comparison_questions_json/);
  assert.match(migrationRegistry, /version:\s*28/);
  assert.match(migrationRegistry, new RegExp(`sha256:${comparisonChecksum}`));

  console.log('True-question reference-pack verification passed.');
} finally {
  await server.close();
}

function question(id, sequence, difficulty, prompt, options) {
  return {
    id,
    questionSetId: 'QuestionSetId:true:1',
    examCycleId: 'ExamCycleId:1',
    capabilityNodeId: 'CapabilityNodeId:weaken',
    questionTemplateVersionId: 'QuestionTemplateVersionId:1',
    sequence,
    difficulty,
    cognitiveLevel: 'application',
    purpose: 'anchor',
    assessmentRole: 'anchor',
    originType: 'official',
    sourceId: 'QuestionSourceId:1',
    sourceSequence: sequence,
    calibrationRole: 'anchor',
    isOfficial: true,
    content: generated(prompt, options),
    correctAnswer: { optionId: 'A' },
    qualityStatus: 'published',
    contentHash: `sha256:true-question-${sequence}`,
    contentSchemaVersionId: 'ContentSchemaVersionId:question',
    contentVersion: 1,
    generatorWorkflowId: 'WorkflowId:import',
    createdAt: 1785000000000
  };
}

function generated(prompt, options) {
  return {
    templateCode: 'single_choice',
    schemaVersion: 'question.single_choice.v2',
    capabilityCode: 'aptitude.judgment.weaken',
    prompt: document(prompt),
    options: options.map((text, index) => ({
      id: String.fromCharCode(65 + index),
      content: document(text)
    })),
    correctOptionId: 'A',
    explanation: document('A 项指出关键替代解释，其余选项不能动摇论证。')
  };
}

function document(source) {
  return {
    schemaVersion: 'content.v1',
    blocks: [{ id: `text:${source.slice(0, 8)}`, type: 'text', source }]
  };
}
