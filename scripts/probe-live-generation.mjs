import assert from 'node:assert/strict';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(scriptDirectory, '../web');
const apiKey = process.env.ZHANGL_AGENT_PROBE_API_KEY?.trim();
const baseUrl = process.env.ZHANGL_AGENT_PROBE_BASE_URL?.trim() || 'https://api.anthropic.com/v1';
const model = process.env.ZHANGL_AGENT_PROBE_MODEL?.trim();
const questionCount = Number(process.env.ZHANGL_AGENT_PROBE_QUESTION_COUNT || 4);
const probeCase = process.env.ZHANGL_AGENT_PROBE_CASE?.trim() || 'argument_structure';
const runEnrichment = process.env.ZHANGL_AGENT_PROBE_ENRICHMENT !== 'false';
const structuredMode = process.env.ZHANGL_AGENT_PROBE_STRUCTURED_MODE?.trim() || 'gateway';
const capabilityPreset = createCapabilityPresets()[probeCase];

if (!apiKey || !model) {
  throw new Error('Set ZHANGL_AGENT_PROBE_API_KEY and ZHANGL_AGENT_PROBE_MODEL before running the live probe.');
}
if (!capabilityPreset) {
  throw new Error(`Unknown ZHANGL_AGENT_PROBE_CASE: ${probeCase}`);
}
if (!Number.isInteger(questionCount) || questionCount < 1 || questionCount > 25) {
  throw new Error('ZHANGL_AGENT_PROBE_QUESTION_COUNT must be an integer from 1 to 25.');
}

class RecordingTransport {
  calls = [];

  constructor(transport) {
    this.transport = transport;
  }

  async send(request) {
    const call = {
      endpoint: new URL(request.url).pathname,
      startedAt: Date.now(),
      status: 0,
      latencyMs: 0
    };
    this.calls.push(call);
    const startedAt = performance.now();
    try {
      const response = await this.transport.send(request);
      call.status = response.status;
      return response;
    } finally {
      call.latencyMs = Math.round(performance.now() - startedAt);
    }
  }
}

const server = await createServer({
  root: webRoot,
  configFile: false,
  resolve: { alias: { '@': path.join(webRoot, 'src') } },
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: 'custom'
});

