import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(scriptDirectory, '../web');
const migrationPath = path.join(
  webRoot,
  'src/capabilities/database/migrations/023_question_import_drafts.sql'
);
const server = await createServer({
  root: webRoot,
  configFile: false,
  resolve: { alias: { '@': path.join(webRoot, 'src') } },
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: 'custom'
});

async function main() {
  try {
    const [content, aiRuntime] = await Promise.all([
      server.ssrLoadModule('/src/modules/content/public.ts'),
      server.ssrLoadModule('/src/capabilities/ai-runtime/public.ts')
    ]);
    await verifyWorkflow(content, aiRuntime);
    await verifyMigrationContract();
    console.log('Question import workflow verification passed.');
  } finally {
    await server.close();
  }
}

async function verifyWorkflow(content, aiRuntime) {
  const clock = new TestClock();
  const ids = new TestIds();
  const drafts = new MemoryDraftRepository();
  const sources = new MemorySourceRepository();
  const generations = new MemoryGenerationRepository();
  const contentRepository = new MemoryContentRepository();
  const unitOfWork = { run: executeWork, runAutocommit: executeWork };
  const scan = new content.ScanQuestionImportDraft(unitOfWork, drafts, clock, ids);
  const confirm = new content.ConfirmQuestionImportDraft(unitOfWork, drafts, clock, ids);
  const publish = new content.PublishQuestionImportDraft(
    unitOfWork,
    drafts,
    generations,
    contentRepository,
    sources,
    clock,
    ids
  );
  const command = {
    idempotencyKey: 'scan:official:2025-js',
    examCycleId: 'ExamCycleId:1',
    capabilityNodeId: 'CapabilityNodeId:1',
    capabilityCode: 'aptitude.judgment.argument',
    module: '判断推理',
    ownerSessionId: 'chat:1',
    sourceType: content.QuestionOriginType.Official,
    importMethod: content.QuestionImportMethod.StructuredFile,
    sourceMetadata: {
      examType: '公务员录用考试',
      examYear: 2025,
      province: '江苏',
      paperName: '2025 年江苏省公务员录用考试行测真题',
      provenance: { suppliedBy: 'user' }
    },
    candidates: [
      { raw: validQuestion('q1') },
      { raw: { id: 'q2', prompt: '缺失选项和答案' } }
    ]
  };

  const scanned = await scan.execute(command);
  assert.equal(scanned.status, content.QuestionImportDraftStatus.NeedsConfirmation);
  assert.equal(scanned.readyCount, 1);
  assert.equal(scanned.needsConfirmationCount, 1);
  assert.equal(contentRepository.bundles.length, 0, 'scan must not publish formal content');
  const resumedAfterInterruption = await drafts.findLatestPendingByOwner('chat:1');
  assert.equal(resumedAfterInterruption.draft.id, scanned.draftId, 'interrupted import must resume from its durable draft');
  assert.equal(resumedAfterInterruption.candidates.length, 2, 'resume must preserve every candidate and its validation state');
  const duplicate = await scan.execute(command);
  assert.equal(duplicate.draftId, scanned.draftId, 'scan must be idempotent');
  await assert.rejects(
    () => scan.execute({ ...command, candidates: [{ raw: validQuestion('changed') }] }),
    /reused for different content/
  );
  const grouped = await scan.execute({
    ...command,
    idempotencyKey: 'scan:official:2025-js:grouped',
    sourceMetadata: {
      ...command.sourceMetadata,
      paperName: '2025 年江苏省公务员录用考试资料分析真题'
    },
    materialGroups: [{ id: 'material-1', markdown: '某市 2024 年统计资料。' }],
    candidates: [
      { raw: { ...validQuestion('group-q1'), materialGroupId: 'material-1' } },
      { raw: { ...validQuestion('group-q2'), materialGroupId: 'material-1' } }
    ]
  });
  const groupedAggregate = await drafts.find(grouped.draftId);
  assert.deepEqual(
    groupedAggregate.candidates.map((candidate) => candidate.content.materialGroupId),
    ['material-1', 'material-1'],
    'shared material identity must be preserved in source order'
  );
  assert.equal(groupedAggregate.candidates[0].content.material.blocks[0].source, '某市 2024 年统计资料。');

  const invalidCandidate = scanned.candidates.find((candidate) => candidate.status === 'needs_confirmation');
  assert.ok(invalidCandidate);
  const confirmed = await confirm.execute({
    draftId: scanned.draftId,
    expectedVersion: scanned.version,
    rejectedCandidateIds: [invalidCandidate.candidateId]
  });
  assert.equal(confirmed.status, content.QuestionImportDraftStatus.Confirmed);
  assert.equal(confirmed.readyCount, 1);
  assert.equal(confirmed.rejectedCount, 1);
  assert.equal(contentRepository.bundles.length, 0, 'confirm must not publish formal content');

  const published = await publish.execute({
    draftId: scanned.draftId,
    expectedVersion: confirmed.version,
    idempotencyKey: 'publish:official:2025-js'
  });
  assert.equal(published.disposition, 'published');
  assert.equal(published.publishedQuestionCount, 1);
  assert.equal(contentRepository.bundles.length, 1);
  assert.equal(contentRepository.bundles[0].questionSet.questionCount, 1);
  assert.equal(contentRepository.bundles[0].questionSet.originType, content.QuestionOriginType.Official);
  assert.equal(sources.links.length, 1);
  assert.equal(generations.aggregates.length, 1);
  assert.equal(
    generations.aggregates[0].spec.promptVersionId,
    aiRuntime.questionImportPolicyV1.versionId
  );
  const repeated = await publish.execute({
    draftId: scanned.draftId,
    expectedVersion: confirmed.version,
    idempotencyKey: 'publish:official:2025-js'
  });
  assert.equal(repeated.disposition, 'already_published');
  assert.equal(contentRepository.bundles.length, 1, 'idempotent publish must not duplicate the question set');
}

