import type { SqlDatabase, SqlRow, SqlTransaction } from '@/capabilities/database/contracts/SqlDatabase';
import type { SqlTransactionScope } from '@/capabilities/database/adapters/sqlite/SqlTransactionScope';
import type { TransactionContext } from '@/capabilities/database/public';
import type {
  CapabilityNodeId,
  ContentDocumentId,
  ContentSchemaVersionId,
  ExamCycleId,
  GenerationSpecId,
  InstantMs,
  JsonObject,
  LectureId,
  LearningThreadId,
  QuestionLineageId,
  QuestionReferencePackId,
  QuestionSourceId,
  TeachingBlueprintId,
  QuestionId,
  QuestionSetId,
  QuestionTemplateVersionId,
  PromptVersionId,
  AssessmentRole,
  WorkflowId
} from '@/kernel/public';
import { ContentSchemaValidator } from '../application/ContentSchemaValidator';
import type {
  CommittedQuestionSetBundle,
  ContentDocumentRecord,
  ContentMetadataBundle,
  ContentRepository,
  ContentSchemaVersion,
  GenerationSpecRecord,
  GenerationWorkflowRecord,
  LectureRecord,
  QuestionCapabilityLink,
  QuestionRecord,
  QuestionSetLibraryEntry,
  QuestionSetLibraryQuery,
  QuestionSetEnrichmentPatch,
  QuestionSetRecord,
  QuestionTemplateVersion
} from '../contracts/ContentRepository';
import type {
  ContentAssetStatus,
  ContentDocumentType,
  GenerationWorkflowStatus,
  GenerationWorkflowStep,
  PublishedAssetStatus,
  QuestionQualityStatus,
  QuestionSetPracticeStatus,
  QuestionSetPurpose,
  QuestionSetStatus,
  QuestionTemplateCode
} from '../domain/ContentCodes';
import { QuestionSetEntryMode } from '../domain/ContentCodes';
import { assertCommittedQuestionSetBundle, assertQuestionSetQueryLimit } from '../domain/ContentBundlePolicy';
import { resolveQuestionSetEntryMode } from '../domain/QuestionSetEntryModePolicy';
import type {
  QuestionCalibrationRole,
  QuestionGenerationIntent,
  QuestionOriginType
} from '../domain/QuestionSourceCodes';
import { applyQuestionSetEnrichmentSql } from './ApplyQuestionSetEnrichmentSql';
import { appendQuestionSetLibraryQuery } from './QuestionSetLibraryQuerySql';

