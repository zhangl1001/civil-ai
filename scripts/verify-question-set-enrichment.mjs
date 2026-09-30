import assert from 'node:assert/strict';
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
  const [content, strategyModule] = await Promise.all([
    server.ssrLoadModule('/src/modules/content/public.ts'),
    server.ssrLoadModule('/src/composition-root/agent/QuestionSetContentEnrichmentStrategy.ts')
  ]);
  let bundle = questionSetBundle(8);
  let activeInvocations = 0;
  let peakInvocations = 0;
  let invocationCount = 0;
  const appliedQuestionIds = [];
  const strategy = strategyModule.createQuestionSetContentEnrichmentStrategy({
    contentRepository: {
      findQuestionSet: async () => bundle
    },
    promptCompiler: {
      compile: (_code, _variables, payload) => ({
        system: 'Return the requested structured explanation.',
        user: JSON.stringify(payload),
        responseSchema: {}
      })
    },
    invokeAgentModel: {
      execute: async (command) => {
        invocationCount += 1;
        activeInvocations += 1;
        peakInvocations = Math.max(peakInvocations, activeInvocations);
        const payload = JSON.parse(command.messages[0].content);
        const questionIds = payload.missingBlocks.explanationQuestionIds;
        await delay(15 + (invocationCount % 3) * 5);
        activeInvocations -= 1;
        return {
          text: JSON.stringify({
            explanations: questionIds.map((questionId) => ({
              questionId,
              explanation: fullExplanation(questionId)
            }))
          })
        };
      }
    },
    applyEnrichment: {
      execute: async (_questionSetId, enrichment) => {
        const explanations = enrichment.explanations;
        appliedQuestionIds.push(...explanations.keys());
        bundle = {
          ...bundle,
          questionSet: {
            ...bundle.questionSet,
            contentVersion: bundle.questionSet.contentVersion + 1
          },
          questions: bundle.questions.map((question) => ({
            ...question,
            content: {
              ...question.content,
              explanation: explanations.get(question.id) || question.content.explanation
            }
          }))
        };
      }
    },
    updateProgress: { execute: async () => undefined }
  });

  await strategy.execute({
    run: {
      id: 'AgentRunId:enrichment-test',
      targetResourceId: bundle.questionSet.id,
      inputSnapshot: {},
      checkpoint: {}
    },
    events: []
  }, {
    provider: 'anthropic',
    model: 'test',
    capabilities: { multimodalInput: false },
    complete: async () => {
      throw new Error('The invocation stub should own model execution');
    }
  });

  assert.equal(invocationCount, 3, 'eight explanations should be generated in three compact shards');
  assert.equal(peakInvocations, 3, 'explanation shards should use the bounded three-way parallel limit');
  assert.equal(new Set(appliedQuestionIds).size, 8, 'every completed explanation must be merged exactly once');
  assert.equal(
    content.findQuestionSetEnrichmentNeeds(bundle).explanationQuestionIds.length,
    0,
    'all question explanations must be complete after parallel enrichment'
  );

  let recoveryBundle = questionSetBundle(5);
  let groupedFailures = 0;
  let individualRecoveries = 0;
  const recoveryStrategy = strategyModule.createQuestionSetContentEnrichmentStrategy({
    contentRepository: { findQuestionSet: async () => recoveryBundle },
    promptCompiler: {
      compile: (_code, _variables, payload) => ({
        system: 'Return the requested structured explanation.',
        user: JSON.stringify(payload),
        responseSchema: {}
      })
    },
    invokeAgentModel: {
      execute: async (command) => {
        const payload = JSON.parse(command.messages[0].content);
        const questionIds = payload.missingBlocks.explanationQuestionIds;
        if (questionIds.length > 1) {
          groupedFailures += 1;
          throw new Error('provider rejected grouped structured output');
        }
        individualRecoveries += 1;
        return {
          text: JSON.stringify({
            explanations: [{
              questionId: questionIds[0],
              explanation: fullExplanation(questionIds[0])
            }]
          })
        };
      }
    },
    applyEnrichment: {
      execute: async (_questionSetId, enrichment) => {
        recoveryBundle = applyExplanations(recoveryBundle, enrichment.explanations);
      }
    },
    updateProgress: { execute: async () => undefined }
  });
  await recoveryStrategy.execute({
    run: {
      id: 'AgentRunId:enrichment-recovery-test',
      targetResourceId: recoveryBundle.questionSet.id,
      inputSnapshot: {},
      checkpoint: {}
    },
    events: []
  }, {
    provider: 'anthropic',
    model: 'test',
    capabilities: { multimodalInput: false },
    complete: async () => { throw new Error('The invocation stub should own model execution'); }
  });
  assert.equal(groupedFailures, 2, 'failed grouped shards should not be retried wholesale');
  assert.equal(individualRecoveries, 5, 'only missing explanations should use single-question recovery');
  assert.equal(
    content.findQuestionSetEnrichmentNeeds(recoveryBundle).explanationQuestionIds.length,
    0,
    'single-question recovery must complete every failed grouped explanation'
  );

  const cancellationController = new AbortController();
  let appliedAfterCancellation = 0;
  const cancelledStrategy = strategyModule.createQuestionSetContentEnrichmentStrategy({
    contentRepository: {
      findQuestionSet: async () => questionSetBundle(3)
    },
    promptCompiler: {
      compile: (_code, _variables, payload) => ({
        system: 'Return the requested structured explanation.',
        user: JSON.stringify(payload),
        responseSchema: {}
      })
    },
    invokeAgentModel: {
      execute: async (command, _gateway, signal) => {
        await abortableDelay(100, signal);
        const payload = JSON.parse(command.messages[0].content);
        const questionId = payload.missingBlocks.explanationQuestionIds[0];
        return {
          text: JSON.stringify({
            explanations: [{
              questionId,
              explanation: fullExplanation(questionId)
            }]
          })
        };
      }
    },
    applyEnrichment: {
      execute: async () => {
        appliedAfterCancellation += 1;
      }
    },
    updateProgress: { execute: async () => undefined }
  });
  const cancelled = cancelledStrategy.execute({
    run: {
      id: 'AgentRunId:cancelled-enrichment',
      targetResourceId: 'QuestionSetId:enrichment-test',
      inputSnapshot: {},
      checkpoint: {}
    },
    events: []
  }, {
    provider: 'anthropic',
    model: 'test',
    capabilities: { multimodalInput: false },
    complete: async () => {
      throw new Error('The invocation stub should own model execution');
    }
  }, cancellationController.signal);
  cancellationController.abort(new Error('user cancelled'));
  await assert.rejects(cancelled, /user cancelled/);
  assert.equal(appliedAfterCancellation, 0, 'cancelled enrichment must not commit late shard results');
  await verifiesManifestPaperSurvivesCompletion();
  await verifiesManifestSelectionSurvivesCompletion();
  console.log('Question-set enrichment verification passed (8 questions, 3 compact requests, peak concurrency 3).');
} finally {
  await server.close();
}

