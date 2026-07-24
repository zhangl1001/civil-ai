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

async function verify() {
try {
  const [content, ai, curriculum] = await Promise.all([
    server.ssrLoadModule('/src/modules/content/public.ts'),
    server.ssrLoadModule('/src/capabilities/ai-runtime/public.ts'),
    server.ssrLoadModule('/src/modules/curriculum/public.ts')
  ]);
  const clock = new TestClock();
  const ids = new TestIds();
  const curriculumBundle = curriculum.createBundledNationalCurriculum();
  const cycle = candidateCycle(curriculumBundle.curriculum.id);
  const candidateRepository = { findCycle: async (id) => id === cycle.examCycle.id ? cycle : undefined };
  const curriculumRepository = { findBundle: async (id) => id === curriculumBundle.curriculum.id ? curriculumBundle : undefined };
  const metadata = content.createBundledContentMetadata();
  const contentRepository = new MemoryContentRepository(metadata);
  const generationRepository = new MemoryGenerationRepository();
  const outboxRepository = new MemoryOutboxRepository();
  const invocationRepository = new MemoryInvocationRepository();
  const unitOfWork = { run: async (work) => work({ transactionId: `tx:${clock.now()}` }) };
  const registry = new ai.PromptRegistry();
  registry.register(ai.weakeningQuestionPromptV1);
  const compiler = new ai.PromptCompiler(registry);
  const promptRepository = { findById: async (id) => id === ai.weakeningQuestionPromptV1.versionId ? ai.weakeningQuestionPromptV1 : undefined };
  const contextCompiler = new content.GenerationContextCompiler(candidateRepository, curriculumRepository);
  const createWorkflow = new content.CreateGenerationWorkflow(
    unitOfWork,
    generationRepository,
    contentRepository,
    outboxRepository,
    contextCompiler,
    ai.weakeningQuestionPromptV1.versionId,
    clock,
    ids
  );
  const runWorkflow = new content.RunWeakeningGenerationWorkflow(
    unitOfWork,
    generationRepository,
    contentRepository,
    promptRepository,
    invocationRepository,
    outboxRepository,
    compiler,
    clock,
    ids
  );
  const getStatus = new content.GetGenerationStatus(generationRepository, contentRepository);
  const command = generationCommand('generation:test:valid');
  const created = await createWorkflow.execute(command);
  const duplicate = await createWorkflow.execute(command);
  assert.equal(duplicate.workflow.id, created.workflow.id, 'creation must be idempotent');
  assert.equal(outboxRepository.events.length, 1, 'idempotent creation must publish one request event');
  assert.equal(created.spec.contextSnapshot.evidenceBoundary.hasMasteryProjection, false);
  assert.equal(created.spec.contextSnapshot.target.evidenceLevel, 'self_reported');
  assert.equal(created.spec.promptVersionId, ai.weakeningQuestionPromptV1.versionId);
  assert.equal(created.spec.learningThreadId, 'learning-thread:test');
  assert.equal(created.spec.teachingBlueprintId, 'teaching-blueprint:test');

  const validGateway = new StubGateway(ai.ProviderCode.Anthropic, JSON.stringify(validGeneratedContent()));
  const completed = await runWorkflow.execute(created.workflow.id, validGateway);
  assert.equal(completed.workflow.status, content.GenerationWorkflowStatus.Committed);
  assert.ok(completed.questionSetId);
  assert.equal(validGateway.callCount, 1);
  assert.equal(contentRepository.bundles.length, 1);
  assert.equal(contentRepository.bundles[0].questions.length, 1);
  assert.equal(contentRepository.bundles[0].lectures[0].learningThreadId, 'learning-thread:test');
  assert.equal(contentRepository.bundles[0].lectures[0].teachingBlueprintId, 'teaching-blueprint:test');
  assert.equal(contentRepository.bundles[0].questionSet.teachingBlueprintId, 'teaching-blueprint:test');
  assert.equal(invocationRepository.items[0].validationStatus, ai.InvocationValidationStatus.Valid);
  assert.equal(outboxRepository.events.length, 2, 'commit must publish one committed event');

  const repeatedRun = await runWorkflow.execute(created.workflow.id, validGateway);
  assert.equal(repeatedRun.questionSetId, completed.questionSetId, 'completed workflow must recover its result');
  assert.equal(validGateway.callCount, 1, 'completed workflow must not invoke the model twice');
  const recovered = await getStatus.execute(created.workflow.id);
  assert.equal(recovered.questionSetId, completed.questionSetId, 'status query must recover the committed result');

  const invalid = await createWorkflow.execute(generationCommand('generation:test:invalid'));
  const invalidGateway = new StubGateway(ai.ProviderCode.Anthropic, '{}');
  await assert.rejects(() => runWorkflow.execute(invalid.workflow.id, invalidGateway));
  const invalidState = await getStatus.execute(invalid.workflow.id);
  assert.equal(invalidState.workflow.status, content.GenerationWorkflowStatus.Failed);
  assert.equal(contentRepository.bundles.length, 1, 'invalid output must not publish content');
  assert.equal(invocationRepository.items.at(-1).validationStatus, ai.InvocationValidationStatus.Invalid);

  const retried = await runWorkflow.retry(invalid.workflow.id);
  assert.equal(retried.status, content.GenerationWorkflowStatus.Queued);
  const retriedResult = await runWorkflow.execute(invalid.workflow.id, new StubGateway(
    ai.ProviderCode.Anthropic,
    JSON.stringify(validGeneratedContent())
  ));
  assert.equal(retriedResult.workflow.status, content.GenerationWorkflowStatus.Committed);
  assert.equal(contentRepository.bundles.length, 2, 'retry must publish exactly one new result');

  const providerFailure = await createWorkflow.execute(generationCommand('generation:test:provider-failure'));
  const failingGateway = new StubGateway(ai.ProviderCode.Anthropic, '', new ai.ProviderGatewayError(
    'rate limited', ai.ProviderErrorKind.RateLimited, 429, 1000
  ));
  await assert.rejects(() => runWorkflow.execute(providerFailure.workflow.id, failingGateway));
  const failureInvocation = invocationRepository.items.at(-1);
  assert.equal(failureInvocation.validationStatus, ai.InvocationValidationStatus.Invalid);
  assert.equal(failureInvocation.errorCode, 'provider.rate_limited');

  const cancellable = await createWorkflow.execute(generationCommand('generation:test:cancel'));
  const cancelled = await runWorkflow.cancel(cancellable.workflow.id);
  assert.equal(cancelled.status, content.GenerationWorkflowStatus.Cancelled);
  assert.equal((await getStatus.execute(cancellable.workflow.id)).workflow.status, content.GenerationWorkflowStatus.Cancelled);
  console.log('Generation foundation verification passed.');
} finally {
  await server.close();
}
}