interface ReleaseRow extends SqlRow { id: string; content_hash: string; }
interface SchemaRow extends SqlRow {
  id: string; schema_code: string; document_type: ContentDocumentType; version: string;
  schema_json: string; content_hash: string; status: PublishedAssetStatus; created_at: number;
}
interface TemplateRow extends SqlRow {
  id: string; template_code: QuestionTemplateCode; version: string; renderer_code: string;
  content_schema_version_id: string; config_json: string; content_hash: string;
  status: PublishedAssetStatus; created_at: number;
}
interface SpecRow extends SqlRow {
  id: string; exam_cycle_id: string; learning_thread_id: string | null; teaching_blueprint_id: string | null; capability_node_id: string; content_kind: GenerationSpecRecord['contentKind'];
  assessment_role: AssessmentRole; question_template_version_id: string | null; content_schema_version_id: string;
  prompt_version_id: string;
  reference_pack_id: string | null; reference_policy_version: string | null;
  generation_intent: QuestionGenerationIntent | null; calibration_target: string | null;
  requested_count: number | null; difficulty_json: string; constraints_json: string; context_snapshot_json: string;
  content_hash: string; created_at: number;
}
interface WorkflowRow extends SqlRow {
  id: string; exam_cycle_id: string; generation_spec_id: string; workflow_type: GenerationWorkflowRecord['workflowType'];
  status: GenerationWorkflowStatus; current_step: GenerationWorkflowStep; attempt_count: number;
  staged_result_json: string | null; validation_json: string; error_code: string | null; idempotency_key: string;
  started_at: number; completed_at: number | null; updated_at: number; version: number;
}
interface DocumentRow extends SqlRow {
  id: string; exam_cycle_id: string; document_type: ContentDocumentType; schema_version_id: string;
  title: string | null; content_json: string; content_hash: string; status: ContentAssetStatus;
  content_version: number; supersedes_document_id: string | null; generator_workflow_id: string | null; created_at: number;
}
interface LectureRow extends SqlRow {
  id: string; exam_cycle_id: string; learning_thread_id: string | null; teaching_blueprint_id: string | null; capability_node_id: string; content_document_id: string;
  objective: string; status: LectureRecord['status']; version: number; created_at: number;
}
interface QuestionSetRow extends SqlRow {
  id: string; exam_cycle_id: string; learning_thread_id: string | null; teaching_blueprint_id: string | null; capability_node_id: string; generation_spec_id: string;
  purpose: QuestionSetPurpose; assessment_role: AssessmentRole; module: string; status: QuestionSetStatus;
  origin_type: QuestionOriginType; source_id: string | null; calibration_role: QuestionCalibrationRole;
  practice_status: QuestionSetPracticeStatus; entry_mode: QuestionSetEntryMode; question_count: number; content_hash: string | null; content_version: number; created_at: number;
}
interface QuestionSetLibraryRow extends QuestionSetRow {
  constraints_json: string;
  source_type: QuestionOriginType | null;
  source_provider: string | null;
  source_exam_type: string | null;
  source_exam_year: number | null;
  source_province: string | null;
  source_exam_batch: string | null;
  source_paper_name: string | null;
  source_section_name: string | null;
}
interface QuestionRow extends SqlRow {
  id: string; question_set_id: string; exam_cycle_id: string; capability_node_id: string;
  question_template_version_id: string; sequence: number; difficulty: number; cognitive_level: string;
  purpose: string; assessment_role: AssessmentRole; variant_group_id: string | null; content_json: string;
  origin_type: QuestionOriginType; source_id: string | null; source_sequence: number | null;
  lineage_id: string | null; calibration_role: QuestionCalibrationRole; is_official: number;
  correct_answer_json: string; quality_status: QuestionQualityStatus; content_hash: string;
  content_schema_version_id: string; content_version: number; generator_workflow_id: string; created_at: number;
}
interface CapabilityLinkRow extends SqlRow {
  question_id: string; capability_node_id: string; relation_role: QuestionCapabilityLink['relationRole']; weight: number;
}
interface LectureLinkRow extends SqlRow {
  lecture_id: string; question_set_id: string; relation_role: 'primary' | 'extension' | 'review';
}

export class SqliteContentRepository implements ContentRepository {
  private readonly validator = new ContentSchemaValidator();

  constructor(
    private readonly database: SqlDatabase,
    private readonly transactionScope: SqlTransactionScope
  ) {}

  async installMetadata(bundle: ContentMetadataBundle, context: TransactionContext): Promise<void> {
    const transaction = this.transactionScope.resolve(context);
    const createdAt = bundle.schemaVersions[0]?.createdAt ?? bundle.questionTemplateVersions[0]?.createdAt;
    if (createdAt === undefined) throw new Error('Content metadata release cannot be empty');
    await transaction.run(
      `INSERT INTO content_metadata_releases(id, version, content_hash, status, created_at)
       VALUES (?, ?, ?, 'published', ?)`,
      [bundle.releaseId, releaseVersion(bundle), bundle.contentHash, createdAt]
    );
    for (const schema of bundle.schemaVersions) await this.insertSchema(transaction, bundle.releaseId, schema);
    for (const template of bundle.questionTemplateVersions) await this.insertTemplate(transaction, bundle.releaseId, template);
  }