function questionSetBundle(questionCount) {
  const lectureDocument = textDocument('lecture:block', '配套讲义');
  return {
    questionSet: {
      id: 'QuestionSetId:enrichment-test',
      examCycleId: 'ExamCycleId:test',
      learningThreadId: 'LearningThreadId:test',
      teachingBlueprintId: 'TeachingBlueprintId:test',
      capabilityNodeId: 'CapabilityNodeId:test',
      assessmentRole: 'practice',
      module: 'judgment',
      questionCount,
      contentVersion: 1
    },
    generationSpec: {
      difficulty: { min: 0.3, max: 0.6 },
      contextSnapshot: {
        capability: { name: '论证结构识别' },
        learningEvidence: null,
        teachingPreferences: null
      }
    },
    documents: [{
      id: 'ContentDocumentId:lecture',
      documentType: 'lecture',
      title: '配套讲义',
      content: lectureDocument
    }],
    lectures: [{
      id: 'LectureId:test',
      contentDocumentId: 'ContentDocumentId:lecture'
    }],
    lectureLinks: [],
    questions: Array.from({ length: questionCount }, (_, index) => {
      const questionId = `QuestionId:test:${index + 1}`;
      return {
        id: questionId,
        sequence: index + 1,
        content: {
          templateCode: 'single_choice',
          presentationCode: 'standard_choice',
          schemaVersion: 'question.single_choice.v2',
          capabilityCode: 'aptitude.judgment.argument_structure',
          prompt: textDocument(`${questionId}:prompt`, `第 ${index + 1} 题`),
          options: ['A', 'B', 'C', 'D'].map((id) => ({
            id,
            content: textDocument(`${questionId}:option:${id}`, `选项 ${id}`)
          })),
          correctOptionId: 'A',
          explanation: {
            schemaVersion: 'content.v1',
            blocks: [{
              id: `${questionId}:knowledge`,
              type: 'callout',
              kind: 'conclusion',
              title: '结论与考点',
              blocks: [textBlock(`${questionId}:knowledge:text`, '**考点：论证结构识别**')]
            }]
          }
        }
      };
    })
  };
}

