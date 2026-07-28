import type {
  SqlBatchStatement,
  SqlDatabase,
  SqlRow,
  SqlTransaction
} from '@/capabilities/database/contracts/SqlDatabase';
import type { SqlTransactionScope } from '@/capabilities/database/adapters/sqlite/SqlTransactionScope';
import type { TransactionContext } from '@/capabilities/database/public';
import type {
  InstantMs,
  JsonObject,
  QuestionId,
  QuestionLineageId,
  QuestionSourceId,
  QuestionSourceImportReceiptId,
  QuestionSourceLinkId,
  WorkflowId
} from '@/kernel/public';
import type {
  QuestionLineageRecord,
  QuestionProvenanceView,
  QuestionSourceImportBundle,
  QuestionSourceImportReceipt,
  QuestionSourceLinkRecord,
  QuestionSourceRecord,
  QuestionSourceRepository
} from '../contracts/QuestionSourceRepository';
import {
  QuestionCalibrationRole,
  QuestionOriginType,
  QuestionSourceRelationRole,
  QuestionSourceStatus,
  type QuestionDerivationType,
  type QuestionImportMethod
} from '../domain/QuestionSourceCodes';

interface SourceRow extends SqlRow {
  id: string;
  identity_hash: string;
  source_type: QuestionOriginType;
  provider: string | null;
  exam_type: string | null;
  exam_year: number | null;
  province: string | null;
  exam_batch: string | null;
  paper_name: string | null;
  section_name: string | null;
  provenance_json: string;
  import_method: QuestionImportMethod;
  content_hash: string;
  source_version: string;
  status: QuestionSourceStatus;
  created_at: number;
  updated_at: number;
}

interface LinkRow extends SqlRow {
  id: string;
  question_id: string;
  source_id: string;
  source_sequence: number | null;
  material_group_key: string | null;
  relation_role: QuestionSourceRelationRole;
  calibration_role: QuestionCalibrationRole;
  created_at: number;
}

interface LineageRow extends SqlRow {
  id: string;
  question_id: string;
  parent_question_id: string;
  derivation_type: QuestionDerivationType;
  generation_workflow_id: string | null;
  reference_snapshot_json: string;
  created_at: number;
}

interface ReceiptRow extends SqlRow {
  id: string;
  idempotency_key: string;
  source_id: string;
  payload_hash: string;
  imported_question_count: number;
  created_at: number;
}

export class SqliteQuestionSourceRepository implements QuestionSourceRepository {
  constructor(
    private readonly database: SqlDatabase,
    private readonly scope: SqlTransactionScope
  ) {}

  async findSource(sourceId: QuestionSourceId): Promise<QuestionSourceRecord | undefined> {
    return this.findOneSource('id = ?', sourceId);
  }

  async findSourceByIdentityHash(identityHash: string): Promise<QuestionSourceRecord | undefined> {
    return this.findOneSource('identity_hash = ?', identityHash);
  }

  async findSourceByContentHash(contentHash: string): Promise<QuestionSourceRecord | undefined> {
    return this.findOneSource('content_hash = ?', contentHash);
  }

  async findImportReceipt(idempotencyKey: string): Promise<QuestionSourceImportReceipt | undefined> {
    const rows = await this.database.query<ReceiptRow>(
      'SELECT * FROM question_source_import_receipts WHERE idempotency_key = ? LIMIT 1',
      [idempotencyKey]
    );
    return rows[0] ? mapReceipt(rows[0]) : undefined;
  }

  async findQuestionProvenance(questionId: QuestionId): Promise<QuestionProvenanceView> {
    const [links, lineages] = await Promise.all([
      this.database.query<LinkRow>(
        `SELECT * FROM question_source_links
         WHERE question_id = ?
         ORDER BY CASE relation_role WHEN 'original' THEN 0 WHEN 'reference' THEN 1 ELSE 2 END, created_at`,
        [questionId]
      ),
      this.database.query<LineageRow>(
        'SELECT * FROM question_lineage WHERE question_id = ? LIMIT 1',
        [questionId]
      )
    ]);
    const mappedLinks = links.map(mapLink);
    const primarySourceId = mappedLinks[0]?.sourceId;
    return {
      source: primarySourceId ? await this.findSource(primarySourceId) : undefined,
      links: mappedLinks,
      lineage: lineages[0] ? mapLineage(lineages[0]) : undefined
    };
  }

