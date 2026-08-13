import assert from 'node:assert/strict';
import crypto from 'node:crypto';
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

/**
 * The content hash covers the wording, not the addressing. `examType` and the
 * ids derived from it are excluded so two packs shipping identical wording
 * produce the same hash.
 */
function promptContentPayload(bundle) {
  const { examType: _examType, definitionId: _definitionId, versionId: _versionId, ...content } = bundle;
  return content;
}

try {
  const [runtime, sqlitePrompt] = await Promise.all([
    server.ssrLoadModule('/src/capabilities/ai-runtime/public.ts'),
    server.ssrLoadModule('/src/capabilities/ai-runtime/adapters/SqlitePromptRepository.ts')
  ]);
  const registry = new runtime.PromptRegistry();
  for (const prompt of [
    runtime.structuredObjectivePromptV2,
    runtime.questionSetEnrichmentPromptV1,
    runtime.errorDiagnosisPromptV1,
    runtime.errorDiagnosisBatchPromptV1
  ]) {
    const { contentHash, ...hashPayload } = promptContentPayload(prompt);
    const expectedHash = `sha256:${crypto.createHash('sha256').update(JSON.stringify(hashPayload)).digest('hex')}`;
    assert.equal(contentHash, expectedHash, `prompt ${prompt.promptCode} content hash mismatch; expected ${expectedHash}`);
  }
  // Pack prompts only resolve once their track is active.
  registry.activateExamType('civil_service');
  for (const bundle of runtime.createBusinessTutorPromptCatalog('civil_service')) {
    const { contentHash: businessHash, ...businessHashPayload } = promptContentPayload(bundle);
    const expectedBusinessHash = `sha256:${crypto.createHash('sha256').update(JSON.stringify(businessHashPayload)).digest('hex')}`;
    assert.equal(
      businessHash,
      expectedBusinessHash,
      `prompt ${bundle.promptCode} content hash mismatch; expected ${expectedBusinessHash}`
    );
    registry.register(bundle);
    const businessCompiled = new runtime.PromptCompiler(registry).compile(
      bundle.promptCode,
      {},
      { audit: true }
    );
    assert(businessCompiled.system.startsWith('# 第1章'));
    assert(businessCompiled.user.includes('"audit": true'));
  }
  // --- exam pack scoping ------------------------------------------------------
  const civilEssay = runtime.createBusinessTutorPromptCatalog('civil_service')
    .find((bundle) => bundle.promptCode === 'content.generate.essay.question');
  const lawEssay = runtime.createBusinessTutorPromptCatalog('law')
    .find((bundle) => bundle.promptCode === 'content.generate.essay.question');
  // Two packs may ship the same prompt code; ids must not collide on the primary key.
  assert.notEqual(civilEssay.definitionId, lawEssay.definitionId);
  assert.notEqual(civilEssay.versionId, lawEssay.versionId);
  // Identical wording hashes the same regardless of which pack ships it.
  assert.equal(civilEssay.contentHash, lawEssay.contentHash);

  const scoped = new runtime.PromptRegistry();
  for (const bundle of runtime.createBusinessTutorPromptCatalog('civil_service')) scoped.register(bundle);
  for (const bundle of runtime.createBusinessTutorPromptCatalog('law')) scoped.register(bundle);
  scoped.register(runtime.structuredObjectivePromptV2);

  // Registering both packs no longer throws on the shared prompt code.
  scoped.activateExamType('civil_service');
  assert.equal(scoped.resolve('content.generate.essay.question').examType, 'civil_service');
  scoped.activateExamType('law');
  assert.equal(scoped.resolve('content.generate.essay.question').examType, 'law');
  // A prompt the pack does not override falls back to the shared catalog.
  assert.equal(
    scoped.resolve('content.generate.aptitude.structured_objective').examType,
    runtime.SHARED_PROMPT_EXAM_TYPE
  );
  // An unknown code names the active track, so the failure is diagnosable.
  assert.throws(() => scoped.resolve('content.generate.nonexistent'), /not registered for law/);

  registry.register(runtime.structuredObjectivePromptV2);
  const compiler = new runtime.PromptCompiler(registry);
  const compiled = compiler.compile(
    runtime.structuredObjectivePromptV2.promptCode,
    {
      QUESTION_COUNT: 5,
      ASSESSMENT_ROLE: 'practice',
      DIFFICULTY_MIN: 0.35,
      DIFFICULTY_MAX: 0.65
    },
    {
      capabilityNodeId: 'capability:aptitude:judgment:weaken',
      evidence: { confidence: 'insufficient' }
    }
  );
  assert(compiled.system.startsWith('# 第1章 命题身份与边界'));
  assert(compiled.system.includes('# 第6章 提交前质检'));
  assert(compiled.system.includes('本次生成 5 道题'));
  assert(!compiled.system.includes('{{QUESTION_COUNT}}'));
  assert.equal(compiled.version, '2.6.0');
  assert(compiled.system.includes('最小真题参考包'));
  assert(compiled.system.includes('generationVariation'));
  assert(!compiled.responseSchema.properties.questions.items.required.includes('referenceQuestionId'));
  assert.equal(compiled.responseSchema.properties.questions.items.properties.capabilityCode, undefined);
  assert(compiled.system.includes('由应用按照当前 GenerationSpec 统一注入'));
  assert(compiled.system.includes('不要求凑齐全部 kind'));
  assert(compiled.system.includes('KaTeX 兼容 LaTeX'));
  assert.equal(compiled.responseSchema.properties.lecture.properties.sections.minItems, 0);
  assert.equal(
    compiled.responseSchema.properties.questions.items.properties.explanation.properties.pitfalls.minItems,
    0
  );
  assert.equal(compiled.responseSchema.type, 'object');
  registry.register(runtime.questionSetEnrichmentPromptV1);
  const enrichmentPrompt = compiler.compile(
    runtime.questionSetEnrichmentPromptV1.promptCode,
    {},
    {
      questionSetId: 'QuestionSetId:test',
      missingBlocks: { lecture: true, explanationQuestionIds: ['QuestionId:test'] }
    },
    runtime.questionSetEnrichmentPromptV1.version
  );
  assert(enrichmentPrompt.system.includes('题干、材料、选项和答案已经发布'));
  assert(enrichmentPrompt.system.includes('它们全部不可修改'));
  assert.equal(enrichmentPrompt.responseSchema.required[0], 'explanations');

  const essayGeneration = runtime.createBusinessTutorPromptCatalog('civil_service').find(
    (item) => item.promptCode === runtime.BusinessTutorPromptCode.EssayGeneration
  );
  assert(essayGeneration);
  assert.equal(
    essayGeneration.responseSchema.properties.lecture.properties.clues.minItems,
    undefined,
    'teaching list length is an AI decision, not a structural requirement'
  );
  assert.equal(essayGeneration.responseSchema.properties.lecture.properties.clues.maxItems, 8);
  const dailyDigest = runtime.createBusinessTutorPromptCatalog('civil_service').find(
    (item) => item.promptCode === runtime.BusinessTutorPromptCode.DailyDigest
  );
  assert(dailyDigest);
  const compiledDigest = compiler.compile(dailyDigest.promptCode, {}, { date: '2026-07-26', type: 'tips' }, dailyDigest.version);
  assert(compiledDigest.system.includes('主题数量、栏目、篇幅和例子数量由信息价值与当天学习负担决定'));
  assert(compiledDigest.system.includes('recentOutlinesToAvoid'));
  assert(compiledDigest.system.includes('百分号必须写成 \\%'));
  assert(!compiledDigest.system.includes('3 至 5 个二级主题'));

  const originalWarn = console.warn;
  console.warn = () => undefined;
  try {
    const conflictRepository = {
      find: async () => ({
        ...runtime.structuredObjectivePromptV2,
        contentHash: 'sha256:installed-different-content'
      }),
      install: async () => {
        throw new Error('conflicting prompt metadata must not be overwritten');
      }
    };
    const immediateUnitOfWork = {
      run: async (work) => work({ transactionId: 'prompt-test' })
    };
    const conflictStatus = await new runtime.EnsurePromptBundle(
      immediateUnitOfWork,
      conflictRepository
    ).execute(runtime.structuredObjectivePromptV2);
    assert.equal(
      conflictStatus,
      runtime.PromptBundleEnsureStatus.Conflict,
      'prompt metadata conflicts must not block app initialization'
    );
  } finally {
    console.warn = originalWarn;
  }

  registry.register(runtime.errorDiagnosisPromptV1);
  const diagnosisPrompt = compiler.compile(
    runtime.errorDiagnosisPromptV1.promptCode,
    { SUBJECT: '行测判断推理' },
    {
      standardAnswer: 'B',
      userAnswer: 'A',
      explanation: 'B 直接削弱论证'
    },
    runtime.errorDiagnosisPromptV1.version
  );
  assert(diagnosisPrompt.system.includes('行测判断推理私教'));
  assert(diagnosisPrompt.system.includes('只有题目和误选项证据时不得高于 0.55'));
  registry.register(runtime.errorDiagnosisBatchPromptV1);
  const diagnosisBatchPrompt = compiler.compile(
    runtime.errorDiagnosisBatchPromptV1.promptCode,
    { SUBJECT: '行测判断推理' },
    {
      items: [{
        provisionalDiagnosisId: 'ErrorDiagnosisId:test',
        evidence: { standardAnswer: 'B', userAnswer: 'A' }
      }]
    },
    runtime.errorDiagnosisBatchPromptV1.version
  );
  assert(diagnosisBatchPrompt.system.includes('ID 一一对应且无重复'));
  assert.equal(diagnosisBatchPrompt.responseSchema.properties.diagnoses.type, 'array');
  assert.throws(() => compiler.compile(
    runtime.structuredObjectivePromptV2.promptCode,
    { QUESTION_COUNT: 5 },
    {}
  ), /missing variables/);
  assert.throws(() => registry.register({
    ...runtime.structuredObjectivePromptV2,
    contentHash: 'sha256:different-content'
  }), /different content/);
  const promptInstallStatements = [];
  const sqlitePromptRepository = new sqlitePrompt.SqlitePromptRepository(
    {},
    {
      resolve() {
        return {
          async run(sql, params) {
            promptInstallStatements.push({ sql, params });
          }
        };
      }
    }
  );
  await sqlitePromptRepository.install(runtime.errorDiagnosisPromptV1, { transactionId: 'prompt-install:test' });
  // Upsert and lookup are scoped to the owning pack, not the bare prompt code.
  assert.match(promptInstallStatements[0].sql, /ON CONFLICT\(exam_type, prompt_code\) DO UPDATE/);
  assert.match(
    promptInstallStatements[1].sql,
    /SELECT id FROM prompt_definitions WHERE exam_type = \? AND prompt_code = \?/
  );
  assert.equal(promptInstallStatements[1].params[1], runtime.SHARED_PROMPT_EXAM_TYPE);
  assert.equal(promptInstallStatements[1].params[2], runtime.errorDiagnosisPromptV1.promptCode);
  assert.equal(promptInstallStatements[0].params[1], runtime.SHARED_PROMPT_EXAM_TYPE);
  console.log('Prompt compiler verification passed.');
} finally {
  await server.close();
}