  async findMetadata(releaseId: string): Promise<ContentMetadataBundle | undefined> {
    const releases = await this.database.query<ReleaseRow>(
      'SELECT id, content_hash FROM content_metadata_releases WHERE id = ? LIMIT 1',
      [releaseId]
    );
    const release = releases[0];
    if (!release) return undefined;
    const [schemas, templates] = await Promise.all([
      this.database.query<SchemaRow>('SELECT * FROM content_schema_versions WHERE release_id = ? ORDER BY created_at, id', [releaseId]),
      this.database.query<TemplateRow>('SELECT * FROM question_template_versions WHERE release_id = ? ORDER BY created_at, id', [releaseId])
    ]);
    return {
      releaseId: release.id,
      contentHash: release.content_hash,
      schemaVersions: schemas.map((row) => this.mapSchema(row)),
      questionTemplateVersions: templates.map((row) => this.mapTemplate(row))
    };
  }

  async findPublishedSchema(schemaCode: string): Promise<ContentSchemaVersion | undefined> {
    const rows = await this.database.query<SchemaRow>(
      `SELECT * FROM content_schema_versions
       WHERE schema_code = ? AND status = 'published'
       ORDER BY created_at DESC LIMIT 1`,
      [schemaCode]
    );
    return rows[0] ? this.mapSchema(rows[0]) : undefined;
  }

  async findPublishedQuestionTemplate(templateCode: QuestionTemplateCode): Promise<QuestionTemplateVersion | undefined> {
    const rows = await this.database.query<TemplateRow>(
      `SELECT * FROM question_template_versions
       WHERE template_code = ? AND status = 'published'
       ORDER BY created_at DESC LIMIT 1`,
      [templateCode]
    );
    return rows[0] ? this.mapTemplate(rows[0]) : undefined;
  }

  async commitQuestionSet(bundle: CommittedQuestionSetBundle, context: TransactionContext): Promise<void> {
    assertCommittedQuestionSetBundle(bundle);
    const transaction = this.transactionScope.resolve(context);
    for (const document of bundle.documents) await this.insertDocument(transaction, document);
    for (const lecture of bundle.lectures) await this.insertLecture(transaction, lecture);
    await this.insertQuestionSet(
      transaction,
      bundle.questionSet,
      resolveQuestionSetEntryMode(bundle.generationSpec.constraints)
    );
    for (const link of bundle.lectureLinks) {
      await transaction.run(
        'INSERT INTO lecture_question_sets(lecture_id, question_set_id, relation_role) VALUES (?, ?, ?)',
        [link.lectureId, link.questionSetId, link.relationRole]
      );
    }
    for (const question of bundle.questions) await this.insertQuestion(transaction, question);
    for (const link of bundle.capabilityLinks) {
      const question = bundle.questions.find((candidate) => candidate.id === link.questionId);
      if (link.relationRole === 'primary' && question?.capabilityNodeId === link.capabilityNodeId) continue;
      await transaction.run(
        `INSERT INTO question_capabilities(question_id, capability_node_id, relation_role, weight)
         VALUES (?, ?, ?, ?)`,
        [link.questionId, link.capabilityNodeId, link.relationRole, link.weight]
      );
    }
  }

  async findQuestionSet(questionSetId: QuestionSetId): Promise<CommittedQuestionSetBundle | undefined> {
    const rows = await this.database.query<QuestionSetRow>('SELECT * FROM question_sets WHERE id = ? LIMIT 1', [questionSetId]);
    return rows[0] ? this.loadBundle(rows[0]) : undefined;
  }

  async findQuestionSetByGenerationSpec(
    generationSpecId: GenerationSpecId
  ): Promise<CommittedQuestionSetBundle | undefined> {
    const rows = await this.database.query<QuestionSetRow>(
      `SELECT * FROM question_sets
       WHERE generation_spec_id = ? AND status = 'ready'
       ORDER BY created_at DESC LIMIT 1`,
      [generationSpecId]
    );
    return rows[0] ? this.loadBundle(rows[0]) : undefined;
  }

  async listQuestionSetLibrary(
    examCycleId: ExamCycleId,
    limit: number
  ): Promise<readonly QuestionSetLibraryEntry[]> {
    return this.queryQuestionSetLibrary({ examCycleId, limit });
  }

