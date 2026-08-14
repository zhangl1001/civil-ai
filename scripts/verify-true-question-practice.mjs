import assert from 'node:assert/strict';
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

async function main() {
  try {
    const [content, practice, truePractice, researchCriteria, labels, curriculum] = await Promise.all([
      server.ssrLoadModule('/src/modules/content/public.ts'),
      server.ssrLoadModule('/src/features/practice/PracticeCenterFeature.ts'),
      server.ssrLoadModule('/src/features/practice/TrueQuestionPracticeFeature.ts'),
      server.ssrLoadModule('/src/features/practice/TrueQuestionResearchCriteria.ts'),
      server.ssrLoadModule('/src/domain/labels.ts'),
      server.ssrLoadModule('/src/modules/curriculum/public.ts')
    ]);
    // Module display names come from the installed package, exactly as main.ts does.
    labels.installCurriculumLabels(curriculum.createBundledNationalCurriculum().capabilityNodes);
    verifySourcePresentation(content);
    await verifyLearningThreadResolution(practice);
    await verifyQuestionSetPagination(practice);
    await verifySpecialPracticeManifest(content, truePractice);
    verifyResearchCriteria(researchCriteria);
    await verifyRepositoryAndViewContracts();
    console.log('True-question practice verification passed.');
  } finally {
    await server.close();
  }
}

function verifyResearchCriteria(research) {
  const criteria = research.defaultTrueQuestionResearchCriteria({
    examName: '江苏省公务员考试',
    province: '江苏',
    module: 'judgment'
  });
  assert.equal(criteria.examType, research.TrueQuestionResearchExamType.Provincial);
  assert.equal(criteria.province, '江苏');
  assert.equal(criteria.maxQuestions, 5);
  assert.match(research.trueQuestionResearchScope(criteria), /江苏公务员考试；最近三年；行测判断推理/);
  const national = research.defaultTrueQuestionResearchCriteria({ examName: '国家公务员考试', province: '北京' });
  assert.equal(national.province, '全国');
}

async function verifyQuestionSetPagination(practice) {
  let receivedQuery;
  const rows = Array.from({ length: 13 }, (_, index) => ({
    id: `QuestionSetId:${String(index).padStart(2, '0')}`,
    createdAt: 10_000 - index
  }));
  const feature = new practice.PracticeCenterFeature({
    candidateRepository: { findCurrentCycle: async () => ({ examCycle: { id: 'ExamCycleId:1' } }) },
    contentRepository: {
      queryQuestionSetLibrary: async (query) => {
        receivedQuery = query;
        return rows;
      }
    }
  });
  const cursor = { createdAt: 20_000, id: 'QuestionSetId:cursor' };
  const page = await feature.listQuestionSetPage({ entryModes: ['self'], cursor, limit: 12 });
  assert.equal(receivedQuery.limit, 13, 'repository reads one look-ahead row instead of the full library');
  assert.deepEqual(receivedQuery.cursor, cursor);
  assert.deepEqual(receivedQuery.entryModes, ['self']);
  assert.equal(page.entries.length, 12);
  assert.equal(page.hasMore, true);
  assert.deepEqual(page.nextCursor, { createdAt: 9_989, id: 'QuestionSetId:11' });
}

async function verifySpecialPracticeManifest(content, truePractice) {
  const entries = [
    libraryEntry('QuestionSetId:a', 'QuestionSourceId:a', 2025),
    libraryEntry('QuestionSetId:b', 'QuestionSourceId:b', 2024)
  ];
  const bundles = new Map([
    [entries[0].id, questionBundle(entries[0], ['QuestionId:a1', 'QuestionId:a2', 'QuestionId:a3'])],
    [entries[1].id, questionBundle(entries[1], ['QuestionId:b1', 'QuestionId:b2', 'QuestionId:b3'])]
  ]);
  let query;
  let saved;
  const runtime = {
    candidateRepository: {
      findCurrentCycle: async () => ({ examCycle: { id: 'ExamCycleId:1' } })
    },
    contentRepository: {
      queryQuestionSetLibrary: async (value) => {
        query = value;
        return entries;
      },
      findQuestionSet: async (id) => bundles.get(id)
    },
    questionSourceRepository: {
      findSource: async () => ({ paperName: '江苏省考行测' })
    },
    startStructuredTeaching: {
      execute: async (command) => ({ thread: { id: `LearningThreadId:${command.capabilityNodeId}` } })
    },
    learningAssetStore: {
      save: async (command) => {
        saved = command;
        return { id: 'LearningAssetId:true-special' };
      }
    }
  };
  const feature = new truePractice.TrueQuestionPracticeFeature(runtime);
  assert.equal(await feature.start({
    mode: 'special',
    originType: content.QuestionOriginType.Official,
    module: 'judgment',
    examYear: 2025,
    province: '江苏',
    count: 5
  }), 'LearningAssetId:true-special');
  assert.deepEqual(query.originTypes, [content.QuestionOriginType.Official]);
  assert.deepEqual(query.modules, ['judgment']);
  assert.equal(saved.payload.manifestType, 'true_question_special');
  assert.equal(saved.payload.assessmentRole, 'anchor');
  assert.equal(saved.payload.questionCount, 5);
  assert.deepEqual(
    saved.payload.sections.flatMap((section) => section.questionIds),
    ['QuestionId:a1', 'QuestionId:a2', 'QuestionId:a3', 'QuestionId:b1', 'QuestionId:b2'],
    'selection must retain each source set question order'
  );

  await feature.start({ mode: 'retest', count: 3 });
  assert.deepEqual(query.practiceStatuses, ['completed']);
  assert.equal(saved.payload.manifestType, 'true_question_retest');
  assert.equal(saved.payload.assessmentRole, 'transfer');
}