async function verifyMigrationContract() {
  const [sql, registry] = await Promise.all([
    readFile(migrationPath, 'utf8'),
    readFile(path.join(
      webRoot,
      'src/capabilities/database/migrations/tutorMigrations.ts'
    ), 'utf8')
  ]);
  const checksum = crypto.createHash('sha256').update(sql).digest('hex');
  assert.match(registry, /version:\s*23/);
  assert.match(registry, /name:\s*'question_import_drafts'/);
  assert.match(registry, new RegExp(`sha256:${checksum}`));
  assert.match(sql, /CREATE TABLE question_import_drafts/);
  assert.match(sql, /CREATE TABLE question_import_candidates/);
  assert.match(sql, /CREATE TABLE question_import_publish_receipts/);
  assert.match(sql, /published question import draft is immutable/);
}

function validQuestion(id) {
  const options = ['A', 'B', 'C', 'D'].map((optionId) => ({
    id: optionId,
    text: `${optionId} 选项`
  }));
  return {
    id,
    prompt: '下列判断正确的是：',
    materialGroupId: null,
    material: null,
    options,
    correctOptionId: 'A',
    explanation: {
      knowledgePoint: '论证结构',
      conclusion: 'A 项符合题干关系。',
      steps: ['识别论点', '核对论据'],
      optionAnalysis: options.map((option) => ({
        optionId: option.id,
        verdict: option.id === 'A' ? 'correct' : 'incorrect',
        analysis: option.id === 'A' ? '符合题干。' : '不符合题干。'
      })),
      pitfalls: ['不要混淆论点与论据。']
    }
  };
}

class MemoryDraftRepository {
  aggregates = new Map();
  keys = new Map();
  receipts = new Map();

  async find(id) {
    return this.aggregates.get(id);
  }

  async findByIdempotencyKey(key) {
    const id = this.keys.get(key);
    return id ? this.aggregates.get(id) : undefined;
  }

  async findLatestPendingByOwner(ownerSessionId) {
    return [...this.aggregates.values()]
      .filter((aggregate) => aggregate.draft.ownerSessionId === ownerSessionId)
      .sort((left, right) => right.draft.updatedAt - left.draft.updatedAt)[0];
  }

  async findPublishReceipt(key) {
    return this.receipts.get(key);
  }