try {
  const [ai, content, corePolicy] = await Promise.all([
    server.ssrLoadModule('/src/capabilities/ai-runtime/public.ts'),
    server.ssrLoadModule('/src/modules/content/public.ts'),
    server.ssrLoadModule('/src/modules/content/application/PracticeCoreGenerationPolicy.ts')
  ]);
  const registry = new ai.PromptRegistry();
  registry.register(ai.structuredObjectivePromptV2);
  registry.register(ai.questionSetEnrichmentPromptV1);
  const compiler = new ai.PromptCompiler(registry);
  const transport = new RecordingTransport(new ai.FetchHttpTransport());
  const gateway = new ai.AnthropicGateway({ apiKey, baseUrl, model }, transport);
  const capability = capabilityPreset.capability;
  const context = {
    target: {
      examType: 'civil_service_provincial',
      examName: '江苏省公务员考试',
      phase: 'foundation',
      targetScore: 80,
      currentScore: 50
    },
    capability,
    learningEvidence: {
      hasMasteryProjection: false,
      evidenceLevel: 'self_reported',
      recentErrorTypes: [],
      currentLearningThread: `${capability.name}生成稳定性验证`
    },
    teachingPreferences: {
      teachingOrder: 'explain_then_practice',
      explanationDepth: 'deep',
      companionTone: 'coach'
    }
  };
  const generationPayload = {
    generationSpecId: 'GenerationSpecId:live-probe',
    examCycleId: 'ExamCycleId:live-probe',
    capabilityNodeId: capability.id,
    assessmentRole: 'practice',
    requestedCount: questionCount,
    difficulty: { min: 0.35, max: 0.55 },
    constraints: {
      sourcePolicy: 'ai_generated',
      selectionAuthority: 'user'
    },
    studentContext: context,
    trueQuestionReference: null
  };
  const coreCompiled = compiler.compile(
    ai.structuredObjectivePromptV2.promptCode,
    {
      QUESTION_COUNT: questionCount,
      ASSESSMENT_ROLE: 'practice',
      DIFFICULTY_MIN: 0.35,
      DIFFICULTY_MAX: 0.55
    },
    generationPayload,
    ai.structuredObjectivePromptV2.version
  );
  const coreSystem = corePolicy.practiceCoreSystem(coreCompiled.system, capability.code);
  const coreSchema = corePolicy.practiceCoreResponseSchema(coreCompiled.responseSchema, undefined, capability.code);
  const coreRequestSystem = structuredMode === 'prompt'
    ? appendStructuredOutputContract(coreSystem, coreSchema)
    : coreSystem;

  console.log(`Live probe: generating ${questionCount} answerable core questions for ${probeCase}...`);
  const coreCallStart = transport.calls.length;
  const coreStartedAt = performance.now();
  const coreResponse = await gateway.complete({
    system: coreRequestSystem,
    messages: [{ role: ai.ModelMessageRole.User, content: coreCompiled.user }],
    temperature: 0.2,
    maxOutputTokens: corePolicy.coreGenerationTokenBudget(questionCount, capability.code),
    ...(structuredMode === 'prompt' ? {} : { responseSchema: coreSchema }),
    requestId: `live-probe-core-${Date.now()}`
  }, AbortSignal.timeout(360_000));
  const coreLatencyMs = Math.round(performance.now() - coreStartedAt);
  const coreHttpCalls = transport.calls.slice(coreCallStart);
  const structuredCore = ai.parseStructuredJson(coreResponse.text);
  let parsed;
  try {
    parsed = new content.GeneratedContentParser().parseObject(
      structuredCore,
      capability.code
    );
  } catch (error) {
    console.error(JSON.stringify({
      phase: 'core_parse_failed',
      probeCase,
      latencyMs: coreLatencyMs,
      providerHttpCalls: summarizeCalls(coreHttpCalls),
      rootKeys: structuredCore && typeof structuredCore === 'object' && !Array.isArray(structuredCore)
        ? Object.keys(structuredCore)
        : [],
      responseCharacters: coreResponse.text.length,
      responsePreview: coreResponse.text.slice(0, 600),
      usage: coreResponse.usage,
      finishReason: coreResponse.finishReason,
      errorCode: error?.code,
      issues: error?.issues
    }, null, 2));
    throw error;
  }
  const quality = new content.StructuredObjectiveContentQualityValidator().validate(
    parsed,
    questionCount,
    capability.code
  );
  assert.equal(quality.valid, true, JSON.stringify(quality.blockingIssues));
  assert(
    parsed.lecture.blocks.length > 0,
    'Core response must contain a renderable lecture paired with the questions.'
  );
  assert.equal(parsed.questions.length, questionCount, 'Core response question count mismatch.');
  parsed.questions.forEach((question, index) => {
    assert(question.options.length >= 2, `Question ${index + 1} has fewer than two options.`);
    assert(
      question.options.some((option) => option.id === question.correctOptionId),
      `Question ${index + 1} answer does not reference an option.`
    );
  });
  console.log(JSON.stringify({
    phase: 'core',
    probeCase,
    structuredMode,
    latencyMs: coreLatencyMs,
    providerHttpCalls: summarizeCalls(coreHttpCalls),
    questionCount: parsed.questions.length,
    presentations: presentationHistogram(parsed.questions),
    readiness: quality.readiness,
    pendingBlocks: quality.pendingIssues.map((issue) => issue.block),
    usage: coreResponse.usage,
    finishReason: coreResponse.finishReason
  }, null, 2));
  capabilityPreset.assertPresentation(parsed.questions);

  if (!runEnrichment) {
    console.log(JSON.stringify({
      phase: 'total',
      probeCase,
      latencyMs: coreLatencyMs,
      providerHttpCallCount: coreHttpCalls.length
    }, null, 2));
  } else {
    const authorCore = structuredCore;
    const questions = Array.isArray(authorCore.questions) ? authorCore.questions : [];
    const enrichmentPayload = {
      questionSetId: 'QuestionSetId:live-probe',
      learningThreadId: 'LearningThreadId:live-probe',
      teachingBlueprintId: 'TeachingBlueprintId:live-probe',
      assessmentRole: 'practice',
      module: capability.module,
      difficulty: { min: 0.35, max: 0.55 },
      capability,
      learningEvidence: context.learningEvidence,
      teachingPreferences: context.teachingPreferences,
      missingBlocks: {
      lecture: false,
        explanationQuestionIds: questions.map((_, index) => `QuestionId:live-probe:${index + 1}`)
      },
    lectureQuestionSamples: [],
      explanationQuestions: questions.map((question, index) => enrichmentQuestion(question, index))
    };
    const enrichmentCompiled = compiler.compile(
      ai.questionSetEnrichmentPromptV1.promptCode,
      {},
      enrichmentPayload,
      ai.questionSetEnrichmentPromptV1.version
    );

    console.log('Live probe: enriching the same questions with lecture and explanations...');
    const enrichmentCallStart = transport.calls.length;
    const enrichmentStartedAt = performance.now();
    const enrichmentResponse = await gateway.complete({
      system: enrichmentCompiled.system,
      messages: [{ role: ai.ModelMessageRole.User, content: enrichmentCompiled.user }],
      temperature: 0.15,
      maxOutputTokens: Math.min(10_000, Math.max(2_500, 2_000 + questionCount * 900)),
      responseSchema: enrichmentCompiled.responseSchema,
      requestId: `live-probe-enrichment-${Date.now()}`
    }, AbortSignal.timeout(360_000));
    const enrichmentLatencyMs = Math.round(performance.now() - enrichmentStartedAt);
    const enrichmentHttpCalls = transport.calls.slice(enrichmentCallStart);
    const enrichment = ai.parseStructuredJson(enrichmentResponse.text);
    const explanations = Array.isArray(enrichment.explanations) ? enrichment.explanations : [];
    const expectedQuestionIds = new Set(enrichmentPayload.missingBlocks.explanationQuestionIds);
    assert.equal(explanations.length, questionCount, 'Enrichment response explanation count mismatch.');
    explanations.forEach((explanation, index) => {
      assert(
        expectedQuestionIds.has(explanation.questionId),
        `Explanation ${index + 1} references an unknown question.`
      );
    });
    const serializedEnrichment = JSON.stringify(enrichment);
    assert(serializedEnrichment.length > 0);
    console.log(JSON.stringify({
      phase: 'enrichment',
      probeCase,
      latencyMs: enrichmentLatencyMs,
      providerHttpCalls: summarizeCalls(enrichmentHttpCalls),
      lectureSectionCount: 0,
      explanationCount: explanations.length,
      usage: enrichmentResponse.usage,
      finishReason: enrichmentResponse.finishReason
    }, null, 2));
    console.log(JSON.stringify({
      phase: 'total',
      probeCase,
      latencyMs: coreLatencyMs + enrichmentLatencyMs,
      providerHttpCallCount: coreHttpCalls.length + enrichmentHttpCalls.length
    }, null, 2));
  }
} finally {
  await server.close();
}