function applyExplanations(bundle, explanations) {
  return {
    ...bundle,
    questionSet: {
      ...bundle.questionSet,
      contentVersion: bundle.questionSet.contentVersion + 1
    },
    questions: bundle.questions.map((question) => ({
      ...question,
      content: {
        ...question.content,
        explanation: explanations.get(question.id) || question.content.explanation
      }
    }))
  };
}

function fullExplanation(questionId) {
  return {
    knowledgePoint: '论证结构识别',
    conclusion: '先识别结论，再判断论据如何支持结论。',
    steps: ['定位结论', '识别论据', '核对论证关系'],
    optionAnalysis: ['A', 'B', 'C', 'D'].map((optionId) => ({
      optionId,
      verdict: optionId === 'A' ? 'correct' : 'incorrect',
      analysis: optionId === 'A' ? '该项准确对应论证关系。' : '该项不符合题干论证关系。'
    })),
    pitfalls: ['不要把背景信息误认为结论。']
  };
}

function textDocument(id, source) {
  return { schemaVersion: 'content.v1', blocks: [textBlock(id, source)] };
}

function textBlock(id, source) {
  return { id, type: 'text', source };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function abortableDelay(ms, signal) {
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
}

/**
 * Explanations finish per question set while a merged paper (mock, redo) is
 * open. The paper carries its first set's id, so swapping completed sets in by
 * id used to replace the whole 60-question paper with that first set.
 */
async function verifiesManifestPaperSurvivesCompletion() {
  const { applyCompletedQuestionSets } = await server.ssrLoadModule('/src/features/practice/PracticeSessionFeature.ts');
  const set = (id, questionIds, explained = false) => ({
    questionSet: { id, module: `module:${id}`, questionCount: questionIds.length },
    questions: questionIds.map((questionId) => ({ id: questionId, content: { explanation: explained ? `解析 ${questionId}` : '' } })),
    documents: [{ id: `document:${id}` }],
    lectures: [{ id: `lecture:${id}` }],
    lectureLinks: [],
    capabilityLinks: []
  });
  const first = set('set:first', ['q1', 'q2']);
  const second = set('set:second', ['q3', 'q4']);
  const paper = {
    ...first,
    documents: [],
    lectures: [],
    questions: [...first.questions, ...second.questions],
    questionSet: { ...first.questionSet, module: '行测模考', questionCount: 4 }
  };
  const sections = [
    { bundle: first, learningThreadId: 'thread:first', module: '判断推理' },
    { bundle: second, learningThreadId: 'thread:second', module: '言语理解' }
  ];
  const completedFirst = set('set:first', ['q1', 'q2'], true);
  const next = applyCompletedQuestionSets({ bundle: paper, sections }, [completedFirst]);
  assert.equal(next.bundle.questions.length, 4, 'the merged paper keeps every section after its first set completes');
  assert.equal(next.bundle.questionSet.module, '行测模考', 'the paper keeps its own title');
  assert.equal(next.bundle.lectures.length, 0, 'a merged paper never gains a single set lecture tab');
  assert.equal(next.bundle.questions[0].content.explanation, '解析 q1', 'completed explanations reach the paper');
  assert.equal(next.sections[0].bundle, completedFirst);
  assert.equal(next.sections[1].bundle, second);
  const single = applyCompletedQuestionSets({ bundle: first, sections: [] }, [completedFirst]);
  assert.equal(single.bundle, completedFirst, 'a single set session still takes its completed bundle');
}

// R14 / ui-second-pass: enrichment may update content, never widen or reorder a selection.
async function verifiesManifestSelectionSurvivesCompletion() {
  const { PracticeSessionFeature, applyCompletedQuestionSets } = await server.ssrLoadModule('/src/features/practice/PracticeSessionFeature.ts');
  const { submitPracticeBundle } = await server.ssrLoadModule('/src/features/practice/SubmitPracticeBundle.ts');
  const { LearningAssetKind } = await server.ssrLoadModule('/src/modules/content/public.ts');
  const makeSet = (id, count) => {
    const value = questionSetBundle(count);
    return { ...value, capabilityLinks: [], questionSet: { ...value.questionSet, id, status: 'ready' },
      generationSpec: { ...value.generationSpec, constraints: {} },
      questions: value.questions.map((question, index) => ({ ...question, id: `${id}-q${index}` })) };
  };
  const sets = { setA: makeSet('setA', 12), setB: makeSet('setB', 20) };
  const selectedIds = ['setA-q7', 'setA-q3', 'setB-q1'];
  const sections = [
    { questionSetId: 'setA', learningThreadId: 'tA', questionIds: selectedIds.slice(0, 2) },
    { questionSetId: 'setB', learningThreadId: 'tB', questionIds: selectedIds.slice(2) }
  ];
  const feature = new PracticeSessionFeature({
    learningAssetStore: { find: async () => ({ kind: LearningAssetKind.PracticeManifest, payload: { sections, restorePrevious: false } }) },
    contentRepository: { findQuestionSet: async id => sets[id] },
    candidateRepository: { findCurrentCycle: async () => undefined },
    ensureQuestionSetEnrichment: { execute: async () => {} }, questionSourceRepository: {}
  });
  const loaded = await feature.load({ manifestId: 'subset-manifest' });
  assert.deepEqual(loaded.bundle.questions.map(q => q.id), selectedIds);
  let next = { bundle: loaded.bundle, sections: loaded.manifestSections };
  const controller = new AbortController();
  await assert.rejects(feature.waitForCompleteContent(['setA', 'setB'], {
    signal: controller.signal, onUpdate: complete => {
      next = applyCompletedQuestionSets(next, complete);
      controller.abort(new Error('verified first poll'));
    }
  }), /verified first poll/);
  assert.deepEqual(next.bundle.questions.map(q => q.id), selectedIds);
  assert.deepEqual(next.sections.map(s => s.bundle.questionSet.questionCount), [2, 1]);
  next = applyCompletedQuestionSets(next, [sets.setB, sets.setA]);
  assert.deepEqual(next.bundle.questions.map(q => q.id), selectedIds, 'repeated completion preserves manifest order');
  const submitted = [];
  for (const section of next.sections) await submitPracticeBundle({
    runtime: { submitObjectiveSession: { execute: async command => submitted.push(command) } },
    bundle: section.bundle, learningThreadId: section.learningThreadId, submissionScope: 'subset',
    startedAt: Date.now(), answers: {}, elapsedByQuestion: {}, answerChanges: {}
  });
  assert.deepEqual(submitted.flatMap(command => command.questionIds), selectedIds);
  assert.throws(() => applyCompletedQuestionSets(next, [{ ...sets.setA, questions: sets.setA.questions.filter(q => q.id !== 'setA-q7') }]), /部分题目已不可用/);
  const repeatedSource = { bundle: next.bundle, sections: [next.sections[0], { ...next.sections[0], bundle: { ...next.sections[0].bundle, questions: [sets.setA.questions[1]] } }] };
  assert.deepEqual(applyCompletedQuestionSets(repeatedSource, [sets.setA]).bundle.questions.map(q => q.id), ['setA-q7', 'setA-q3', 'setA-q1']);
  sections[0].questionIds = ['setA-q7', 'setA-q7'];
  await assert.rejects(feature.load({ manifestId: 'duplicate-manifest' }), /重复题目/);
  console.log('R14 passed: 12+20 source questions retain the selected 3 in manifest order through polling and submission.');
}
