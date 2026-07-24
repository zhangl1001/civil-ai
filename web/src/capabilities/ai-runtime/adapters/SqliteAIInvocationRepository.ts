import type { SqlDatabase, SqlRow } from '@/capabilities/database/contracts/SqlDatabase';
import type { SqlTransactionScope } from '@/capabilities/database/adapters/sqlite/SqlTransactionScope';
import type { TransactionContext } from '@/capabilities/database/public';
import type {
  AiInvocationId,
  ContentSchemaVersionId,
  InstantMs,
  PromptVersionId,
  WorkflowId
} from '@/kernel/public';
import type {
  AIInvocation,
  AIInvocationRepository,
  InvocationValidationStatus
} from '../contracts/AIInvocationRepository';

interface InvocationRow extends SqlRow {
  id: string;
  workflow_id: string;
  provider: string;
  model: string;
  model_role: string;
  prompt_version_id: string;
  content_schema_version_id: string | null;
  request_hash: string;
  provider_request_id: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  latency_ms: number | null;
  finish_reason: string | null;
  validation_status: InvocationValidationStatus;
  error_code: string | null;
  created_at: number;
}

export class SqliteAIInvocationRepository implements AIInvocationRepository {
  constructor(
    private readonly database: SqlDatabase,
    private readonly transactionScope: SqlTransactionScope
  ) {}

  async append(invocation: AIInvocation, context: TransactionContext): Promise<void> {
    await this.transactionScope.resolve(context).run(
      `INSERT INTO ai_invocations(
        id, workflow_id, provider, model, model_role, prompt_version_id,
        content_schema_version_id, request_hash, provider_request_id, input_tokens,
        output_tokens, latency_ms, finish_reason, validation_status, error_code, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [invocation.id, invocation.workflowId, invocation.provider, invocation.model, invocation.modelRole,
        invocation.promptVersionId, invocation.contentSchemaVersionId ?? null, invocation.requestHash,
        invocation.providerRequestId ?? null, invocation.inputTokens ?? null, invocation.outputTokens ?? null,
        invocation.latencyMs ?? null, invocation.finishReason ?? null, invocation.validationStatus,
        invocation.errorCode ?? null, invocation.createdAt]
    );
  }

  async listByWorkflow(workflowId: WorkflowId): Promise<readonly AIInvocation[]> {
    const rows = await this.database.query<InvocationRow>(
      'SELECT * FROM ai_invocations WHERE workflow_id = ? ORDER BY created_at, id',
      [workflowId]
    );
    return rows.map((row) => ({
      id: row.id as AiInvocationId,
      workflowId: row.workflow_id as WorkflowId,
      provider: row.provider,
      model: row.model,
      modelRole: row.model_role,
      promptVersionId: row.prompt_version_id as PromptVersionId,
      contentSchemaVersionId: row.content_schema_version_id as ContentSchemaVersionId | null ?? undefined,
      requestHash: row.request_hash,
      providerRequestId: row.provider_request_id ?? undefined,
      inputTokens: row.input_tokens ?? undefined,
      outputTokens: row.output_tokens ?? undefined,
      latencyMs: row.latency_ms ?? undefined,
      finishReason: row.finish_reason ?? undefined,
      validationStatus: row.validation_status,
      errorCode: row.error_code ?? undefined,
      createdAt: row.created_at as InstantMs
    }));
  }

  async updateResult(
    invocationId: AiInvocationId,
    value: Pick<AIInvocation, 'providerRequestId' | 'inputTokens' | 'outputTokens' | 'latencyMs' | 'finishReason'>,
    context: TransactionContext
  ): Promise<void> {
    const result = await this.transactionScope.resolve(context).run(
      `UPDATE ai_invocations SET provider_request_id = ?, input_tokens = ?, output_tokens = ?,
        latency_ms = ?, finish_reason = ?
       WHERE id = ? AND validation_status = 'pending'`,
      [value.providerRequestId ?? null, value.inputTokens ?? null, value.outputTokens ?? null,
        value.latencyMs ?? null, value.finishReason ?? null, invocationId]
    );
    if (result.changes !== 1) throw new Error(`AI invocation result conflict: ${invocationId}`);
  }

  async updateValidation(
    invocationId: AiInvocationId,
    status: InvocationValidationStatus,
    errorCode: string | undefined,
    context: TransactionContext
  ): Promise<void> {
    const result = await this.transactionScope.resolve(context).run(
      `UPDATE ai_invocations SET validation_status = ?, error_code = ?
       WHERE id = ? AND validation_status = 'pending'`,
      [status, errorCode ?? null, invocationId]
    );
    if (result.changes !== 1) throw new Error(`AI invocation validation conflict: ${invocationId}`);
  }
}
