import type { SqlDatabase, SqlRow, SqlTransaction } from '@/capabilities/database/contracts/SqlDatabase';
import type { SqlTransactionScope } from '@/capabilities/database/adapters/sqlite/SqlTransactionScope';
import type { TransactionContext } from '@/capabilities/database/public';
import type {
  CapabilityNodeId,
  ContentSchemaVersionId,
  ExamCycleId,
  GenerationSpecId,
  InstantMs,
  JsonObject,
  LearningThreadId,
  QuestionTemplateVersionId,
  PromptVersionId,
  TeachingBlueprintId,
  WorkflowId,
  AssessmentRole
} from '@/kernel/public';
import type { GenerationSpecRecord, GenerationWorkflowRecord } from '../contracts/ContentRepository';
import type { GenerationAggregate, GenerationRepository } from '../contracts/GenerationRepository';
import type { GenerationWorkflowStatus, GenerationWorkflowStep } from '../domain/ContentCodes';

interface JoinedGenerationRow extends SqlRow {
  spec_id: string; spec_exam_cycle_id: string; learning_thread_id: string | null; teaching_blueprint_id: string | null; capability_node_id: string;
  content_kind: GenerationSpecRecord['contentKind']; assessment_role: AssessmentRole;
  question_template_version_id: string | null; content_schema_version_id: string; prompt_version_id: string;
  requested_count: number | null; difficulty_json: string; constraints_json: string;
  context_snapshot_json: string; content_hash: string; spec_created_at: number;
  workflow_id: string; workflow_exam_cycle_id: string; generation_spec_id: string;
  workflow_type: GenerationWorkflowRecord['workflowType']; workflow_status: GenerationWorkflowStatus;
  current_step: GenerationWorkflowStep; attempt_count: number; staged_result_json: string | null;
  validation_json: string; error_code: string | null; idempotency_key: string;
  started_at: number; completed_at: number | null; updated_at: number; workflow_version: number;
}

export class SqliteGenerationRepository implements GenerationRepository {
  constructor(
    private readonly database: SqlDatabase,
    private readonly transactionScope: SqlTransactionScope
  ) {}

  async create(aggregate: GenerationAggregate, context: TransactionContext): Promise<void> {
    const transaction = this.transactionScope.resolve(context);
    await insertSpec(transaction, aggregate.spec);
    await insertWorkflow(transaction, aggregate.workflow);
  }

  async replaceWorkflow(
    workflow: GenerationWorkflowRecord,
    expectedVersion: number,
    context: TransactionContext
  ): Promise<void> {
    if (workflow.version !== expectedVersion + 1) throw new Error('Generation workflow version must advance by one');
    const result = await this.transactionScope.resolve(context).run(
      `UPDATE generation_workflows SET
        status = ?, current_step = ?, attempt_count = ?, staged_result_json = ?, validation_json = ?,
        error_code = ?, completed_at = ?, updated_at = ?, version = ?
       WHERE id = ? AND version = ?`,
      [workflow.status, workflow.currentStep, workflow.attemptCount,
        workflow.stagedResult ? JSON.stringify(workflow.stagedResult) : null,
        JSON.stringify(workflow.validation), workflow.errorCode ?? null, workflow.completedAt ?? null,
        workflow.updatedAt, workflow.version, workflow.id, expectedVersion]
    );
    if (result.changes !== 1) throw new Error(`Generation workflow version conflict: ${workflow.id}`);
  }