  async listSourceLinks(
    sourceId: QuestionSourceId,
    limit: number
  ): Promise<readonly QuestionSourceLinkRecord[]> {
    assertQueryLimit(limit);
    const rows = await this.database.query<LinkRow>(
      `SELECT * FROM question_source_links
       WHERE source_id = ?
       ORDER BY source_sequence, created_at, id
       LIMIT ?`,
      [sourceId, limit]
    );
    return rows.map(mapLink);
  }

  async saveImport(bundle: QuestionSourceImportBundle, context: TransactionContext): Promise<void> {
    const transaction = this.scope.resolve(context);
    await insertSource(transaction, bundle.source);
    const statements: SqlBatchStatement[] = [];
    for (const link of bundle.links) {
      statements.push(linkInsertStatement(link));
      if (link.relationRole === QuestionSourceRelationRole.Original) {
        statements.push(questionProjectionStatement(bundle.source, link));
      }
    }
    for (const lineage of bundle.lineages) {
      statements.push(lineageInsertStatement(lineage));
      statements.push({
        sql: 'UPDATE questions SET lineage_id = ? WHERE id = ?',
        parameters: [lineage.id, lineage.questionId]
      });
    }
    await runBatch(transaction, statements);
    await updateQuestionSetProjection(transaction, bundle.source);
    await insertReceipt(transaction, bundle.receipt);
  }

  async saveLineages(
    lineages: readonly QuestionLineageRecord[],
    context: TransactionContext
  ): Promise<void> {
    const transaction = this.scope.resolve(context);
    await runBatch(transaction, lineages.map(lineageInsertStatement));
  }

  async saveImportReceipt(
    receipt: QuestionSourceImportReceipt,
    context: TransactionContext
  ): Promise<void> {
    await insertReceipt(this.scope.resolve(context), receipt);
  }

  async archiveSource(
    sourceId: QuestionSourceId,
    updatedAt: InstantMs,
    context: TransactionContext
  ): Promise<void> {
    await this.scope.resolve(context).run(
      `UPDATE question_sources
       SET status = 'archived', updated_at = ?
       WHERE id = ? AND status = 'active'`,
      [updatedAt, sourceId]
    );
  }

  private async findOneSource(where: string, value: string): Promise<QuestionSourceRecord | undefined> {
    const rows = await this.database.query<SourceRow>(
      `SELECT * FROM question_sources WHERE ${where} LIMIT 1`,
      [value]
    );
    return rows[0] ? mapSource(rows[0]) : undefined;
  }
}

