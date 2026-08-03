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