  async save(aggregate) {
    if (this.keys.has(aggregate.draft.idempotencyKey)) throw constraintError();
    this.aggregates.set(aggregate.draft.id, aggregate);
    this.keys.set(aggregate.draft.idempotencyKey, aggregate.draft.id);
  }

  async replace(aggregate, expectedVersion) {
    const current = this.aggregates.get(aggregate.draft.id);
    if (!current || current.draft.version !== expectedVersion) throw new Error('concurrent draft update');
    this.aggregates.set(aggregate.draft.id, aggregate);
  }

  async markPublished(draftId, expectedVersion, questionSetId, candidateQuestionIds, receipt, updatedAt) {
    const current = this.aggregates.get(draftId);
    if (!current || current.draft.version !== expectedVersion || current.draft.status !== 'confirmed') {
      throw new Error('draft is not publishable');
    }
    this.aggregates.set(draftId, {
      draft: {
        ...current.draft,
        status: 'published',
        publishedQuestionSetId: questionSetId,
        version: current.draft.version + 1,
        updatedAt
      },
      candidates: current.candidates.map((candidate) => candidateQuestionIds[candidate.id]
        ? {
            ...candidate,
            status: 'published',
            publishedQuestionId: candidateQuestionIds[candidate.id],
            updatedAt
          }
        : candidate)
    });
    this.receipts.set(receipt.idempotencyKey, receipt);
  }
}

class MemorySourceRepository {
  sources = new Map();
  links = [];
  receipts = new Map();

  async findSource(id) { return this.sources.get(id); }
  async findSourceByIdentityHash(hash) {
    return [...this.sources.values()].find((source) => source.identityHash === hash);
  }
  async findSourceByContentHash(hash) {
    return [...this.sources.values()].find((source) => source.contentHash === hash);
  }
  async findImportReceipt(key) { return this.receipts.get(key); }
  async findQuestionProvenance() { return { links: [] }; }
  async listSourceLinks() { return []; }
  async saveImport(bundle) {
    this.sources.set(bundle.source.id, bundle.source);
    this.links.push(...bundle.links);
    this.receipts.set(bundle.receipt.idempotencyKey, bundle.receipt);
  }
  async saveImportReceipt(receipt) { this.receipts.set(receipt.idempotencyKey, receipt); }
  async archiveSource() {}
}

class MemoryGenerationRepository {
  aggregates = [];
  async create(aggregate) { this.aggregates.push(aggregate); }
  async replaceWorkflow() {}
  async findByWorkflowId() { return undefined; }
  async findByIdempotencyKey() { return undefined; }
}

class MemoryContentRepository {
  bundles = [];
  schema = {
    id: 'content-schema:question-single-choice:v2',
    schemaCode: 'question.single_choice',
    documentType: 'question',
    version: '2.0.0',
    schema: {},
    contentHash: 'sha256:metadata',
    status: 'published',
    createdAt: 1
  };
  template = {
    id: 'question-template:single-choice:v2',
    templateCode: 'single_choice',
    version: '2.0.0',
    rendererCode: 'single_choice',
    contentSchemaVersionId: this.schema.id,
    config: {},
    contentHash: 'sha256:metadata',
    status: 'published',
    createdAt: 1
  };
  async findPublishedSchema() { return this.schema; }
  async findPublishedQuestionTemplate() { return this.template; }
  async commitQuestionSet(bundle) { this.bundles.push(bundle); }
  async installMetadata() {}
  async findMetadata() { return undefined; }
  async findQuestionSet() { return undefined; }
  async findQuestionSetByGenerationSpec() { return undefined; }
  async listQuestionSetLibrary() { return []; }
  async listQuestionSets() { return []; }
  async listAllQuestionSets() { return []; }
  async updateQuestionSetPracticeStatus() {}
}

class TestClock {
  value = 10_000;
  now() {
    this.value += 1;
    return this.value;
  }
}

class TestIds {
  value = 0;
  next(namespace) {
    this.value += 1;
    return `${namespace}:${this.value}`;
  }
}

async function executeWork(work) {
  return work({});
}

function constraintError() {
  return Object.assign(new Error('Key already exists in the object store'), { name: 'ConstraintError' });
}

await main();