function libraryEntry(id, sourceId, examYear) {
  return {
    id,
    examCycleId: 'ExamCycleId:1',
    capabilityNodeId: `CapabilityNodeId:${id}`,
    purpose: 'anchor',
    assessmentRole: 'anchor',
    module: 'judgment',
    questionCount: 3,
    practiceStatus: 'not_started',
    entryMode: 'self',
    originType: 'official',
    sourceId,
    sourceMetadata: {
      sourceType: 'official',
      examYear,
      province: '江苏',
      paperName: `${examYear}年江苏省考行测`
    },
    createdAt: examYear
  };
}

function questionBundle(entry, questionIds) {
  return {
    questionSet: {
      ...entry,
      generationSpecId: `GenerationSpecId:${entry.id}`,
      status: 'ready',
      contentVersion: 1
    },
    questions: questionIds.map((id, index) => ({ id, sequence: index + 1 }))
  };
}

function verifySourcePresentation(content) {
  assert.equal(content.questionOriginLabel(content.QuestionOriginType.Official), '官方真题');
  assert.equal(content.questionOriginLabel(content.QuestionOriginType.AiVariant), 'AI 变式');
  assert.equal(content.questionSourceTitle({
    sourceType: content.QuestionOriginType.Official,
    examYear: 2025,
    province: '江苏',
    paperName: '2025年江苏省考行测A类'
  }), '2025年江苏省考行测A类');
  assert.equal(content.questionSourceTitle({
    sourceType: content.QuestionOriginType.Imported,
    examYear: 2024,
    province: '浙江',
    sectionName: '判断推理'
  }), '2024年 浙江 判断推理');
}

async function verifyLearningThreadResolution(practice) {
  let starts = 0;
  const bundle = {
    questionSet: {
      id: 'QuestionSetId:true-1',
      capabilityNodeId: 'CapabilityNodeId:judgment',
      sourceId: 'QuestionSourceId:official-1'
    }
  };
  const runtime = {
    contentRepository: {
      findQuestionSet: async () => bundle
    },
    questionSourceRepository: {
      findSource: async () => ({ paperName: '2025年江苏省考行测A类' })
    },
    startStructuredTeaching: {
      execute: async (command) => {
        starts += 1;
        assert.equal(command.capabilityNodeId, bundle.questionSet.capabilityNodeId);
        assert.equal(command.gapSnapshot.source, 'true_question_practice');
        return { thread: { id: 'LearningThreadId:true-1' } };
      }
    }
  };
  const feature = new practice.PracticeCenterFeature(runtime);
  assert.equal(await feature.resolveLearningThread(bundle.questionSet.id), 'LearningThreadId:true-1');
  assert.equal(starts, 1);

  bundle.questionSet.learningThreadId = 'LearningThreadId:existing';
  assert.equal(await feature.resolveLearningThread(bundle.questionSet.id), 'LearningThreadId:existing');
  assert.equal(starts, 1, 'an existing learning thread must be reused');
}