function insertSource(transaction: SqlTransaction, source: QuestionSourceRecord): Promise<unknown> {
  return transaction.run(
    `INSERT INTO question_sources(
      id,identity_hash,source_type,provider,exam_type,exam_year,province,exam_batch,paper_name,
      section_name,provenance_json,import_method,content_hash,source_version,status,created_at,updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      source.id,
      source.identityHash,
      source.sourceType,
      source.provider ?? null,
      source.examType ?? null,
      source.examYear ?? null,
      source.province ?? null,
      source.examBatch ?? null,
      source.paperName ?? null,
      source.sectionName ?? null,
      JSON.stringify(source.provenance),
      source.importMethod,
      source.contentHash,
      source.sourceVersion,
      source.status,
      source.createdAt,
      source.updatedAt
    ]
  );
}

function linkInsertStatement(link: QuestionSourceLinkRecord): SqlBatchStatement {
  return {
    sql: `INSERT INTO question_source_links(
      id,question_id,source_id,source_sequence,material_group_key,relation_role,calibration_role,created_at
    ) VALUES (?,?,?,?,?,?,?,?)`,
    parameters: [
      link.id,
      link.questionId,
      link.sourceId,
      link.sourceSequence ?? null,
      link.materialGroupKey ?? null,
      link.relationRole,
      link.calibrationRole,
      link.createdAt
    ]
  };
}

function lineageInsertStatement(lineage: QuestionLineageRecord): SqlBatchStatement {
  return {
    sql: `INSERT INTO question_lineage(
      id,question_id,parent_question_id,derivation_type,generation_workflow_id,
      reference_snapshot_json,created_at
    ) VALUES (?,?,?,?,?,?,?)`,
    parameters: [
      lineage.id,
      lineage.questionId,
      lineage.parentQuestionId,
      lineage.derivationType,
      lineage.generationWorkflowId ?? null,
      JSON.stringify(lineage.referenceSnapshot),
      lineage.createdAt
    ]
  };
}

function insertReceipt(
  transaction: SqlTransaction,
  receipt: QuestionSourceImportReceipt
): Promise<unknown> {
  return transaction.run(
    `INSERT INTO question_source_import_receipts(
      id,idempotency_key,source_id,payload_hash,imported_question_count,created_at
    ) VALUES (?,?,?,?,?,?)`,
    [
      receipt.id,
      receipt.idempotencyKey,
      receipt.sourceId,
      receipt.payloadHash,
      receipt.importedQuestionCount,
      receipt.createdAt
    ]
  );
}

function questionProjectionStatement(
  source: QuestionSourceRecord,
  link: QuestionSourceLinkRecord
): SqlBatchStatement {
  return {
    sql: `UPDATE questions SET
      origin_type = ?, source_id = ?, source_sequence = ?, calibration_role = ?, is_official = ?
     WHERE id = ?`,
    parameters: [
      source.sourceType,
      source.id,
      link.sourceSequence ?? null,
      link.calibrationRole,
      source.sourceType === QuestionOriginType.Official ? 1 : 0,
      link.questionId
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

function updateQuestionSetProjection(
  transaction: SqlTransaction,
  source: QuestionSourceRecord
): Promise<unknown> {
  return transaction.run(
    `UPDATE question_sets SET
      origin_type = ?, source_id = ?,
      calibration_role = COALESCE((
        SELECT question.calibration_role
        FROM questions question
        WHERE question.question_set_id = question_sets.id
        ORDER BY question.sequence
        LIMIT 1
      ), 'none')
     WHERE id IN (
       SELECT DISTINCT question_set_id FROM questions WHERE source_id = ?
     )
     AND NOT EXISTS (
       SELECT 1 FROM questions question
       WHERE question.question_set_id = question_sets.id
       AND (question.source_id IS NULL OR question.source_id <> ?)
     )`,
    [source.sourceType, source.id, source.id, source.id]
  );
}

function mapSource(row: SourceRow): QuestionSourceRecord {
  return {
    id: row.id as QuestionSourceId,
    identityHash: row.identity_hash,
    sourceType: row.source_type,
    provider: row.provider ?? undefined,
    examType: row.exam_type ?? undefined,
    examYear: row.exam_year ?? undefined,
    province: row.province ?? undefined,
    examBatch: row.exam_batch ?? undefined,
    paperName: row.paper_name ?? undefined,
    sectionName: row.section_name ?? undefined,
    provenance: parseObject(row.provenance_json, 'question_sources.provenance_json'),
    importMethod: row.import_method,
    contentHash: row.content_hash,
    sourceVersion: row.source_version,
    status: row.status,
    createdAt: row.created_at as InstantMs,
    updatedAt: row.updated_at as InstantMs
  };
}

function mapLink(row: LinkRow): QuestionSourceLinkRecord {
  return {
    id: row.id as QuestionSourceLinkId,
    questionId: row.question_id as QuestionId,
    sourceId: row.source_id as QuestionSourceId,
    sourceSequence: row.source_sequence ?? undefined,
    materialGroupKey: row.material_group_key ?? undefined,
    relationRole: row.relation_role,
    calibrationRole: row.calibration_role,
    createdAt: row.created_at as InstantMs
  };
}

function mapLineage(row: LineageRow): QuestionLineageRecord {
  return {
    id: row.id as QuestionLineageId,
    questionId: row.question_id as QuestionId,
    parentQuestionId: row.parent_question_id as QuestionId,
    derivationType: row.derivation_type,
    generationWorkflowId: row.generation_workflow_id as WorkflowId | null ?? undefined,
    referenceSnapshot: parseObject(row.reference_snapshot_json, 'question_lineage.reference_snapshot_json'),
    createdAt: row.created_at as InstantMs
  };
}

function mapReceipt(row: ReceiptRow): QuestionSourceImportReceipt {
  return {
    id: row.id as QuestionSourceImportReceiptId,
    idempotencyKey: row.idempotency_key,
    sourceId: row.source_id as QuestionSourceId,
    payloadHash: row.payload_hash,
    importedQuestionCount: row.imported_question_count,
    createdAt: row.created_at as InstantMs
  };
}

function parseObject(serialized: string, field: string): JsonObject {
  const value: unknown = JSON.parse(serialized);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${field} must contain an object`);
  }
  return value as JsonObject;
}

function assertQueryLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new RangeError('Question source query limit must be between 1 and 500');
  }
}
