import type {
  SqlBatchStatement,
  SqlDatabase,
  SqlRow,
  SqlTransaction
} from '@/capabilities/database/contracts/SqlDatabase';
import type { SqlTransactionScope } from '@/capabilities/database/adapters/sqlite/SqlTransactionScope';
import type { TransactionContext } from '@/capabilities/database/public';
import type {
  CapabilityNodeId,
  ExamCycleId,
  InstantMs,
  JsonObject,
  QuestionId,
  QuestionImportCandidateId,
  QuestionImportDraftId,
  QuestionImportPublishReceiptId,
  QuestionSetId,
  QuestionSourceId
} from '@/kernel/public';
import type {
  QuestionImportCandidateRecord,
  QuestionImportDraftAggregate,
  QuestionImportDraftRecord,
  QuestionImportDraftRepository,
  QuestionImportIssue,
  QuestionImportPublishReceipt,
  QuestionImportSourceMetadata
} from '../contracts/QuestionImportDraftRepository';
import type { SingleChoiceQuestionContent } from '../contracts/QuestionContent';
import type {
  QuestionImportCandidateStatus,
  QuestionImportDraftStatus
} from '../domain/QuestionImportCodes';
import type {
  QuestionImportMethod,
  QuestionOriginType
} from '../domain/QuestionSourceCodes';

interface DraftRow extends SqlRow {
  id: string;
  exam_cycle_id: string;
  capability_node_id: string;
  capability_code: string;
  module: string;
  owner_session_id: string | null;
  source_type: QuestionOriginType;
  import_method: QuestionImportMethod;
  source_metadata_json: string;
  raw_payload_hash: string;
  status: QuestionImportDraftStatus;
  issues_json: string;
  idempotency_key: string;
  published_question_set_id: string | null;
  version: number;
  created_at: number;
  updated_at: number;
}

interface CandidateRow extends SqlRow {
  id: string;
  draft_id: string;
  sequence: number;
  raw_json: string;
  content_json: string | null;
  content_hash: string | null;
  difficulty: number;
  status: QuestionImportCandidateStatus;
  issues_json: string;
  published_question_id: string | null;
  created_at: number;
  updated_at: number;
}

interface ReceiptRow extends SqlRow {
  id: string;
  draft_id: string;
  idempotency_key: string;
  payload_hash: string;
  question_set_id: string;
  source_id: string;
  published_question_count: number;
  created_at: number;
}

export class SqliteQuestionImportDraftRepository implements QuestionImportDraftRepository {
  constructor(
    private readonly database: SqlDatabase,
    private readonly scope: SqlTransactionScope
  ) {}