function enrichmentQuestion(question, index) {
  return {
    questionId: `QuestionId:live-probe:${index + 1}`,
    sequence: index + 1,
    material: question.material ?? null,
    prompt: question.prompt,
    options: Array.isArray(question.options)
      ? question.options.map((option, optionIndex) => ({
          id: option.id || String.fromCharCode(65 + optionIndex),
          content: option.text ?? option.content ?? ''
        }))
      : [],
    correctOptionId: question.correctOptionId
  };
}

function summarizeCalls(calls) {
  return calls.map((call) => ({
    endpoint: call.endpoint,
    status: call.status,
    latencyMs: call.latencyMs
  }));
}

function appendStructuredOutputContract(system, schema) {
  return [
    system,
    '<structured_output>',
    '仅输出一个符合下列 JSON Schema 的 JSON 对象，不要输出 Markdown 代码围栏、解释或其他文字。',
    JSON.stringify(schema),
    '</structured_output>'
  ].join('\n');
}

function presentationHistogram(questions) {
  return questions.reduce((result, question) => {
    result[question.presentationCode] = (result[question.presentationCode] || 0) + 1;
    return result;
  }, {});
}

function createCapabilityPresets() {
  return {
    argument_structure: preset(
      'capability:aptitude:judgment:argument-structure',
      'aptitude.judgment.argument_structure',
      '论点、论据与论证结构识别',
      'judgment',
      ['aptitude.judgment.weaken', 'aptitude.judgment.strengthen']
    ),
    graphic_position: preset(
      'capability:aptitude:judgment:graphical:position',
      'aptitude.judgment.graphical.position',
      '位置与移动规律',
      'judgment',
      ['aptitude.judgment.graphical.count'],
      (questions) => {
        assert(
          questions.every((question) => question.presentationCode === 'graphic_choice'),
          'Graphic reasoning questions must use the proportional graphic presentation.'
        );
      }
    ),
    data_growth: preset(
      'capability:aptitude:data-analysis:growth',
      'aptitude.data_analysis.growth',
      '增长率与增长量',
      'data_analysis',
      ['aptitude.data_analysis.base_period', 'aptitude.data_analysis.proportion'],
      (questions) => {
        assert(
          questions.some((question) => question.presentationCode === 'data_material_choice'),
          'Data analysis probe must produce a shared renderable data material.'
        );
      }
    ),
    verbal_main_idea: preset(
      'capability:aptitude:verbal:reading:main-idea',
      'aptitude.verbal.main_idea',
      '片段阅读主旨概括',
      'verbal',
      ['aptitude.verbal.intention', 'aptitude.verbal.detail'],
      (questions) => {
        assert(
          questions.every((question) => (
            question.presentationCode === 'standard_choice'
            || question.presentationCode === 'long_reading_choice'
          )),
          'Verbal questions must use a standard or long-reading presentation.'
        );
      }
    ),
    quantity_engineering: preset(
      'capability:aptitude:quantity:application:engineering',
      'aptitude.quantity.engineering',
      '工程问题',
      'quantity',
      ['aptitude.quantity.travel', 'aptitude.quantity.profit']
    ),
    common_sense_law: preset(
      'capability:aptitude:common-sense:categories:law',
      'aptitude.common_sense.law',
      '法律常识',
      'common_sense',
      ['aptitude.common_sense.politics_economy']
    )
  };
}

function preset(id, code, name, module, related, assertPresentation = () => {}) {
  return {
    capability: {
      id,
      code,
      name,
      module,
      prerequisites: [],
      related
    },
    assertPresentation
  };
}
