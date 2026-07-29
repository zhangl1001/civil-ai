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
  const [content, ai, curriculum, corePolicy] = await Promise.all([
    server.ssrLoadModule('/src/modules/content/public.ts'),
    server.ssrLoadModule('/src/capabilities/ai-runtime/public.ts'),
    server.ssrLoadModule('/src/modules/curriculum/public.ts'),
    server.ssrLoadModule('/src/modules/content/application/PracticeCoreGenerationPolicy.ts')
  ]);
  assert.match(
    corePolicy.practiceCoreSystem('base', 'aptitude.data_analysis.growth'),
    /materialGroups/,
    'data analysis must receive its shared-material structural contract'
  );
  assert.match(
    corePolicy.practiceCoreSystem('base', 'aptitude.judgment.graphical.position'),
    /viewBox/,
    'graphic reasoning must receive its proportional SVG structural contract'
  );
  assert(
    corePolicy.coreGenerationTokenBudget(2, 'aptitude.data_analysis.growth')
      > corePolicy.coreGenerationTokenBudget(2, 'aptitude.judgment.argument_structure'),
    'complex render structures must receive a bounded type-specific token allowance'
  );
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
  const executeWork = async (work) => work({ transactionId: `tx:${clock.now()}` });
  const unitOfWork = { run: executeWork, runAutocommit: executeWork };
  const registry = new ai.PromptRegistry();
  registry.register(ai.structuredObjectivePromptV2);
  const compiler = new ai.PromptCompiler(registry);
  const promptRepository = { findById: async (id) => id === ai.structuredObjectivePromptV2.versionId ? ai.structuredObjectivePromptV2 : undefined };
  const contextCompiler = new content.GenerationContextCompiler(candidateRepository, curriculumRepository);
  const referencePackBuilder = { execute: async () => undefined };
  const referencePackRepository = { find: async () => undefined };
  const questionSourceRepository = { saveLineages: async () => undefined };
  const createWorkflow = new content.CreateGenerationWorkflow(
    unitOfWork,
    generationRepository,
    contentRepository,
    outboxRepository,
    contextCompiler,
    referencePackBuilder,
    ai.structuredObjectivePromptV2.versionId,
    clock,
    ids
  );
  const runWorkflow = new content.RunStructuredObjectiveGenerationWorkflow(
    unitOfWork,
    generationRepository,
    contentRepository,
    promptRepository,
    invocationRepository,
    outboxRepository,
    referencePackRepository,
    questionSourceRepository,
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
  assert.equal(created.spec.contextSnapshot.learningEvidence.hasMasteryProjection, false);
  assert.equal(created.spec.contextSnapshot.target.evidenceLevel, 'self_reported');
  assert.equal(created.spec.promptVersionId, ai.structuredObjectivePromptV2.versionId);
  assert.equal(created.spec.learningThreadId, 'learning-thread:test');
  assert.equal(created.spec.teachingBlueprintId, 'teaching-blueprint:test');

  const validGateway = new StubGateway(ai.ProviderCode.Anthropic, JSON.stringify(validGeneratedContent()));
  const completed = await runWorkflow.execute(created.workflow.id, validGateway);
  assert.equal(completed.workflow.status, content.GenerationWorkflowStatus.Committed);
  assert.ok(completed.questionSetId);
  assert.equal(validGateway.callCount, 1);
  assert.equal(
    typeof validGateway.requests[0].responseSchema.properties.lecture,
    'object',
    'the foreground generation turn must produce the lecture and questions as one teaching unit'
  );
  assert(
    validGateway.requests[0].responseSchema.required.includes('lecture'),
    'the paired lecture is a required foreground block'
  );
  assert.deepEqual(
    validGateway.requests[0].responseSchema.properties.questions.items.properties.explanation.required,
    ['knowledgePoint'],
    'the foreground turn must publish the question knowledge point without expanding the detailed explanation'
  );
  assert.match(
    validGateway.requests[0].system,
    /本轮必须同时生成配套 lecture 和可立即作答的核心题目包/,
    'prompt-mode providers must receive the same foreground delivery boundary'
  );
  assert.match(
    validGateway.requests[0].system,
    /资料分析题|图形推理题|本轮交付策略/,
    'foreground generation must retain a capability-aware structural contract'
  );
  assert(
    validGateway.requests[0].maxOutputTokens < 5_000,
    'a one-question core generation request must keep a bounded output budget'
  );
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

  const advisory = await createWorkflow.execute(generationCommand('generation:test:advisory'));
  const advisorySource = advisoryGeneratedContent();
  advisorySource.lecture.blocks = advisorySource.lecture.blocks.slice(0, 1);
  advisorySource.questions[0].prompt = document(
    'question:advisory:prompt',
    '以下哪项为正确答案？答案为 A。'
  );
  advisorySource.questions[0].explanation = document(
    'question:advisory:explanation',
    '答案为 A。'
  );
  const advisoryGateway = new StubGateway(
    ai.ProviderCode.Anthropic,
    JSON.stringify(advisorySource)
  );
  const advisoryResult = await runWorkflow.execute(advisory.workflow.id, advisoryGateway);
  assert.equal(advisoryResult.workflow.status, content.GenerationWorkflowStatus.Committed);
  assert.equal(
    advisoryGateway.callCount,
    1,
    'pedagogical quality warnings must never trigger a second provider request'
  );

  const mostlyValid = await createWorkflow.execute(generationCommand('generation:test:mostly-valid', 10));
  const mostlyValidSource = validGeneratedContent(10);
  mostlyValidSource.questions[7].options.splice(1);
  const mostlyValidGateway = new StubGateway(
    ai.ProviderCode.Anthropic,
    JSON.stringify(mostlyValidSource)
  );
  const mostlyValidResult = await runWorkflow.execute(mostlyValid.workflow.id, mostlyValidGateway);
  assert.equal(mostlyValidResult.workflow.status, content.GenerationWorkflowStatus.Committed);
  assert.equal(mostlyValidGateway.callCount, 1, 'a batch above 80% validity must commit without repair');
  assert.equal(contentRepository.bundles.at(-1).questions.length, 9);
  assert.equal(contentRepository.bundles.at(-1).questionSet.questionCount, 9);

  const exactlyEightyPercent = await createWorkflow.execute(generationCommand('generation:test:eighty-percent', 5));
  const exactlyEightyPercentSource = validGeneratedContent(5);
  exactlyEightyPercentSource.questions[4].options.splice(1);
  const exactlyEightyPercentGateway = new StubGateway(
    ai.ProviderCode.Anthropic,
    JSON.stringify(exactlyEightyPercentSource)
  );
  const exactlyEightyPercentResult = await runWorkflow.execute(
    exactlyEightyPercent.workflow.id,
    exactlyEightyPercentGateway
  );
  assert.equal(exactlyEightyPercentResult.workflow.status, content.GenerationWorkflowStatus.Committed);
  assert.equal(
    exactlyEightyPercentGateway.callCount,
    1,
    'a batch with exactly 80% valid questions must commit without repair'
  );
  assert.equal(contentRepository.bundles.at(-1).questions.length, 4);
  assert.equal(contentRepository.bundles.at(-1).questionSet.questionCount, 4);

  const shortBatch = await createWorkflow.execute(generationCommand('generation:test:short-batch', 5));
  const shortBatchSource = validGeneratedContent(3);
  const shortBatchGateway = new SequenceGateway(ai.ProviderCode.Anthropic, [
    JSON.stringify(shortBatchSource),
    JSON.stringify({
      questionPatches: [3, 4].map((index) => ({
        index,
        question: validGeneratedContent(5).questions[index]
      }))
    })
  ]);
  const shortBatchResult = await runWorkflow.execute(shortBatch.workflow.id, shortBatchGateway);
  assert.equal(shortBatchResult.workflow.status, content.GenerationWorkflowStatus.Committed);
  assert.equal(shortBatchGateway.callCount, 2);
  assert.deepEqual(
    shortBatchGateway.requests[1].responseSchema.properties.questionPatches.items.properties.index.enum,
    [3, 4],
    'a short batch must request only its missing question slots'
  );
  assert.equal(contentRepository.bundles.at(-1).questions.length, 5);

  const deterministic = await createWorkflow.execute(generationCommand('generation:test:deterministic-metadata'));
  const deterministicSource = validGeneratedContent();
  deterministicSource.questions[0].capabilityCode = 'model.supplied.wrong.code';
  const deterministicGateway = new StubGateway(
    ai.ProviderCode.Anthropic,
    JSON.stringify(deterministicSource)
  );
  const deterministicResult = await runWorkflow.execute(deterministic.workflow.id, deterministicGateway);
  assert.equal(deterministicResult.workflow.status, content.GenerationWorkflowStatus.Committed);
  assert.equal(deterministicGateway.callCount, 1, 'deterministic metadata must not trigger model repair');
  assert.equal(
    contentRepository.bundles.at(-1).questions[0].content.capabilityCode,
    'aptitude.judgment.weaken',
    'the GenerationSpec capability code must override model output'
  );

  const singletonMaterial = await createWorkflow.execute(generationCommand('generation:test:singleton-material'));
  const singletonMaterialGateway = new StubGateway(
    ai.ProviderCode.Anthropic,
    JSON.stringify(authorGeneratedContentWithSingletonMaterial())
  );
  const singletonMaterialResult = await runWorkflow.execute(singletonMaterial.workflow.id, singletonMaterialGateway);
  assert.equal(singletonMaterialResult.workflow.status, content.GenerationWorkflowStatus.Committed);
  assert.equal(singletonMaterialGateway.callCount, 1, 'a singleton material group must normalize without model repair');
  assert.equal(contentRepository.bundles.at(-1).questions[0].content.materialGroupId, undefined);
  assert.ok(contentRepository.bundles.at(-1).questions[0].content.material);

  const missingQuestionContext = await createWorkflow.execute(
    generationCommand('generation:test:missing-question-context')
  );
  const missingQuestionContextSource = authorGeneratedContentWithSingletonMaterial();
  missingQuestionContextSource.materialGroups = [];
  missingQuestionContextSource.questions[0].materialGroupId = null;
  missingQuestionContextSource.questions[0].material = null;
  missingQuestionContextSource.questions[0].prompt = '下列哪项如果为真，最能削弱上述论证？';
  const repairedQuestion = {
    ...missingQuestionContextSource.questions[0],
    material: '某市上线公交换乘提醒功能后三个月，公共交通通勤比例明显上升。交通部门据此认为，该功能促使原本驾车通勤的居民改乘公共交通。'
  };
  const missingQuestionContextGateway = new SequenceGateway(ai.ProviderCode.Anthropic, [
    JSON.stringify(missingQuestionContextSource),
    JSON.stringify({
      questionPatches: [{ index: 0, question: repairedQuestion }]
    })
  ]);
  const missingQuestionContextResult = await runWorkflow.execute(
    missingQuestionContext.workflow.id,
    missingQuestionContextGateway
  );
  assert.equal(missingQuestionContextResult.workflow.status, content.GenerationWorkflowStatus.Committed);
  assert.equal(
    missingQuestionContextGateway.callCount,
    2,
    'a referential prompt without material must trigger one localized repair request'
  );
  assert.deepEqual(
    missingQuestionContextGateway.requests[1].responseSchema.properties.questionPatches.items.properties.index.enum,
    [0],
    'missing question context must repair only the affected question'
  );
  assert.ok(
    contentRepository.bundles.at(-1).questions[0].content.material,
    'the repaired question must commit its complete answering material'
  );

  const autonomousStructure = await createWorkflow.execute(generationCommand('generation:test:autonomous-structure'));
  const autonomousSource = authorGeneratedContentWithSingletonMaterial();
  autonomousSource.lecture.sections = autonomousSource.lecture.sections.slice(0, 1);
  delete autonomousSource.lecture.sections[0].id;
  delete autonomousSource.questions[0].id;
  autonomousSource.questions[0].options.forEach((option) => delete option.id);
  autonomousSource.questions[0].correctOptionId = 'a';
  delete autonomousSource.questions[0].explanation.steps;
  delete autonomousSource.questions[0].explanation.pitfalls;
  const autonomousGateway = new StubGateway(
    ai.ProviderCode.Anthropic,
    JSON.stringify(autonomousSource)
  );
  const autonomousResult = await runWorkflow.execute(autonomousStructure.workflow.id, autonomousGateway);
  assert.equal(autonomousResult.workflow.status, content.GenerationWorkflowStatus.Committed);
  assert.equal(
    autonomousGateway.callCount,
    1,
    'AI-selected lecture and explanation lengths must not trigger repair'
  );
  assert.equal(
    contentRepository.bundles.at(-1).questions[0].content.explanation.blocks.some(
      (block) => block.type === 'callout' && block.kind === 'trap'
    ),
    false,
    'an omitted optional teaching section must not render as an empty callout'
  );
  assert.deepEqual(
    contentRepository.bundles.at(-1).questions[0].content.options.map((option) => option.id),
    ['A', 'B', 'C', 'D'],
    'deterministic option ids must be injected without model repair'
  );
  assert.equal(
    contentRepository.bundles.at(-1).questions[0].content.correctOptionId,
    'A',
    'safe answer-id casing differences must normalize locally'
  );

  const enrichmentPending = await createWorkflow.execute(generationCommand('generation:test:enrichment-pending'));
  const enrichmentPendingSource = authorGeneratedContentWithSingletonMaterial();
  delete enrichmentPendingSource.questions[0].explanation;
  const enrichmentPendingGateway = new StubGateway(
    ai.ProviderCode.Anthropic,
    JSON.stringify(enrichmentPendingSource)
  );
  const enrichmentPendingResult = await runWorkflow.execute(
    enrichmentPending.workflow.id,
    enrichmentPendingGateway
  );
  assert.equal(enrichmentPendingResult.workflow.status, content.GenerationWorkflowStatus.Committed);
  assert.equal(
    enrichmentPendingGateway.callCount,
    1,
    'a lecture-plus-core provider result must publish without waiting for per-question explanation enrichment'
  );
  assert.equal(
    contentRepository.bundles.at(-1).generationWorkflow.validation.readiness,
    content.ContentReadiness.ReadyWithPendingEnrichment
  );
  assert(
    !contentRepository.bundles.at(-1).generationWorkflow.validation.pendingEnrichment.some(
      (issue) => issue.block === content.GeneratedContentBlockCode.Lecture
    ),
    'paired lecture content must already be complete before publication'
  );
  const pendingBundle = contentRepository.bundles.at(-1);
  const pendingBundleIndex = contentRepository.bundles.length - 1;
  contentRepository.bundles[pendingBundleIndex] = {
    ...pendingBundle,
    questionSet: {
      ...pendingBundle.questionSet,
      practiceStatus: content.QuestionSetPracticeStatus.InProgress
    }
  };
  const activeBundle = contentRepository.bundles[pendingBundleIndex];
  assert.equal(
    content.findQuestionSetEnrichmentNeeds(activeBundle).explanationQuestionIds.length,
    1,
    'a renderable but structurally incomplete explanation must remain pending'
  );
  const coreQuestionBeforeEnrichment = JSON.stringify({
    material: activeBundle.questions[0].content.material,
    prompt: activeBundle.questions[0].content.prompt,
    options: activeBundle.questions[0].content.options,
    correctOptionId: activeBundle.questions[0].content.correctOptionId,
    correctAnswer: activeBundle.questions[0].correctAnswer
  });
  const parsedEnrichment = content.parseQuestionSetEnrichment(JSON.stringify({
    lecture: {
      sections: [{
        kind: 'method',
        title: '论证结构识别',
        markdown: '先定位结论，再识别支撑结论的论据，最后判断论据与结论之间采用的推理方式。'
      }]
    },
    explanations: [{
      questionId: activeBundle.questions[0].id,
      explanation: {
        knowledgePoint: '论点、论据与论证结构',
        conclusion: '正确选项能够直接破坏题干中的核心推理关系。',
        steps: ['定位结论', '还原论据', '比较选项对推理链的影响'],
        optionAnalysis: activeBundle.questions[0].content.options.map((option) => ({
          optionId: option.id,
          verdict: option.id === activeBundle.questions[0].content.correctOptionId ? 'correct' : 'incorrect',
          analysis: option.id === activeBundle.questions[0].content.correctOptionId
            ? '该项直接作用于核心推理链。'
            : '该项没有破坏核心推理链。'
        })),
        pitfalls: ['不要只看选项是否与题干主题相关。']
      }
    }]
  }), activeBundle);
  const enrichmentResult = await new content.ApplyQuestionSetEnrichment(
    unitOfWork,
    contentRepository
  ).execute(activeBundle.questionSet.id, parsedEnrichment);
  assert.equal(enrichmentResult.applied, true);
  const enrichedBundle = await contentRepository.findQuestionSet(activeBundle.questionSet.id);
  assert.equal(enrichedBundle.questionSet.practiceStatus, content.QuestionSetPracticeStatus.InProgress);
  assert.equal(JSON.stringify({
    material: enrichedBundle.questions[0].content.material,
    prompt: enrichedBundle.questions[0].content.prompt,
    options: enrichedBundle.questions[0].content.options,
    correctOptionId: enrichedBundle.questions[0].content.correctOptionId,
    correctAnswer: enrichedBundle.questions[0].correctAnswer
  }), coreQuestionBeforeEnrichment, 'background enrichment must never rewrite answerable core blocks');
  assert.equal(content.findQuestionSetEnrichmentNeeds(enrichedBundle).lecture, false);
  assert.equal(content.findQuestionSetEnrichmentNeeds(enrichedBundle).explanationQuestionIds.length, 0);

  const emptyLectureSource = validGeneratedContent();
  emptyLectureSource.lecture.blocks = [];
  const emptyLectureReport = new content.StructuredObjectiveContentQualityValidator().validate(
    emptyLectureSource,
    1,
    'aptitude.judgment.weaken'
  );
  assert.equal(emptyLectureReport.valid, false);
  assert.equal(emptyLectureReport.readiness, content.ContentReadiness.Invalid);
  assert(
    emptyLectureReport.blockingIssues.some((issue) => issue.code === 'quality.lecture_empty'),
    'an empty lecture must block publication because lecture and questions are one teaching unit'
  );

  const standardPresentation = content.resolveQuestionPresentation(validGeneratedContent().questions[0]);
  assert.equal(standardPresentation, content.QuestionPresentationCode.StandardChoice);
  const graphicPresentationSource = validGeneratedContent().questions[0];
  graphicPresentationSource.prompt.blocks[0].source = '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="20" /></svg>';
  assert.equal(
    content.resolveQuestionPresentation(graphicPresentationSource),
    content.QuestionPresentationCode.GraphicChoice,
    'inline SVG questions must use the proportional graphic presentation'
  );
  const sharedPresentationSource = validGeneratedContent().questions[0];
  sharedPresentationSource.materialGroupId = 'material:shared';
  sharedPresentationSource.material = document('material:shared', '一段完整共用材料');
  assert.equal(
    content.resolveQuestionPresentation(sharedPresentationSource),
    content.QuestionPresentationCode.SharedMaterialChoice,
    'shared stems must use the shared-material presentation'
  );
  sharedPresentationSource.material.blocks[0].source = '| 年份 | 数值 |\n| --- | ---: |\n| 2025 | 100 |';
  assert.equal(
    content.resolveQuestionPresentation(sharedPresentationSource),
    content.QuestionPresentationCode.DataMaterialChoice,
    'shared Markdown tables must use the data-material presentation'
  );

  const duplicateOptionSource = validGeneratedContent();
  duplicateOptionSource.questions[0].options[1].content = duplicateOptionSource.questions[0].options[0].content;
  const duplicateOptionReport = new content.StructuredObjectiveContentQualityValidator().validate(
    duplicateOptionSource,
    1,
    'aptitude.judgment.weaken'
  );
  assert.equal(duplicateOptionReport.valid, true);
  assert(
    duplicateOptionReport.advisories.some((issue) => issue.code === 'quality.option_duplicate'),
    'semantic option duplication must be observed without rejecting a structurally answerable question'
  );

  const structuralRepair = await createWorkflow.execute(generationCommand('generation:test:structural-repair'));
  const structuralSource = authorGeneratedContentWithSingletonMaterial();
  const structuralQuestion = structuredClone(structuralSource.questions[0]);
  structuralSource.questions[0].explanation.optionAnalysis.pop();
  const structuralGateway = new SequenceGateway(ai.ProviderCode.Anthropic, [
    JSON.stringify(structuralSource),
    JSON.stringify({
      questionPatches: [{ index: 0, question: structuralQuestion }]
    })
  ]);
  const structuralResult = await runWorkflow.execute(structuralRepair.workflow.id, structuralGateway);
  assert.equal(structuralResult.workflow.status, content.GenerationWorkflowStatus.Committed);
  assert.equal(structuralGateway.callCount, 1);
  assert(
    contentRepository.bundles.at(-1).generationWorkflow.validation.quality.readiness
      === 'ready_with_pending_enrichment',
    'incomplete option analysis must commit the answerable question and mark enrichment pending'
  );

  const repairable = await createWorkflow.execute(generationCommand('generation:test:repairable'));
  const repairGateway = new SequenceGateway(ai.ProviderCode.Anthropic, [
    JSON.stringify({ lecture: 'invalid document', questions: [] }),
    JSON.stringify(validGeneratedContent())
  ]);
  const repaired = await runWorkflow.execute(repairable.workflow.id, repairGateway);
  assert.equal(repaired.workflow.status, content.GenerationWorkflowStatus.Committed);
  assert.equal(repairGateway.callCount, 2, 'schema repair must be bounded to one corrective call');
  const repairInvocations = invocationRepository.items.filter((item) => item.workflowId === repairable.workflow.id);
  assert.equal(repairInvocations.length, 2);
  assert.equal(repairInvocations[0].validationStatus, ai.InvocationValidationStatus.Invalid);
  assert.equal(repairInvocations[1].validationStatus, ai.InvocationValidationStatus.Valid);

  const localized = await createWorkflow.execute(generationCommand('generation:test:localized', 2));
  const localizedSource = validGeneratedContent(2);
  const firstQuestion = localizedSource.questions[0];
  localizedSource.questions[1].options.splice(1);
  const localizedGateway = new SequenceGateway(ai.ProviderCode.Anthropic, [
    JSON.stringify(localizedSource),
    JSON.stringify({
      questionPatches: [{
        index: 1,
        question: validGeneratedContent(2).questions[1]
      }]
    })
  ]);
  const localizedResult = await runWorkflow.execute(localized.workflow.id, localizedGateway);
  assert.equal(localizedResult.workflow.status, content.GenerationWorkflowStatus.Committed);
  assert.equal(localizedGateway.callCount, 2);
  assert.ok(
    localizedGateway.requests[1].responseSchema.properties.questionPatches,
    'question-specific quality failures must request patches instead of a full set'
  );
  assert.match(
    localizedGateway.requests[1].messages[0].content,
    /"expectedQuestionCount":2/,
    'localized repair must receive the immutable generation boundary'
  );
  assert.doesNotMatch(
    localizedGateway.requests[1].messages[0].content,
    /"examCycle"/,
    'localized repair must not resend unrelated candidate context'
  );
  const localizedBundle = contentRepository.bundles.at(-1);
  assert.deepEqual(
    localizedBundle.questions[0].content.prompt,
    firstQuestion.prompt,
    'localized repair must preserve questions that already passed validation'
  );
  assert.equal(
    localizedBundle.questions[1].content.capabilityCode,
    'aptitude.judgment.weaken',
    'localized repair must replace the invalid question'
  );

  const largeBatch = await createWorkflow.execute(
    generationCommand('generation:test:parallel-25', 25)
  );
  const parallelGateway = new ParallelShardGateway(ai.ProviderCode.Anthropic);
  const largeBatchResult = await runWorkflow.execute(largeBatch.workflow.id, parallelGateway);
  assert.equal(largeBatchResult.workflow.status, content.GenerationWorkflowStatus.Committed);
  assert.equal(parallelGateway.callCount, 6, '25 questions plus one lecture must use six bounded calls');
  assert.equal(
    parallelGateway.peakActive,
    6,
    'lecture and question shards must respect the per-workflow concurrency ceiling'
  );
  assert.equal(
    parallelGateway.requests.filter((request) => request.responseSchema.properties.lecture).length,
    1,
    'the paired lecture must be generated once beside the question shards'
  );
  const largeBatchBundle = contentRepository.bundles.at(-1);
  assert.equal(largeBatchBundle.questions.length, 25);
  assert.deepEqual(
    largeBatchBundle.questions.map((question) => question.content.prompt.blocks[0].source),
    Array.from({ length: 25 }, (_, index) => `并行题目 ${index + 1}`),
    'parallel completion order must not change the original question order'
  );
  assert(
    invocationRepository.items
      .filter((item) => item.workflowId === largeBatch.workflow.id)
      .every((item) => item.validationStatus === ai.InvocationValidationStatus.Valid),
    'every successful shard invocation must leave the pending state'
  );

  const repairedLargeBatch = await createWorkflow.execute(
    generationCommand('generation:test:parallel-25-local-repair', 25)
  );
  const repairingParallelGateway = new ParallelShardGateway(
    ai.ProviderCode.Anthropic,
    2
  );
  const repairedLargeBatchResult = await runWorkflow.execute(
    repairedLargeBatch.workflow.id,
    repairingParallelGateway
  );
  assert.equal(repairedLargeBatchResult.workflow.status, content.GenerationWorkflowStatus.Committed);
  assert.equal(
    repairingParallelGateway.callCount,
    7,
    'one invalid shard must add one repair call without regenerating the other shards'
  );
  assert.equal(
    repairingParallelGateway.requests.filter(
      (request) => request.responseSchema.properties.lecture
    ).length,
    1,
    'a shard repair must never regenerate the lecture'
  );
  assert.equal(contentRepository.bundles.at(-1).questions.length, 25);

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
  async applyQuestionSetEnrichment(patch) {
    const index = this.bundles.findIndex((item) => item.questionSet.id === patch.questionSetId);
    if (index < 0) return false;
    const current = this.bundles[index];
    if (current.questionSet.contentVersion !== patch.expectedContentVersion) return false;
    const documentPatches = new Map(
      patch.lecture ? [[patch.lecture.document.id, patch.lecture.document]] : []
    );
    const questionPatches = new Map(patch.questions.map((question) => [question.id, question]));
    this.bundles[index] = {
      ...current,
      documents: current.documents.map((document) => documentPatches.get(document.id) ?? document),
      lectures: current.lectures.map((lecture) => (
        lecture.id === patch.lecture?.lectureId
          ? { ...lecture, version: lecture.version + 1 }
          : lecture
      )),
      questions: current.questions.map((question) => questionPatches.get(question.id) ?? question),
      questionSet: {
        ...current.questionSet,
        contentHash: patch.nextContentHash,
        contentVersion: current.questionSet.contentVersion + 1
      }
    };
    return true;
  }
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
  requests = [];
  constructor(provider, text, failure) {
    this.provider = provider;
    this.text = text;
    this.failure = failure;
  }
  async complete(request) {
    this.requests.push(request);
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

class SequenceGateway {
  model = 'test-model';
  callCount = 0;
  requests = [];
  constructor(provider, responses) {
    this.provider = provider;
    this.responses = responses;
  }
  async complete(request) {
    this.requests.push(request);
    const text = this.responses[Math.min(this.callCount, this.responses.length - 1)];
    this.callCount += 1;
    return {
      text,
      providerRequestId: `provider-sequence:${this.callCount}`,
      finishReason: 'end_turn',
      usage: { inputTokens: 1200, outputTokens: 900 }
    };
  }
}

class ParallelShardGateway {
  model = 'test-model';
  callCount = 0;
  active = 0;
  peakActive = 0;
  requests = [];
  failedConfiguredShard = false;
  constructor(provider, failShardIndex) {
    this.provider = provider;
    this.failShardIndex = failShardIndex;
  }
  async complete(request) {
    this.requests.push(request);
    this.callCount += 1;
    this.active += 1;
    this.peakActive = Math.max(this.peakActive, this.active);
    try {
      await new Promise((resolve) => setTimeout(resolve, 25));
      const includesLecture = Boolean(request.responseSchema.properties.lecture);
      const count = request.responseSchema.properties.questions?.minItems ?? 1;
      const user = String(request.messages[0].content);
      const shardIndex = Number(user.match(/"shardIndex":(\d+)/)?.[1] ?? 0);
      const source = validGeneratedContent(count);
      if (includesLecture) {
        return {
          text: JSON.stringify({ lecture: source.lecture }),
          providerRequestId: `provider-parallel:${this.callCount}`,
          finishReason: 'end_turn',
          usage: { inputTokens: 1200, outputTokens: 900 }
        };
      }
      source.questions.forEach((question, localIndex) => {
        const globalIndex = shardIndex * 5 + localIndex;
        question.prompt = document(
          `question:parallel:${globalIndex + 1}:prompt`,
          `并行题目 ${globalIndex + 1}`
        );
      });
      if (
        !includesLecture
        && shardIndex === this.failShardIndex
        && !this.failedConfiguredShard
      ) {
        source.questions[0].options.splice(1);
        this.failedConfiguredShard = true;
      }
      return {
        text: JSON.stringify(includesLecture ? source : { questions: source.questions }),
        providerRequestId: `provider-parallel:${this.callCount}`,
        finishReason: 'end_turn',
        usage: { inputTokens: 1200, outputTokens: 900 }
      };
    } finally {
      this.active -= 1;
    }
  }
}

function generationCommand(idempotencyKey, requestedCount = 1) {
  return {
    idempotencyKey,
    examCycleId: 'exam-cycle:test',
    learningThreadId: 'learning-thread:test',
    teachingBlueprintId: 'teaching-blueprint:test',
    capabilityNodeId: 'capability:aptitude:judgment:weaken',
    assessmentRole: 'practice',
    requestedCount,
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
  return { schemaVersion: 'content.v1', blocks: [{ id, type: 'text', source }] };
}

function explanationDocument() {
  return {
    schemaVersion: 'content.v1',
    blocks: [
      callout('question:explanation:conclusion', 'conclusion', '结论与考点', '**考点：因果削弱**\n\n题干由时间先后推出因果关系，A 项提供独立的替代原因，直接降低原结论成立的可能性。'),
      callout('question:explanation:steps', 'method', '解题思路', '1. 识别题干的论点、论据和因果桥梁。\n2. 优先寻找能独立解释结果变化的替代原因。'),
      callout('question:explanation:options', 'hint', '选项辨析', '**A · 正确**\n\n停车成本上升能够独立解释通勤方式变化。\n\n**B · 排除**\n\n只说明推广方式。\n\n**C · 排除**\n\n只描述用户特征。\n\n**D · 排除**\n\n只涉及产品偏好。'),
      callout('question:explanation:pitfalls', 'trap', '易错提醒', '- 不能把时间先后直接当作因果关系。\n- 相关信息不等于有效削弱。')
    ]
  };
}

function callout(id, kind, title, source) {
  return {
    id,
    type: 'callout',
    kind,
    title,
    blocks: [{ id: `${id}:content`, type: 'text', source }]
  };
}

function validGeneratedContent(questionCount = 1) {
  const lectureParagraph = '削弱论证的核心不是寻找与结论相反的话，而是先识别论点、论据及二者之间的推理桥梁，再判断选项是否真正降低结论成立的可能性。面对因果论证，需要依次检查替代原因、因果倒置、样本代表性、实验条件差异和关键条件缺失，并比较不同削弱方式对核心链条的影响强度。';
  return {
    lecture: {
      schemaVersion: 'content.v1',
      blocks: Array.from({ length: 6 }, (_, index) => ({
        id: `lecture:block:${index + 1}`,
        type: 'text',
        source: `## 第${index + 1}节\n${lectureParagraph}${lectureParagraph}`
      }))
    },
    questions: Array.from({ length: questionCount }, (_, index) => ({
      templateCode: 'single_choice',
      schemaVersion: 'question.single_choice.v2',
      capabilityCode: 'aptitude.judgment.weaken',
      material: document(
        `question:${index + 1}:material`,
        index === 0
          ? '某市上线新的公交换乘提醒功能后三个月，使用公共交通通勤的居民比例明显上升。市交通部门据此认为，该提醒功能能够有效促使原本驾车通勤的居民改乘公共交通。'
          : '某企业引入线上培训系统后，员工季度考核的平均分明显提高。管理层据此认为，线上培训系统直接提升了员工的业务能力。'
      ),
      prompt: document(
        `question:${index + 1}:prompt`,
        index === 0
          ? '以下哪项如果为真，最能削弱市交通部门关于提醒功能促使居民改变通勤方式的结论？'
          : '以下哪项如果为真，最能削弱管理层关于线上培训系统提升员工业务能力的判断？'
      ),
      options: [
        { id: 'A', content: document(`question:${index + 1}:option:A`, index === 0 ? '同期市中心大幅提高了工作日停车收费标准' : '同期企业调整了考核题库，大量题目来自培训前的模拟测试') },
        { id: 'B', content: document(`question:${index + 1}:option:B`, index === 0 ? '多数公交站点都张贴了功能使用说明海报' : '许多员工会在午休时间登录线上培训系统') },
        { id: 'C', content: document(`question:${index + 1}:option:C`, index === 0 ? '使用该功能的居民普遍关注道路拥堵信息' : '线上培训系统提供了多种课程播放速度') },
        { id: 'D', content: document(`question:${index + 1}:option:D`, index === 0 ? '部分居民希望提醒功能增加语音播报选项' : '部分员工希望增加移动端的离线下载功能') }
      ],
      correctOptionId: 'A',
      explanation: explanationDocument()
    }))
  };
}

function advisoryGeneratedContent() {
  const generated = validGeneratedContent();
  generated.lecture.blocks = generated.lecture.blocks.map((block, index) => ({
    ...block,
    source: `## 第${index + 1}节\n简要提示。`
  }));
  generated.questions[0].material = undefined;
  generated.questions[0].prompt = document('question:advisory:prompt', '哪项？');
  return generated;
}

function authorGeneratedContentWithSingletonMaterial() {
  return {
    lecture: {
      sections: [
        { id: 'lecture:concept', kind: 'concept', title: '核心概念', markdown: '削弱论证要求识别论点、论据和二者之间的支持关系，再寻找能够降低结论成立可能性的新增信息。' },
        { id: 'lecture:boundary', kind: 'boundary', title: '适用边界', markdown: '削弱不是简单表达反对态度，而是让论据失效、补充反例、切断因果联系或者指出存在更合理的替代解释。' },
        { id: 'lecture:method', kind: 'method', title: '解题方法', markdown: '先提炼结论，再标记论据，随后判断论证方式，最后比较各选项对核心推理链的破坏程度。' },
        { id: 'lecture:example', kind: 'example', title: '典型示例', markdown: '当论证根据措施实施后指标改善来认定措施有效时，同期发生的其他重大变化通常构成替代原因。' },
        { id: 'lecture:trap', kind: 'trap', title: '常见陷阱', markdown: '主体相关但不影响推理链的信息、只描述措施细节的信息以及单纯表达态度的信息，通常不能有效削弱。' },
        { id: 'lecture:summary', kind: 'summary', title: '复盘总结', markdown: '复盘时应写清论点、论据、论证漏洞和正确选项的作用位置，而不是只记住答案序号。' }
      ]
    },
    materialGroups: [{
      id: 'material:single',
      markdown: '某市上线公交换乘提醒功能后三个月，使用公共交通通勤的居民比例明显上升。交通部门据此认为，该提醒功能促使原本驾车通勤的居民改乘公共交通。'
    }],
    questions: [{
      id: 'question:singleton-material',
      materialGroupId: 'material:single',
      material: null,
      prompt: '以下哪项如果为真，最能削弱交通部门关于提醒功能促使居民改变通勤方式的结论？',
      options: [
        { id: 'A', text: '同期市中心大幅提高了工作日停车收费标准' },
        { id: 'B', text: '多数公交站点张贴了功能使用说明海报' },
        { id: 'C', text: '使用该功能的居民普遍关注道路拥堵信息' },
        { id: 'D', text: '部分居民希望提醒功能增加语音播报选项' }
      ],
      correctOptionId: 'A',
      explanation: {
        knowledgePoint: '削弱论证中的替代原因',
        conclusion: 'A 项指出同期停车成本显著增加，提供了公共交通占比上升的另一种原因，直接削弱原结论。',
        steps: [
          '先确定结论是提醒功能导致居民改变通勤方式。',
          '再寻找能够解释公共交通占比上升的其他同期因素。'
        ],
        optionAnalysis: [
          { optionId: 'A', verdict: 'correct', analysis: '停车成本上升可以独立促使居民放弃驾车，构成有力的替代原因。' },
          { optionId: 'B', verdict: 'incorrect', analysis: '张贴说明只能表明推广方式，不能否定提醒功能产生了实际作用。' },
          { optionId: 'C', verdict: 'incorrect', analysis: '关注拥堵信息与是否改变通勤方式之间没有直接的削弱关系。' },
          { optionId: 'D', verdict: 'incorrect', analysis: '功能建议只涉及使用体验，不影响交通部门提出的因果判断。' }
        ],
        pitfalls: ['不要把与功能相关但不影响因果链的信息误认为有效削弱。']
      }
    }]
  };
}

await verify();