class TestClock {
  value = 1_784_016_000_000;
  now() { return ++this.value; }
  monotonicNowMs() { return ++this.value; }
}

class TestIds {
  sequence = 0;
  next(namespace) { return `${namespace}:test:${++this.sequence}`; }
}

class MemoryGenerationRepository {
  byWorkflow = new Map();
  byIdempotency = new Map();
  async create(aggregate) {
    if (this.byIdempotency.has(aggregate.workflow.idempotencyKey)) throw new Error('duplicate idempotency key');
    this.byWorkflow.set(aggregate.workflow.id, aggregate);
    this.byIdempotency.set(aggregate.workflow.idempotencyKey, aggregate.workflow.id);
  }
  async replaceWorkflow(workflow, expectedVersion) {
    const current = this.byWorkflow.get(workflow.id);
    if (!current || current.workflow.version !== expectedVersion || workflow.version !== expectedVersion + 1) {
      throw new Error(`Generation workflow version conflict: ${workflow.id}`);
    }
    this.byWorkflow.set(workflow.id, { spec: current.spec, workflow });
  }
  async findByWorkflowId(id) { return this.byWorkflow.get(id); }
  async findByIdempotencyKey(key) {
    const id = this.byIdempotency.get(key);
    return id ? this.byWorkflow.get(id) : undefined;
  }
}

class MemoryContentRepository {
  bundles = [];
  constructor(metadata) { this.metadata = metadata; }
  async findPublishedSchema(code) {
    return this.metadata.schemaVersions.find((item) => item.schemaCode === code && item.status === 'published');
  }
  async findPublishedQuestionTemplate(code) {
    return this.metadata.questionTemplateVersions.find((item) => item.templateCode === code && item.status === 'published');
  }
  async commitQuestionSet(bundle) {
    if (this.bundles.some((item) => item.questionSet.id === bundle.questionSet.id)) throw new Error('duplicate question set');
    this.bundles.push(bundle);
  }
  async findQuestionSet(id) { return this.bundles.find((item) => item.questionSet.id === id); }
  async findQuestionSetByGenerationSpec(id) { return this.bundles.find((item) => item.generationSpec.id === id); }
}

class MemoryOutboxRepository {
  events = [];
  async append(event) {
    if (this.events.some((item) => item.idempotencyKey === event.idempotencyKey)) throw new Error('duplicate outbox event');
    this.events.push(event);
  }
}

class MemoryInvocationRepository {
  items = [];
  async append(invocation) { this.items.push(invocation); }
  async updateResult(id, result) {
    const index = this.items.findIndex((item) => item.id === id);
    assert.notEqual(index, -1, `missing invocation ${id}`);
    this.items[index] = { ...this.items[index], ...result };
  }
  async updateValidation(id, status, errorCode) {
    const index = this.items.findIndex((item) => item.id === id);
    assert.notEqual(index, -1, `missing invocation ${id}`);
    this.items[index] = { ...this.items[index], validationStatus: status, errorCode };
  }
  async listByWorkflow(id) { return this.items.filter((item) => item.workflowId === id); }
}

class StubGateway {
  model = 'test-model';
  callCount = 0;
  constructor(provider, text, failure) {
    this.provider = provider;
    this.text = text;
    this.failure = failure;
  }
  async complete() {
    this.callCount += 1;
    if (this.failure) throw this.failure;
    return {
      text: this.text,
      providerRequestId: `provider-request:${this.callCount}`,
      finishReason: 'end_turn',
      usage: { inputTokens: 1200, outputTokens: 900 }
    };
  }
}