  async queryQuestionSetLibrary(
    query: QuestionSetLibraryQuery
  ): Promise<readonly QuestionSetLibraryEntry[]> {
    const { examCycleId, limit } = query;
    assertQuestionSetQueryLimit(limit);
    const filters = [`question_set.exam_cycle_id = ?`, `question_set.status = 'ready'`];
    const params: Array<string | number> = [examCycleId];
    appendQuestionSetLibraryQuery(filters, params, query);
    const rows = await this.database.query<QuestionSetLibraryRow>(
      `SELECT question_set.*, generation_spec.constraints_json,
              source.source_type,
              source.provider AS source_provider,
              source.exam_type AS source_exam_type,
              source.exam_year AS source_exam_year,
              source.province AS source_province,
              source.exam_batch AS source_exam_batch,
              source.paper_name AS source_paper_name,
              source.section_name AS source_section_name
       FROM question_sets question_set
       JOIN generation_specs generation_spec ON generation_spec.id = question_set.generation_spec_id
       LEFT JOIN question_sources source ON source.id = question_set.source_id AND source.status = 'active'
       WHERE ${filters.join(' AND ')}
       ORDER BY question_set.created_at DESC, question_set.id DESC LIMIT ?`,
      [...params, limit]
    );
    return rows.map((row) => {
      const constraints = parseJsonObject(row.constraints_json, 'generation_specs.constraints_json');
      return {
        id: row.id as QuestionSetId,
        examCycleId: row.exam_cycle_id as ExamCycleId,
        learningThreadId: row.learning_thread_id as LearningThreadId | null ?? undefined,
        capabilityNodeId: row.capability_node_id as CapabilityNodeId,
        purpose: row.purpose,
        assessmentRole: row.assessment_role,
        module: row.module,
        questionCount: row.question_count,
        practiceStatus: row.practice_status,
        entryMode: row.entry_mode,
        source: typeof constraints.source === 'string' ? constraints.source : undefined,
        originType: row.origin_type,
        sourceId: row.source_id as QuestionSourceId | null ?? undefined,
        sourceMetadata: row.source_type ? {
          sourceType: row.source_type,
          provider: row.source_provider ?? undefined,
          examType: row.source_exam_type ?? undefined,
          examYear: row.source_exam_year ?? undefined,
          province: row.source_province ?? undefined,
          examBatch: row.source_exam_batch ?? undefined,
          paperName: row.source_paper_name ?? undefined,
          sectionName: row.source_section_name ?? undefined
        } : undefined,
        createdAt: row.created_at as InstantMs
      };
    });
  }

  async listQuestionSets(examCycleId: ExamCycleId, limit: number): Promise<readonly CommittedQuestionSetBundle[]> {
    assertQuestionSetQueryLimit(limit);
    const rows = await this.database.query<QuestionSetRow>(
      `SELECT * FROM question_sets WHERE exam_cycle_id = ? AND status = 'ready'
       ORDER BY created_at DESC LIMIT ?`,
      [examCycleId, limit]
    );
    return Promise.all(rows.map((row) => this.loadBundle(row)));
  }

  async listAllQuestionSets(examCycleId: ExamCycleId): Promise<readonly CommittedQuestionSetBundle[]> {
    const rows = await this.database.query<QuestionSetRow>(
      `SELECT * FROM question_sets WHERE exam_cycle_id = ? AND status = 'ready'
       ORDER BY created_at DESC`,
      [examCycleId]
    );
    return Promise.all(rows.map((row) => this.loadBundle(row)));
  }

  async updateQuestionSetPracticeStatus(
    questionSetId: QuestionSetId,
    status: QuestionSetPracticeStatus,
    context: TransactionContext
  ): Promise<void> {
    const transaction = this.transactionScope.resolve(context);
    if (status === 'not_started') return;
    const currentStatuses = status === 'completed'
      ? ['not_started', 'in_progress']
      : ['not_started'];
    await transaction.run(
      `UPDATE question_sets
       SET practice_status = ?
       WHERE id = ? AND practice_status IN (${currentStatuses.map(() => '?').join(', ')})`,
      [status, questionSetId, ...currentStatuses]
    );
  }