  async find(draftId: QuestionImportDraftId): Promise<QuestionImportDraftAggregate | undefined> {
    const rows = await this.database.query<DraftRow>(
      'SELECT * FROM question_import_drafts WHERE id = ? LIMIT 1',
      [draftId]
    );
    return rows[0] ? this.loadAggregate(rows[0]) : undefined;
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<QuestionImportDraftAggregate | undefined> {
    const rows = await this.database.query<DraftRow>(
      'SELECT * FROM question_import_drafts WHERE idempotency_key = ? LIMIT 1',
      [idempotencyKey]
    );
    return rows[0] ? this.loadAggregate(rows[0]) : undefined;
  }

  async findLatestPendingByOwner(ownerSessionId: string): Promise<QuestionImportDraftAggregate | undefined> {
    const rows = await this.database.query<DraftRow>(
      `SELECT * FROM question_import_drafts
       WHERE owner_session_id = ? AND status IN ('needs_confirmation', 'confirmed')
       ORDER BY updated_at DESC LIMIT 1`,
      [ownerSessionId]
    );
    return rows[0] ? this.loadAggregate(rows[0]) : undefined;
  }

  async findPublishReceipt(idempotencyKey: string): Promise<QuestionImportPublishReceipt | undefined> {
    const rows = await this.database.query<ReceiptRow>(
      'SELECT * FROM question_import_publish_receipts WHERE idempotency_key = ? LIMIT 1',
      [idempotencyKey]
    );
    return rows[0] ? mapReceipt(rows[0]) : undefined;
  }

  async save(aggregate: QuestionImportDraftAggregate, context: TransactionContext): Promise<void> {
    const transaction = this.scope.resolve(context);
    await insertDraft(transaction, aggregate.draft);
    await runBatch(transaction, aggregate.candidates.map(candidateInsertStatement));
  }

  async replace(
    aggregate: QuestionImportDraftAggregate,
    expectedVersion: number,
    context: TransactionContext
  ): Promise<void> {
    const transaction = this.scope.resolve(context);
    const result = await transaction.run(
      `UPDATE question_import_drafts SET
        source_metadata_json = ?, raw_payload_hash = ?, status = ?, issues_json = ?,
        version = ?, updated_at = ?
       WHERE id = ? AND version = ? AND status <> 'published'`,
      [
        JSON.stringify(aggregate.draft.sourceMetadata),
        aggregate.draft.rawPayloadHash,
        aggregate.draft.status,
        JSON.stringify(aggregate.draft.issues),
        aggregate.draft.version,
        aggregate.draft.updatedAt,
        aggregate.draft.id,
        expectedVersion
      ]
    );
    if (result.changes !== 1) throw new Error('Question import draft was changed concurrently');
    await transaction.run('DELETE FROM question_import_candidates WHERE draft_id = ?', [aggregate.draft.id]);
    await runBatch(transaction, aggregate.candidates.map(candidateInsertStatement));
  }

  async markPublished(
    draftId: QuestionImportDraftId,
    expectedVersion: number,
    questionSetId: QuestionSetId,
    candidateQuestionIds: Readonly<Record<string, QuestionId>>,
    receipt: QuestionImportPublishReceipt,
    updatedAt: InstantMs,
    context: TransactionContext
  ): Promise<void> {
    const transaction = this.scope.resolve(context);
    const result = await transaction.run(
      `UPDATE question_import_drafts
       SET status = 'published', published_question_set_id = ?, version = version + 1, updated_at = ?
       WHERE id = ? AND version = ? AND status = 'confirmed'`,
      [questionSetId, updatedAt, draftId, expectedVersion]
    );
    if (result.changes !== 1) throw new Error('Question import draft is not publishable');
    const candidateEntries = Object.entries(candidateQuestionIds);
    const candidateResult = await transaction.run(
      `UPDATE question_import_candidates
       SET status = 'published',
           published_question_id = CASE id ${candidateEntries.map(() => 'WHEN ? THEN ?').join(' ')} END,
           updated_at = ?
       WHERE draft_id = ? AND status = 'ready'
         AND id IN (${candidateEntries.map(() => '?').join(', ')})`,
      [
        ...candidateEntries.flatMap(([candidateId, questionId]) => [candidateId, questionId]),
        updatedAt,
        draftId,
        ...candidateEntries.map(([candidateId]) => candidateId)
      ]
    );
    if (candidateResult.changes !== candidateEntries.length) {
      throw new Error('One or more question import candidates are not publishable');
    }
    await transaction.run(
      `INSERT INTO question_import_publish_receipts(
        id, draft_id, idempotency_key, payload_hash, question_set_id,
        source_id, published_question_count, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        receipt.id,
        receipt.draftId,
        receipt.idempotencyKey,
        receipt.payloadHash,
        receipt.questionSetId,
        receipt.sourceId,
        receipt.publishedQuestionCount,
        receipt.createdAt
      ]
    );
  }

  private async loadAggregate(row: DraftRow): Promise<QuestionImportDraftAggregate> {
    const candidates = await this.database.query<CandidateRow>(
      'SELECT * FROM question_import_candidates WHERE draft_id = ? ORDER BY sequence',
      [row.id]
    );
    return {
      draft: mapDraft(row),
      candidates: candidates.map(mapCandidate)
    };
  }
}

async function insertDraft(transaction: SqlTransaction, draft: QuestionImportDraftRecord): Promise<void> {
  await transaction.run(
    `INSERT INTO question_import_drafts(
      id, exam_cycle_id, capability_node_id, capability_code, module, owner_session_id, source_type,
      import_method, source_metadata_json, raw_payload_hash, status, issues_json,
      idempotency_key, published_question_set_id, version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      draft.id,
      draft.examCycleId,
      draft.capabilityNodeId,
      draft.capabilityCode,
      draft.module,
      draft.ownerSessionId ?? null,
      draft.sourceType,
      draft.importMethod,
      JSON.stringify(draft.sourceMetadata),
      draft.rawPayloadHash,
      draft.status,
      JSON.stringify(draft.issues),
      draft.idempotencyKey,
      draft.publishedQuestionSetId ?? null,
      draft.version,
      draft.createdAt,
      draft.updatedAt
    ]
  );
}

function candidateInsertStatement(candidate: QuestionImportCandidateRecord): SqlBatchStatement {
  return {
    sql: `INSERT INTO question_import_candidates(
      id, draft_id, sequence, raw_json, content_json, content_hash, difficulty,
      status, issues_json, published_question_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    parameters: [
      candidate.id,
      candidate.draftId,
      candidate.sequence,
      JSON.stringify(candidate.raw),
      candidate.content ? JSON.stringify(candidate.content) : null,
      candidate.contentHash ?? null,
      candidate.difficulty,
      candidate.status,
      JSON.stringify(candidate.issues),
      candidate.publishedQuestionId ?? null,
      candidate.createdAt,
      candidate.updatedAt
    ]
  };
}

async function runBatch(transaction: SqlTransaction, statements: readonly SqlBatchStatement[]): Promise<void> {
  if (!statements.length) return;
  if (transaction.runBatch) {
    await transaction.runBatch(statements);
    return;
  }
  for (const statement of statements) await transaction.run(statement.sql, statement.parameters);
}

function mapDraft(row: DraftRow): QuestionImportDraftRecord {
  return {
    id: row.id as QuestionImportDraftId,
    examCycleId: row.exam_cycle_id as ExamCycleId,
    capabilityNodeId: row.capability_node_id as CapabilityNodeId,
    capabilityCode: row.capability_code,
    module: row.module,
    ownerSessionId: row.owner_session_id ?? undefined,
    sourceType: row.source_type,
    importMethod: row.import_method,
    sourceMetadata: parseObject(row.source_metadata_json, 'question_import_drafts.source_metadata_json') as unknown as QuestionImportSourceMetadata,
    rawPayloadHash: row.raw_payload_hash,
    status: row.status,
    issues: parseIssues(row.issues_json),
    idempotencyKey: row.idempotency_key,
    publishedQuestionSetId: row.published_question_set_id as QuestionSetId | null ?? undefined,
    version: row.version,
    createdAt: row.created_at as InstantMs,
    updatedAt: row.updated_at as InstantMs
  };
}

function mapCandidate(row: CandidateRow): QuestionImportCandidateRecord {
  return {
    id: row.id as QuestionImportCandidateId,
    draftId: row.draft_id as QuestionImportDraftId,
    sequence: row.sequence,
    raw: parseObject(row.raw_json, 'question_import_candidates.raw_json'),
    content: row.content_json
      ? parseObject(row.content_json, 'question_import_candidates.content_json') as unknown as SingleChoiceQuestionContent
      : undefined,
    contentHash: row.content_hash ?? undefined,
    difficulty: row.difficulty,
    status: row.status,
    issues: parseIssues(row.issues_json),
    publishedQuestionId: row.published_question_id as QuestionId | null ?? undefined,
    createdAt: row.created_at as InstantMs,
    updatedAt: row.updated_at as InstantMs
  };
}

function mapReceipt(row: ReceiptRow): QuestionImportPublishReceipt {
  return {
    id: row.id as QuestionImportPublishReceiptId,
    draftId: row.draft_id as QuestionImportDraftId,
    idempotencyKey: row.idempotency_key,
    payloadHash: row.payload_hash,
    questionSetId: row.question_set_id as QuestionSetId,
    sourceId: row.source_id as QuestionSourceId,
    publishedQuestionCount: row.published_question_count,
    createdAt: row.created_at as InstantMs
  };
}

function parseIssues(serialized: string): readonly QuestionImportIssue[] {
  const value: unknown = JSON.parse(serialized);
  if (!Array.isArray(value)) throw new TypeError('Question import issues must be an array');
  return value as QuestionImportIssue[];
}

function parseObject(serialized: string, field: string): JsonObject {
  const value: unknown = JSON.parse(serialized);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${field} must contain an object`);
  return value as JsonObject;
}