function generationCommand(idempotencyKey) {
  return {
    idempotencyKey,
    examCycleId: 'exam-cycle:test',
    learningThreadId: 'learning-thread:test',
    teachingBlueprintId: 'teaching-blueprint:test',
    capabilityNodeId: 'capability:aptitude:judgment:weaken',
    assessmentRole: 'practice',
    requestedCount: 1,
    difficultyMin: 0.35,
    difficultyMax: 0.55,
    constraints: { sourcePolicy: 'ai_generated' }
  };
}

function candidateCycle(curriculumVersionId) {
  const now = 1_784_016_000_000;
  return {
    project: { id: 'project:test', name: '测试备考周期', status: 'active', createdAt: now, updatedAt: now, version: 1 },
    profile: { id: 'profile:test', projectId: 'project:test', timeZone: 'Asia/Shanghai', currentState: {}, extension: {}, createdAt: now, updatedAt: now, version: 1 },
    examCycle: {
      id: 'exam-cycle:test', projectId: 'project:test', examType: 'civil_service_national', examName: '国家公务员考试',
      examDate: '2026-11-29', timeZone: 'Asia/Shanghai', phase: 'foundation', status: 'active',
      curriculumVersionId, createdAt: now, updatedAt: now, version: 1
    },
    scoreTargets: [{
      id: 'score-target:test', examCycleId: 'exam-cycle:test', subject: 'aptitude', targetScore: 80, maxScore: 100,
      source: 'candidate', status: 'active', effectiveFrom: now, createdAt: now
    }],
    scoreMeasurements: [{
      id: 'score-measurement:test', examCycleId: 'exam-cycle:test', subject: 'aptitude', module: 'judgment',
      score: 50, maxScore: 100, measurementType: 'self_report', source: 'onboarding', measuredAt: now,
      confidence: 0.25, metadata: {}, createdAt: now
    }],
    studyConstraints: {
      id: 'constraints:test', examCycleId: 'exam-cycle:test', studyMode: 'working', weeklyStudyDays: 6,
      weekdayMinutes: 120, weekendMinutes: 240, maxFocusMinutes: 45, availableWindows: [], interruptionRisks: [], updatedAt: now, version: 1
    },
    learningPreferences: {
      id: 'preferences:test', examCycleId: 'exam-cycle:test', teachingOrder: 'explain_then_practice',
      explanationDepth: 'deep', proactiveLevel: 'high', companionTone: 'coach', quietHours: [], accessibility: {}, extension: {}, updatedAt: now, version: 1
    },
    policyBindings: []
  };
}

function document(id, source) {
  return { schemaVersion: 'content.v1', blocks: [{ id, type: 'markdown', source }] };
}

function validGeneratedContent() {
  const lectureParagraph = '削弱论证的核心不是寻找与结论相反的话，而是先识别论点、论据及二者之间的推理桥梁，再判断选项是否真正降低结论成立的可能性。面对因果论证，需要依次检查替代原因、因果倒置、样本代表性、实验条件差异和关键条件缺失，并比较不同削弱方式对核心链条的影响强度。';
  return {
    lecture: {
      schemaVersion: 'content.v1',
      blocks: Array.from({ length: 6 }, (_, index) => ({
        id: `lecture:block:${index + 1}`,
        type: 'markdown',
        source: `## 第${index + 1}节\n${lectureParagraph}${lectureParagraph}`
      }))
    },
    questions: [{
      templateCode: 'single_choice',
      schemaVersion: 'question.single_choice.v1',
      material: document('question:material', '某市上线新的公交换乘提醒功能后三个月，使用公共交通通勤的居民比例明显上升。市交通部门据此认为，该提醒功能能够有效促使原本驾车通勤的居民改乘公共交通。'),
      prompt: document('question:prompt', '以下哪项如果为真，最能削弱市交通部门关于提醒功能促使居民改变通勤方式的结论？'),
      options: [
        { id: 'A', content: document('option:A', '同期市中心大幅提高了工作日停车收费标准') },
        { id: 'B', content: document('option:B', '多数公交站点都张贴了功能使用说明海报') },
        { id: 'C', content: document('option:C', '使用该功能的居民普遍关注道路拥堵信息') },
        { id: 'D', content: document('option:D', '部分居民希望提醒功能增加语音播报选项') }
      ],
      correctOptionId: 'A',
      explanation: document(
        'question:explanation',
        '题干由公共交通通勤比例上升，推出提醒功能促使原驾车居民改乘公交，属于由时间先后推断因果。A项指出同期停车成本显著上升，提供了能够独立解释通勤方式变化的替代原因，直接切断提醒功能与结果之间的唯一因果联系，因此削弱力度最强。B项只是说明推广方式，不能证明行为变化由提醒功能造成；C项描述使用者特征，没有比较使用前后的通勤选择；D项只涉及产品偏好，与居民是否改变通勤方式无关。'
      )
    }]
  };
}

await verify();