async function verifyRepositoryAndViewContracts() {
  const [
    contract,
    sqlite,
    querySql,
    indexedDb,
    centerView,
    libraryActions,
    captureComposable,
    importFeature,
    importComposable,
    researchAgent,
    researchSheet,
    researchDraftSheet,
    sessionView,
    listComponent,
    infiniteScroll,
    submission
  ] = await Promise.all([
    readFile(path.join(webRoot, 'src/modules/content/contracts/ContentRepository.ts'), 'utf8'),
    readFile(path.join(webRoot, 'src/modules/content/adapters/SqliteContentRepository.ts'), 'utf8'),
    readFile(path.join(webRoot, 'src/modules/content/adapters/QuestionSetLibraryQuerySql.ts'), 'utf8'),
    readFile(path.join(webRoot, 'src/modules/content/adapters/IndexedDbContentRepository.ts'), 'utf8'),
    readFile(path.join(webRoot, 'src/features/practice/TutorPracticeCenterView.vue'), 'utf8'),
    readFile(path.join(webRoot, 'src/features/practice/TrueQuestionLibraryActions.vue'), 'utf8'),
    readFile(path.join(webRoot, 'src/features/practice/useTrueQuestionCapture.ts'), 'utf8'),
    readFile(path.join(webRoot, 'src/features/practice/TrueQuestionImportFeature.ts'), 'utf8'),
    readFile(path.join(webRoot, 'src/features/practice/useTrueQuestionImport.ts'), 'utf8'),
    readFile(path.join(webRoot, 'src/composition-root/agent/TrueQuestionResearchAgent.ts'), 'utf8'),
    readFile(path.join(webRoot, 'src/features/practice/TrueQuestionResearchSheet.vue'), 'utf8'),
    readFile(path.join(webRoot, 'src/features/practice/TrueQuestionImportDraftSheet.vue'), 'utf8'),
    readFile(path.join(webRoot, 'src/features/practice/TutorPracticeSessionView.vue'), 'utf8'),
    readFile(path.join(webRoot, 'src/features/practice/PracticeQuestionSetList.vue'), 'utf8'),
    readFile(path.join(webRoot, 'src/capabilities/design-system/components/InfiniteScrollPagination.vue'), 'utf8'),
    readFile(path.join(webRoot, 'src/modules/evidence/application/SubmitObjectiveSession.ts'), 'utf8')
  ]);
  assert.match(contract, /interface QuestionSetLibraryQuery/);
  assert.match(contract, /cursor\?: QuestionSetLibraryCursor/);
  assert.match(contract, /entryModes\?: readonly QuestionSetEntryMode\[\]/);
  assert.match(contract, /sourceMetadata\?: QuestionSetSourceSummary/);
  assert.match(sqlite, /LEFT JOIN question_sources source/);
  assert.match(sqlite, /appendQuestionSetLibraryQuery\(filters, params, query\)/);
  assert.match(querySql, /query\.entryModes/);
  assert.match(querySql, /question_set\.entry_mode/);
  assert.match(querySql, /question_set\.created_at < \?/);
  assert.match(indexedDb, /matchesLibraryQuery\(entry, query\)/);
  assert.match(indexedDb, /isBeforeCursor\(entry, query\.cursor\)/);
  assert.match(centerView, /<LandmarkIcon \/>真题/);
  assert.match(centerView, /showTrueFilterSheet/);
  assert.match(centerView, /<PracticeQuestionSetList/);
  assert.match(centerView, /resolveLearningThread\(set\.id\)/);
  assert.match(libraryActions, /筛选真题/);
  assert.match(libraryActions, /文件导入/);
  assert.match(libraryActions, /拍照导入/);
  assert.match(libraryActions, /AI 联网找题/);
  assert.match(libraryActions, /DOCUMENT_FILE_IMPORT_ACCEPT/);
  assert.doesNotMatch(libraryActions, /image\/\*/);
  assert.match(libraryActions, /confirm-text="去设置"/);
  assert.match(libraryActions, /useTrueQuestionCapture/);
  assert.match(captureComposable, /CameraPermissionError/);
  assert.match(captureComposable, /cameraCaptureService\.openAppSettings/);
  assert.match(captureComposable, /permissionStatus === 'restricted'/);
  assert.match(importFeature, /skillNames: \['tutor\.question_bank_ingestion'\]/);
  assert.match(importFeature, /待确认草稿/);
  assert.match(importComposable, /enqueueBusinessAgentTask\(\{/);
  assert.match(importComposable, /intent: 'trueQuestionResearch'/);
  assert.doesNotMatch(importComposable, /chat\.open\(.*research/i);
  assert.match(researchAgent, /allowedTools: \['web\.search', 'web\.read_page', 'question_bank\.scan'\]/);
  assert.match(researchAgent, /requiredToolName: 'question_bank\.scan'/);
  assert.match(researchAgent, /一次空结果不代表任务结束/);
  assert.match(researchAgent, /hasPublishableResearchCandidate/);
  assert.match(researchAgent, /至少 1 道 ready 候选/);
  assert.match(researchSheet, /考试类型/);
  assert.match(researchSheet, /年份范围/);
  assert.match(researchSheet, /行测模块/);
  assert.match(researchSheet, /创建联网研究任务/);
  assert.match(researchSheet, /不会直接写入正式题库/);
  assert.match(researchDraftSheet, /确认并导入/);
  assert.match(researchDraftSheet, /max-height:min\(42dvh,360px\)/);
  assert.match(sessionView, /question-source-meta/);
  assert.match(listComponent, /max-height:clamp\(238px,42dvh,390px\)/);
  assert.match(listComponent, /:scroll-root="viewport"/);
  assert.match(infiniteScroll, /root: props\.scrollRoot \?\? null/);
  assert.match(sessionView, /questionOriginLabel\(sourceMetadata\.sourceType\)/);
  assert.match(submission, /questionOriginType: question\.originType/);
  assert.match(submission, /questionSourceId: question\.sourceId/);
  assert.match(submission, /questionIsOfficial: question\.isOfficial/);
}

await main();