  async findByWorkflowId(workflowId: WorkflowId): Promise<GenerationAggregate | undefined> {
    const rows = await this.queryJoined('workflow.id = ?', [workflowId]);
    return rows[0] ? mapAggregate(rows[0]) : undefined;
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<GenerationAggregate | undefined> {
    const rows = await this.queryJoined('workflow.idempotency_key = ?', [idempotencyKey]);
    return rows[0] ? mapAggregate(rows[0]) : undefined;
  }

  private queryJoined(where: string, parameters: readonly string[]): Promise<readonly JoinedGenerationRow[]> {
    return this.database.query<JoinedGenerationRow>(
      `SELECT
        spec.id AS spec_id, spec.exam_cycle_id AS spec_exam_cycle_id, spec.learning_thread_id, spec.teaching_blueprint_id, spec.capability_node_id,
        spec.content_kind, spec.assessment_role, spec.question_template_version_id,
        spec.content_schema_version_id, spec.prompt_version_id, spec.requested_count, spec.difficulty_json,
        spec.constraints_json, spec.context_snapshot_json, spec.content_hash,
        spec.created_at AS spec_created_at,
        workflow.id AS workflow_id, workflow.exam_cycle_id AS workflow_exam_cycle_id,
        workflow.generation_spec_id, workflow.workflow_type, workflow.status AS workflow_status,
        workflow.current_step, workflow.attempt_count, workflow.staged_result_json,
        workflow.validation_json, workflow.error_code, workflow.idempotency_key,
        workflow.started_at, workflow.completed_at, workflow.updated_at,
        workflow.version AS workflow_version
       FROM generation_workflows workflow
       JOIN generation_specs spec ON spec.id = workflow.generation_spec_id
       WHERE ${where} LIMIT 1`,
      parameters
    );
  }
}

function insertSpec(transaction: SqlTransaction, value: GenerationSpecRecord): Promise<unknown> {
  return transaction.run(
    `INSERT INTO generation_specs(
      id, exam_cycle_id, learning_thread_id, teaching_blueprint_id, capability_node_id, content_kind, assessment_role,
      question_template_version_id, content_schema_version_id, prompt_version_id, requested_count,
      difficulty_json, constraints_json, context_snapshot_json, content_hash, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [value.id, value.examCycleId, value.learningThreadId ?? null, value.teachingBlueprintId ?? null, value.capabilityNodeId, value.contentKind, value.assessmentRole,
      value.questionTemplateVersionId ?? null, value.contentSchemaVersionId, value.promptVersionId, value.requestedCount ?? null,
      JSON.stringify(value.difficulty), JSON.stringify(value.constraints), JSON.stringify(value.contextSnapshot),
      value.contentHash, value.createdAt]
  );
}

function insertWorkflow(transaction: SqlTransaction, value: GenerationWorkflowRecord): Promise<unknown> {
  return transaction.run(
    `INSERT INTO generation_workflows(
      id, exam_cycle_id, generation_spec_id, workflow_type, status, current_step, attempt_count,
      staged_result_json, validation_json, error_code, idempotency_key, started_at, completed_at, updated_at, version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [value.id, value.examCycleId, value.generationSpecId, value.workflowType, value.status, value.currentStep,
      value.attemptCount, value.stagedResult ? JSON.stringify(value.stagedResult) : null,
      JSON.stringify(value.validation), value.errorCode ?? null, value.idempotencyKey, value.startedAt,
      value.completedAt ?? null, value.updatedAt, value.version]
  );
}

function mapAggregate(row: JoinedGenerationRow): GenerationAggregate {
  return {
    spec: {
      id: row.spec_id as GenerationSpecId,
      examCycleId: row.spec_exam_cycle_id as ExamCycleId,
      learningThreadId: row.learning_thread_id as LearningThreadId | null ?? undefined,
      teachingBlueprintId: row.teaching_blueprint_id as TeachingBlueprintId | null ?? undefined,
      capabilityNodeId: row.capability_node_id as CapabilityNodeId,
      contentKind: row.content_kind,
      assessmentRole: row.assessment_role,
      questionTemplateVersionId: row.question_template_version_id as QuestionTemplateVersionId | null ?? undefined,
      contentSchemaVersionId: row.content_schema_version_id as ContentSchemaVersionId,
      promptVersionId: row.prompt_version_id as PromptVersionId,
      requestedCount: row.requested_count ?? undefined,
      difficulty: parseObject(row.difficulty_json, 'generation_specs.difficulty_json'),
      constraints: parseObject(row.constraints_json, 'generation_specs.constraints_json'),
      contextSnapshot: parseObject(row.context_snapshot_json, 'generation_specs.context_snapshot_json'),
      contentHash: row.content_hash,
      createdAt: row.spec_created_at as InstantMs
    },
    workflow: {
      id: row.workflow_id as WorkflowId,
      examCycleId: row.workflow_exam_cycle_id as ExamCycleId,
      generationSpecId: row.generation_spec_id as GenerationSpecId,
      workflowType: row.workflow_type,
      status: row.workflow_status,
      currentStep: row.current_step,
      attemptCount: row.attempt_count,
      stagedResult: row.staged_result_json ? parseObject(row.staged_result_json, 'generation_workflows.staged_result_json') : undefined,
      validation: parseObject(row.validation_json, 'generation_workflows.validation_json'),
      errorCode: row.error_code ?? undefined,
      idempotencyKey: row.idempotency_key,
      startedAt: row.started_at as InstantMs,
      completedAt: row.completed_at as InstantMs | null ?? undefined,
      updatedAt: row.updated_at as InstantMs,
      version: row.workflow_version
    }
  };
}

function parseObject(serialized: string, field: string): JsonObject {
  const value: unknown = JSON.parse(serialized);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${field} must be an object`);
  return value as JsonObject;
}
