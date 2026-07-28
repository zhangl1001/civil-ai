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
  'src/capabilities/database/migrations/022_question_source_foundation.sql'
);
const webResearchMigrationPath = path.join(
  webRoot,
  'src/capabilities/database/migrations/027_web_research_import_method.sql'
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
    const content = await server.ssrLoadModule('/src/modules/content/public.ts');
    await verifyImportContract(content);
    await verifyMigrationContract();
    console.log('Question source foundation verification passed.');
  } finally {
    await server.close();
  }
}

async function verifyImportContract(content) {
  const repository = new MemoryQuestionSourceRepository();
  const clock = { now: () => 10_000 };
  const ids = new TestIds();
  const executeWork = async (work) => work({});
  const importer = new content.ImportQuestionSource(
    { run: executeWork, runAutocommit: executeWork },
    repository,
    clock,
    ids
  );
  const archiver = new content.ArchiveQuestionSource(
    { run: executeWork, runAutocommit: executeWork },
    repository,
    clock
  );
  const command = {
    idempotencyKey: 'import:official:2025-js-a',
    sourceType: content.QuestionOriginType.Official,
    provider: '江苏省公务员局',
    examType: '公务员录用考试',
    examYear: 2025,
    province: '江苏',
    examBatch: 'A 类',
    paperName: '2025 年江苏省公务员录用考试行政职业能力测验',
    sectionName: '判断推理',
    provenance: { suppliedBy: 'user', rights: 'local_personal_use' },
    importMethod: content.QuestionImportMethod.StructuredFile,
    contentHash: 'sha256:official-paper-content',
    links: [
      { questionId: 'QuestionId:1', sourceSequence: 1 },
      { questionId: 'QuestionId:2', sourceSequence: 2 }
    ]
  };

  const created = await importer.execute(command);
  const duplicate = await importer.execute(command);
  assert.equal(created.disposition, 'created');
  assert.equal(duplicate.disposition, 'already_imported');
  assert.equal(duplicate.source.id, created.source.id);
  assert.equal(repository.sources.size, 1, 'duplicate import must not create another source');
  assert.equal(repository.links.length, 2, 'duplicate import must not create another set of links');

  await assert.rejects(
    () => importer.execute({
      ...command,
      contentHash: 'sha256:different-paper-content'
    }),
    /already used for different content/
  );
  await assert.rejects(
    () => importer.execute({
      ...command,
      idempotencyKey: 'import:official:2025-js-a:v2',
      contentHash: 'sha256:different-paper-content'
    }),
    /use a new sourceVersion/
  );
  await assert.rejects(
    () => importer.execute({
      ...command,
      idempotencyKey: 'import:variant:no-lineage',
      sourceType: content.QuestionOriginType.AiVariant,
      importMethod: content.QuestionImportMethod.AgentCreated,
      paperName: undefined,
      examYear: undefined
    }),
    /require question lineage/
  );
  const anonymousImportA = await importer.execute({
    idempotencyKey: 'import:anonymous:a',
    sourceType: content.QuestionOriginType.Imported,
    provenance: { suppliedBy: 'user' },
    importMethod: content.QuestionImportMethod.ManualText,
    contentHash: 'sha256:anonymous-content-a',
    links: [{ questionId: 'QuestionId:3', sourceSequence: 1 }]
  });
  const anonymousImportB = await importer.execute({
    idempotencyKey: 'import:anonymous:b',
    sourceType: content.QuestionOriginType.Imported,
    provenance: { suppliedBy: 'user' },
    importMethod: content.QuestionImportMethod.ManualText,
    contentHash: 'sha256:anonymous-content-b',
    links: [{ questionId: 'QuestionId:4', sourceSequence: 1 }]
  });
  assert.notEqual(
    anonymousImportA.source.identityHash,
    anonymousImportB.source.identityHash,
    'anonymous imports must fall back to their content fingerprint'
  );

  await archiver.execute(created.source.id);
  assert.equal(repository.sources.get(created.source.id).status, content.QuestionSourceStatus.Archived);
  assert.equal(
    repository.links.filter((link) => link.sourceId === created.source.id).length,
    2,
    'archiving a source must retain evidence-facing links'
  );
}