  async applyQuestionSetEnrichment(
    patch: QuestionSetEnrichmentPatch,
    context: TransactionContext
  ): Promise<boolean> {
    return applyQuestionSetEnrichmentSql(this.transactionScope.resolve(context), patch);
  }

  private async loadBundle(questionSetRow: QuestionSetRow): Promise<CommittedQuestionSetBundle> {
    const [specs, workflows, documents, lectures, lectureLinks, questions, capabilityLinks] = await Promise.all([
      this.database.query<SpecRow>('SELECT * FROM generation_specs WHERE id = ? LIMIT 1', [questionSetRow.generation_spec_id]),
      this.database.query<WorkflowRow>(
        `SELECT * FROM generation_workflows WHERE generation_spec_id = ? AND status = 'committed'
         ORDER BY updated_at DESC LIMIT 1`,
        [questionSetRow.generation_spec_id]
      ),
      this.database.query<DocumentRow>(
        `SELECT document.* FROM content_documents document
         JOIN generation_workflows workflow ON workflow.id = document.generator_workflow_id
         WHERE workflow.generation_spec_id = ? ORDER BY document.created_at, document.id`,
        [questionSetRow.generation_spec_id]
      ),
      this.database.query<LectureRow>(
        `SELECT lecture.* FROM lectures lecture
         JOIN lecture_question_sets link ON link.lecture_id = lecture.id
         WHERE link.question_set_id = ? ORDER BY lecture.created_at, lecture.id`,
        [questionSetRow.id]
      ),
      this.database.query<LectureLinkRow>('SELECT * FROM lecture_question_sets WHERE question_set_id = ?', [questionSetRow.id]),
      this.database.query<QuestionRow>('SELECT * FROM questions WHERE question_set_id = ? ORDER BY sequence', [questionSetRow.id]),
      this.database.query<CapabilityLinkRow>(
        `SELECT link.* FROM question_capabilities link
         JOIN questions question ON question.id = link.question_id
         WHERE question.question_set_id = ?`,
        [questionSetRow.id]
      )
    ]);
    const spec = specs[0];
    const workflow = workflows[0];
    if (!spec || !workflow) throw new Error(`Question set ${questionSetRow.id} has an incomplete generation record`);
    return {
      generationSpec: this.mapSpec(spec),
      generationWorkflow: this.mapWorkflow(workflow),
      documents: documents.map((row) => this.mapDocument(row)),
      lectures: lectures.map((row) => this.mapLecture(row)),
      questionSet: this.mapQuestionSet(questionSetRow),
      lectureLinks: lectureLinks.map((row) => ({
        lectureId: row.lecture_id as LectureId,
        questionSetId: row.question_set_id as QuestionSetId,
        relationRole: row.relation_role
      })),
      questions: questions.map((row) => this.mapQuestion(row)),
      capabilityLinks: capabilityLinks.map((row) => ({
        questionId: row.question_id as QuestionId,
        capabilityNodeId: row.capability_node_id as CapabilityNodeId,
        relationRole: row.relation_role,
        weight: row.weight
      }))
    };
  }

  private insertSchema(transaction: SqlTransaction, releaseId: string, value: ContentSchemaVersion): Promise<unknown> {
    return transaction.run(
      `INSERT INTO content_schema_versions(
        id, release_id, schema_code, document_type, version, schema_json, content_hash, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [value.id, releaseId, value.schemaCode, value.documentType, value.version, JSON.stringify(value.schema),
        value.contentHash, value.status, value.createdAt]
    );
  }

  private insertTemplate(transaction: SqlTransaction, releaseId: string, value: QuestionTemplateVersion): Promise<unknown> {
    return transaction.run(
      `INSERT INTO question_template_versions(
        id, release_id, template_code, version, renderer_code, content_schema_version_id,
        config_json, content_hash, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [value.id, releaseId, value.templateCode, value.version, value.rendererCode, value.contentSchemaVersionId,
        JSON.stringify(value.config), value.contentHash, value.status, value.createdAt]
    );
  }

  private insertDocument(transaction: SqlTransaction, value: ContentDocumentRecord): Promise<unknown> {
    return transaction.run(
      `INSERT INTO content_documents(
        id, exam_cycle_id, document_type, schema_version_id, title, content_json, content_hash,
        status, content_version, supersedes_document_id, generator_workflow_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [value.id, value.examCycleId, value.documentType, value.schemaVersionId, value.title ?? null,
        JSON.stringify(value.content), value.contentHash, value.status, value.contentVersion,
        value.supersedesDocumentId ?? null, value.generatorWorkflowId ?? null, value.createdAt]
    );
  }

  private insertLecture(transaction: SqlTransaction, value: LectureRecord): Promise<unknown> {
    return transaction.run(
      `INSERT INTO lectures(
        id, exam_cycle_id, learning_thread_id, teaching_blueprint_id, capability_node_id, content_document_id, objective, status, version, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [value.id, value.examCycleId, value.learningThreadId ?? null, value.teachingBlueprintId ?? null, value.capabilityNodeId, value.contentDocumentId, value.objective,
        value.status, value.version, value.createdAt]
    );
  }

  private insertQuestionSet(
    transaction: SqlTransaction,
    value: QuestionSetRecord,
    entryMode: QuestionSetEntryMode
  ): Promise<unknown> {
    return transaction.run(
      `INSERT INTO question_sets(
        id, exam_cycle_id, learning_thread_id, teaching_blueprint_id, capability_node_id, generation_spec_id, purpose, assessment_role,
        module, origin_type, source_id, calibration_role, status, practice_status, entry_mode,
        question_count, content_hash, content_version, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [value.id, value.examCycleId, value.learningThreadId ?? null, value.teachingBlueprintId ?? null, value.capabilityNodeId, value.generationSpecId, value.purpose,
        value.assessmentRole, value.module, value.originType ?? 'ai_generated', value.sourceId ?? null,
        value.calibrationRole ?? 'none', value.status, value.practiceStatus, entryMode, value.questionCount, value.contentHash ?? null,
        value.contentVersion, value.createdAt]
    );
  }

  private insertQuestion(transaction: SqlTransaction, value: QuestionRecord): Promise<unknown> {
    return transaction.run(
      `INSERT INTO questions(
        id, question_set_id, exam_cycle_id, capability_node_id, question_template_version_id,
        sequence, difficulty, cognitive_level, purpose, assessment_role, variant_group_id,
        origin_type, source_id, source_sequence, lineage_id, calibration_role, is_official,
        content_json, correct_answer_json, quality_status, content_hash, content_schema_version_id,
        content_version, generator_workflow_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [value.id, value.questionSetId, value.examCycleId, value.capabilityNodeId,
        value.questionTemplateVersionId, value.sequence, value.difficulty, value.cognitiveLevel,
        value.purpose, value.assessmentRole, value.variantGroupId ?? null, value.originType ?? 'ai_generated',
        value.sourceId ?? null, value.sourceSequence ?? null, value.lineageId ?? null,
        value.calibrationRole ?? 'none', value.isOfficial ? 1 : 0, JSON.stringify(value.content),
        JSON.stringify(value.correctAnswer), value.qualityStatus, value.contentHash,
        value.contentSchemaVersionId, value.contentVersion, value.generatorWorkflowId, value.createdAt]
    );
  }

  private mapSchema(row: SchemaRow): ContentSchemaVersion {
    return {
      id: row.id as ContentSchemaVersionId,
      schemaCode: row.schema_code,
      documentType: row.document_type,
      version: row.version,
      schema: parseJsonObject(row.schema_json, 'content_schema_versions.schema_json'),
      contentHash: row.content_hash,
      status: row.status,
      createdAt: row.created_at as InstantMs
    };
  }

  private mapTemplate(row: TemplateRow): QuestionTemplateVersion {
    return {
      id: row.id as QuestionTemplateVersionId,
      templateCode: row.template_code,
      version: row.version,
      rendererCode: row.renderer_code,
      contentSchemaVersionId: row.content_schema_version_id as ContentSchemaVersionId,
      config: parseJsonObject(row.config_json, 'question_template_versions.config_json'),
      contentHash: row.content_hash,
      status: row.status,
      createdAt: row.created_at as InstantMs
    };
  }

  private mapSpec(row: SpecRow): GenerationSpecRecord {
    return {
      id: row.id as GenerationSpecId,
      examCycleId: row.exam_cycle_id as ExamCycleId,
      learningThreadId: row.learning_thread_id as LearningThreadId | null ?? undefined,
      teachingBlueprintId: row.teaching_blueprint_id as TeachingBlueprintId | null ?? undefined,
      capabilityNodeId: row.capability_node_id as CapabilityNodeId,
      contentKind: row.content_kind,
      assessmentRole: row.assessment_role,
      questionTemplateVersionId: row.question_template_version_id as QuestionTemplateVersionId | null ?? undefined,
      contentSchemaVersionId: row.content_schema_version_id as ContentSchemaVersionId,
      promptVersionId: row.prompt_version_id as PromptVersionId,
      referencePackId: row.reference_pack_id as QuestionReferencePackId | null ?? undefined,
      referencePolicyVersion: row.reference_policy_version ?? undefined,
      generationIntent: row.generation_intent ?? undefined,
      calibrationTarget: row.calibration_target ?? undefined,
      requestedCount: row.requested_count ?? undefined,
      difficulty: parseJsonObject(row.difficulty_json, 'generation_specs.difficulty_json'),
      constraints: parseJsonObject(row.constraints_json, 'generation_specs.constraints_json'),
      contextSnapshot: parseJsonObject(row.context_snapshot_json, 'generation_specs.context_snapshot_json'),
      contentHash: row.content_hash,
      createdAt: row.created_at as InstantMs
    };
  }

  private mapWorkflow(row: WorkflowRow): GenerationWorkflowRecord {
    return {
      id: row.id as WorkflowId,
      examCycleId: row.exam_cycle_id as ExamCycleId,
      generationSpecId: row.generation_spec_id as GenerationSpecId,
      workflowType: row.workflow_type,
      status: row.status,
      currentStep: row.current_step,
      attemptCount: row.attempt_count,
      stagedResult: row.staged_result_json ? parseJsonObject(row.staged_result_json, 'generation_workflows.staged_result_json') : undefined,
      validation: parseJsonObject(row.validation_json, 'generation_workflows.validation_json'),
      errorCode: row.error_code ?? undefined,
      idempotencyKey: row.idempotency_key,
      startedAt: row.started_at as InstantMs,
      completedAt: row.completed_at as InstantMs | null ?? undefined,
      updatedAt: row.updated_at as InstantMs,
      version: row.version
    };
  }

  private mapDocument(row: DocumentRow): ContentDocumentRecord {
    const parsed = this.validator.parseDocument(parseJson(row.content_json, 'content_documents.content_json'));
    if (!parsed.ok) throw new TypeError(`Invalid content document ${row.id}`);
    return {
      id: row.id as ContentDocumentId,
      examCycleId: row.exam_cycle_id as ExamCycleId,
      documentType: row.document_type,
      schemaVersionId: row.schema_version_id as ContentSchemaVersionId,
      title: row.title ?? undefined,
      content: parsed.value,
      contentHash: row.content_hash,
      status: row.status,
      contentVersion: row.content_version,
      supersedesDocumentId: row.supersedes_document_id as ContentDocumentId | null ?? undefined,
      generatorWorkflowId: row.generator_workflow_id as WorkflowId | null ?? undefined,
      createdAt: row.created_at as InstantMs
    };
  }

  private mapLecture(row: LectureRow): LectureRecord {
    return {
      id: row.id as LectureId,
      examCycleId: row.exam_cycle_id as ExamCycleId,
      learningThreadId: row.learning_thread_id as LearningThreadId | null ?? undefined,
      teachingBlueprintId: row.teaching_blueprint_id as TeachingBlueprintId | null ?? undefined,
      capabilityNodeId: row.capability_node_id as CapabilityNodeId,
      contentDocumentId: row.content_document_id as ContentDocumentId,
      objective: row.objective,
      status: row.status,
      version: row.version,
      createdAt: row.created_at as InstantMs
    };
  }

  private mapQuestionSet(row: QuestionSetRow): QuestionSetRecord {
    return {
      id: row.id as QuestionSetId,
      examCycleId: row.exam_cycle_id as ExamCycleId,
      learningThreadId: row.learning_thread_id as LearningThreadId | null ?? undefined,
      teachingBlueprintId: row.teaching_blueprint_id as TeachingBlueprintId | null ?? undefined,
      capabilityNodeId: row.capability_node_id as CapabilityNodeId,
      generationSpecId: row.generation_spec_id as GenerationSpecId,
      purpose: row.purpose,
      assessmentRole: row.assessment_role,
      module: row.module,
      originType: row.origin_type,
      sourceId: row.source_id as QuestionSourceId | null ?? undefined,
      calibrationRole: row.calibration_role,
      status: row.status,
      practiceStatus: row.practice_status,
      questionCount: row.question_count,
      contentHash: row.content_hash ?? undefined,
      contentVersion: row.content_version,
      createdAt: row.created_at as InstantMs
    };
  }

  private mapQuestion(row: QuestionRow): QuestionRecord {
    const parsed = this.validator.parseSingleChoiceQuestion(parseJson(row.content_json, 'questions.content_json'));
    if (!parsed.ok) throw new TypeError(`Invalid question content ${row.id}`);
    return {
      id: row.id as QuestionId,
      questionSetId: row.question_set_id as QuestionSetId,
      examCycleId: row.exam_cycle_id as ExamCycleId,
      capabilityNodeId: row.capability_node_id as CapabilityNodeId,
      questionTemplateVersionId: row.question_template_version_id as QuestionTemplateVersionId,
      sequence: row.sequence,
      difficulty: row.difficulty,
      cognitiveLevel: row.cognitive_level,
      purpose: row.purpose,
      assessmentRole: row.assessment_role,
      variantGroupId: row.variant_group_id ?? undefined,
      originType: row.origin_type,
      sourceId: row.source_id as QuestionSourceId | null ?? undefined,
      sourceSequence: row.source_sequence ?? undefined,
      lineageId: row.lineage_id as QuestionLineageId | null ?? undefined,
      calibrationRole: row.calibration_role,
      isOfficial: row.is_official === 1,
      content: parsed.value,
      correctAnswer: parseJsonObject(row.correct_answer_json, 'questions.correct_answer_json'),
      qualityStatus: row.quality_status,
      contentHash: row.content_hash,
      contentSchemaVersionId: row.content_schema_version_id as ContentSchemaVersionId,
      contentVersion: row.content_version,
      generatorWorkflowId: row.generator_workflow_id as WorkflowId,
      createdAt: row.created_at as InstantMs
    };
  }
}

function releaseVersion(bundle: ContentMetadataBundle): string {
  const versions = [...bundle.schemaVersions, ...bundle.questionTemplateVersions].map((item) => item.version);
  return versions.sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))[0] ?? '1.0.0';
}

function parseJson(serialized: string, field: string): unknown {
  try {
    return JSON.parse(serialized) as unknown;
  } catch {
    throw new TypeError(`${field} must contain valid JSON`);
  }
}

function parseJsonObject(serialized: string, field: string): JsonObject {
  const value = parseJson(serialized, field);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${field} must contain a JSON object`);
  }
  return value as JsonObject;
}