async function verifyMigrationContract() {
  const [sql, webResearchSql, registry] = await Promise.all([
    readFile(migrationPath, 'utf8'),
    readFile(webResearchMigrationPath, 'utf8'),
    readFile(path.join(
      webRoot,
      'src/capabilities/database/migrations/tutorMigrations.ts'
    ), 'utf8')
  ]);
  const checksum = crypto.createHash('sha256').update(sql).digest('hex');
  const webResearchChecksum = crypto.createHash('sha256').update(webResearchSql).digest('hex');
  assert.match(registry, /version:\s*22/);
  assert.match(registry, /name:\s*'question_source_foundation'/);
  assert.match(registry, new RegExp(`sha256:${checksum}`));
  assert.match(sql, /CREATE TABLE question_sources/);
  assert.match(sql, /CREATE TABLE question_source_links/);
  assert.match(sql, /CREATE TABLE question_lineage/);
  assert.match(sql, /CREATE TABLE question_source_import_receipts/);
  assert.match(sql, /official_question_content_immutable_update/);
  assert.match(sql, /official_question_immutable_delete/);
  assert.match(sql, /identity_hash TEXT NOT NULL UNIQUE/);
  assert.match(sql, /content_hash TEXT NOT NULL UNIQUE/);
  assert.match(registry, /version:\s*27/);
  assert.match(registry, /name:\s*'web_research_import_method'/);
  assert.match(registry, new RegExp(`sha256:${webResearchChecksum}`));
  assert.match(webResearchSql, /'web_research'/);
  assert.match(webResearchSql, /CREATE TABLE question_sources/);
  assert.match(webResearchSql, /CREATE TABLE question_import_drafts/);
}

class MemoryQuestionSourceRepository {
  sources = new Map();
  receipts = new Map();
  links = [];
  lineages = [];

  async findSource(id) {
    return this.sources.get(id);
  }

  async findSourceByIdentityHash(hash) {
    return [...this.sources.values()].find((source) => source.identityHash === hash);
  }

  async findSourceByContentHash(hash) {
    return [...this.sources.values()].find((source) => source.contentHash === hash);
  }

  async findImportReceipt(key) {
    return this.receipts.get(key);
  }

  async findQuestionProvenance(questionId) {
    const links = this.links.filter((link) => link.questionId === questionId);
    return {
      source: links[0] ? this.sources.get(links[0].sourceId) : undefined,
      links,
      lineage: this.lineages.find((lineage) => lineage.questionId === questionId)
    };
  }

  async listSourceLinks(sourceId, limit) {
    return this.links.filter((link) => link.sourceId === sourceId).slice(0, limit);
  }

  async saveImport(bundle) {
    if ([...this.sources.values()].some((source) => (
      source.identityHash === bundle.source.identityHash || source.contentHash === bundle.source.contentHash
    ))) {
      throw constraintError();
    }
    this.sources.set(bundle.source.id, bundle.source);
    this.links.push(...bundle.links);
    this.lineages.push(...bundle.lineages);
    this.receipts.set(bundle.receipt.idempotencyKey, bundle.receipt);
  }

  async saveImportReceipt(receipt) {
    if (this.receipts.has(receipt.idempotencyKey)) throw constraintError();
    this.receipts.set(receipt.idempotencyKey, receipt);
  }

  async archiveSource(sourceId, updatedAt) {
    const source = this.sources.get(sourceId);
    if (source) this.sources.set(sourceId, { ...source, status: 'archived', updatedAt });
  }
}

class TestIds {
  value = 0;

  next(namespace) {
    this.value += 1;
    return `${namespace}:${this.value}`;
  }
}

function constraintError() {
  return Object.assign(new Error('Key already exists in the object store'), { name: 'ConstraintError' });
}

await main();
