import type { SqlDatabase, SqlRow } from '@/capabilities/database/contracts/SqlDatabase';
import type { SqlTransactionScope } from '@/capabilities/database/adapters/sqlite/SqlTransactionScope';
import type { TransactionContext } from '@/capabilities/database/public';
import type { AiInvocationId, AgentRunId, ExamCycleId, InstantMs, LearningThreadId, PromptVersionId } from '@/kernel/public';
import type { AgentInvocationRecord, AgentRunAggregate, AgentRunClaimOptions, AgentRunEventRecord, AgentRunRecord, AgentRunRecoveryOptions, AgentRunRepository } from '../contracts/AgentRunRepository';
import {
  AgentExecutionClass,
  AgentWorkPool,
  resolveAgentExecutionClass,
  resolveAgentWorkPool,
  type AgentExecutionClass as AgentExecutionClassValue,
  type AgentRunStatus,
  type AgentRunType,
  type AgentWorkPool as AgentWorkPoolValue
} from '../domain/AgentRunCodes';
import type { InvocationValidationStatus } from '@/capabilities/ai-runtime/public';

interface RunRow extends SqlRow {
  id: string; run_type: AgentRunType; work_pool: AgentWorkPoolValue; execution_class: AgentExecutionClassValue; status: AgentRunStatus; exam_cycle_id: string | null; learning_thread_id: string | null;
  target_resource_type: string | null; target_resource_id: string | null; input_snapshot_json: string; checkpoint_json: string;
  attempt_count: number; next_run_at: number | null; lease_owner: string | null; lease_expires_at: number | null; error_code: string | null; cancellation_reason: string | null;
  idempotency_key: string; created_at: number; updated_at: number; completed_at: number | null; version: number;
}
interface EventRow extends SqlRow {
  id: string; agent_run_id: string; event_type: AgentRunEventRecord['eventType']; from_status: AgentRunStatus | null;
  to_status: AgentRunStatus; reason_code: string; payload_json: string; occurred_at: number; idempotency_key: string;
}
interface InvocationRow extends SqlRow {
  id: string; agent_run_id: string; provider: string; model: string; model_role: string; prompt_version_id: string | null;
  tool_schema_version: string | null; request_hash: string; provider_request_id: string | null; input_tokens: number | null;
  output_tokens: number | null; latency_ms: number | null; finish_reason: string | null; validation_status: InvocationValidationStatus;
  error_code: string | null; created_at: number;
}

export class SqliteAgentRunRepository implements AgentRunRepository {
  constructor(private readonly database: SqlDatabase, private readonly transactionScope: SqlTransactionScope) {}
  async create(run: AgentRunRecord, created: AgentRunEventRecord, context: TransactionContext): Promise<void> {
    const tx = this.transactionScope.resolve(context);
    await tx.run(`INSERT INTO tutor_agent_runs(id, run_type, work_pool, execution_class, status, exam_cycle_id, learning_thread_id, target_resource_type, target_resource_id, input_snapshot_json, checkpoint_json, attempt_count, next_run_at, lease_owner, lease_expires_at, error_code, cancellation_reason, idempotency_key, created_at, updated_at, completed_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [run.id, run.runType, run.workPool ?? resolveAgentWorkPool(run.runType, run.targetResourceType, run.inputSnapshot), run.executionClass ?? resolveAgentExecutionClass(run.runType, run.targetResourceType, run.inputSnapshot), run.status, run.examCycleId ?? null, run.learningThreadId ?? null, run.targetResourceType ?? null, run.targetResourceId ?? null, JSON.stringify(run.inputSnapshot), JSON.stringify(run.checkpoint), run.attemptCount, run.nextRunAt ?? null, run.leaseOwner ?? null, run.leaseExpiresAt ?? null, run.errorCode ?? null, run.cancellationReason ?? null, run.idempotencyKey, run.createdAt, run.updatedAt, run.completedAt ?? null, run.version]);
    await insertEvent(tx, created);
  }
  async replace(run: AgentRunRecord, expectedVersion: number, event: AgentRunEventRecord, context: TransactionContext): Promise<void> {
    if (run.version !== expectedVersion + 1) throw new Error('Agent run version must advance by one');
    const tx = this.transactionScope.resolve(context);
    const result = await tx.run(`UPDATE tutor_agent_runs SET status=?, checkpoint_json=?, attempt_count=?, next_run_at=?, lease_owner=?, lease_expires_at=?, error_code=?, cancellation_reason=?, updated_at=?, completed_at=?, version=? WHERE id=? AND version=?`,
      [run.status, JSON.stringify(run.checkpoint), run.attemptCount, run.nextRunAt ?? null, run.leaseOwner ?? null, run.leaseExpiresAt ?? null, run.errorCode ?? null, run.cancellationReason ?? null, run.updatedAt, run.completedAt ?? null, run.version, run.id, expectedVersion]);
    if (result.changes !== 1) throw new Error(`Agent run version conflict: ${run.id}`);
    await insertEvent(tx, event);
  }
  async findById(runId: AgentRunId): Promise<AgentRunAggregate | undefined> { return this.find('id = ?', [runId]); }
  async findByIdempotencyKey(key: string): Promise<AgentRunAggregate | undefined> { return this.find('idempotency_key = ?', [key]); }
  async findLatestByTarget(type:string,id:string):Promise<AgentRunAggregate|undefined>{return this.find('target_resource_type = ? AND target_resource_id = ? ORDER BY updated_at DESC, id DESC',[type,id]);}
  async findActiveByTarget(type:string,id:string):Promise<AgentRunAggregate|undefined>{return this.find("target_resource_type = ? AND target_resource_id = ? AND status IN ('queued','running','waiting_user') ORDER BY updated_at DESC, id DESC",[type,id]);}
  async appendInvocation(value: AgentInvocationRecord, context: TransactionContext): Promise<void> {
    await this.transactionScope.resolve(context).run(`INSERT INTO tutor_agent_invocations(id, agent_run_id, provider, model, model_role, prompt_version_id, tool_schema_version, request_hash, provider_request_id, input_tokens, output_tokens, latency_ms, finish_reason, validation_status, error_code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [value.id, value.agentRunId, value.provider, value.model, value.modelRole, value.promptVersionId ?? null, value.toolSchemaVersion ?? null, value.requestHash, value.providerRequestId ?? null, value.inputTokens ?? null, value.outputTokens ?? null, value.latencyMs ?? null, value.finishReason ?? null, value.validationStatus, value.errorCode ?? null, value.createdAt]);
  }
  async updateInvocationResult(id: AiInvocationId, value: Pick<AgentInvocationRecord, 'providerRequestId' | 'inputTokens' | 'outputTokens' | 'latencyMs' | 'finishReason'>, context: TransactionContext): Promise<void> {
    const result = await this.transactionScope.resolve(context).run(`UPDATE tutor_agent_invocations SET provider_request_id=?,input_tokens=?,output_tokens=?,latency_ms=?,finish_reason=? WHERE id=? AND validation_status='pending'`,[value.providerRequestId??null,value.inputTokens??null,value.outputTokens??null,value.latencyMs??null,value.finishReason??null,id]);
    if(result.changes!==1)throw new Error(`Agent invocation result conflict: ${id}`);
  }
  async updateInvocationValidation(id: AiInvocationId, status: InvocationValidationStatus, errorCode: string | undefined, context: TransactionContext): Promise<void> {
    const result=await this.transactionScope.resolve(context).run(`UPDATE tutor_agent_invocations SET validation_status=?,error_code=? WHERE id=? AND validation_status='pending'`,[status,errorCode??null,id]);
    if(result.changes!==1)throw new Error(`Agent invocation validation conflict: ${id}`);
  }
  async listInvocations(runId: AgentRunId): Promise<readonly AgentInvocationRecord[]> {
    return (await this.database.query<InvocationRow>('SELECT * FROM tutor_agent_invocations WHERE agent_run_id = ? ORDER BY created_at, id', [runId])).map(mapInvocation);
  }
  async countInvocations(runIds: readonly AgentRunId[]): Promise<Readonly<Record<string, number>>> {
    if (!runIds.length) return {};
    const rows = await this.database.query<{ agent_run_id: string; total: number }>(
      `SELECT agent_run_id,COUNT(*) AS total
       FROM tutor_agent_invocations
       WHERE agent_run_id IN (${runIds.map(() => '?').join(',')})
       GROUP BY agent_run_id`,
      runIds
    );
    return Object.fromEntries(rows.map((row) => [row.agent_run_id, row.total]));
  }
  async listRecent(limit: number): Promise<readonly AgentRunAggregate[]> {
    assertRecentLimit(limit);
    const rows = await this.database.query<RunRow>('SELECT * FROM tutor_agent_runs ORDER BY updated_at DESC, id DESC LIMIT ?', [limit]);
    return Promise.all(rows.map((row) => this.load(row)));
  }
  async listRunnable(now: InstantMs, limit: number): Promise<readonly AgentRunAggregate[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 3) throw new RangeError('Agent runnable limit must be between 1 and 3');
    const rows = await this.database.query<RunRow>(`SELECT * FROM tutor_agent_runs WHERE status = 'queued' AND (next_run_at IS NULL OR next_run_at <= ?) ORDER BY updated_at, id LIMIT ?`, [now, limit]);
    return Promise.all(rows.map((row) => this.load(row)));
  }
  async nextWorkAt(now: InstantMs, workPools?: readonly AgentWorkPoolValue[], executionClasses?: readonly AgentExecutionClassValue[]): Promise<InstantMs | undefined> {
    const pools = normalizeWorkPools(workPools);
    const classes = normalizeExecutionClasses(executionClasses);
    const poolFilter = pools.length ? ` AND work_pool IN (${pools.map(() => '?').join(',')})` : '';
    const classFilter = classes.length ? ` AND execution_class IN (${classes.map(() => '?').join(',')})` : '';
    const rows = await this.database.query<{ next_work_at: number | null }>(
      `SELECT MIN(
         CASE
           WHEN status='queued' THEN COALESCE(next_run_at, ?)
           WHEN status='running' THEN COALESCE(lease_expires_at, ?)
         END
       ) AS next_work_at
       FROM tutor_agent_runs
       WHERE status IN ('queued','running')${poolFilter}${classFilter}`,
      [now, now, ...pools, ...classes]
    );
    return rows[0]?.next_work_at === null || rows[0]?.next_work_at === undefined
      ? undefined
      : rows[0].next_work_at as InstantMs;
  }
  async claimRunnable(options: AgentRunClaimOptions): Promise<readonly AgentRunAggregate[]> {
    if (!options.workerId.trim() || !Number.isInteger(options.limit) || options.limit < 1 || options.limit > 3 || options.eventIds.length < options.limit) throw new Error('Invalid agent run claim options');
    const pools = normalizeWorkPools(options.workPools);
    const classes = normalizeExecutionClasses(options.executionClasses);
    const poolFilter = pools.length ? ` AND work_pool IN (${pools.map(() => '?').join(',')})` : '';
    const classFilter = classes.length ? ` AND execution_class IN (${classes.map(() => '?').join(',')})` : '';
    const classOrder = classes.length
      ? `CASE execution_class ${classes.map(() => 'WHEN ? THEN ?').join(' ')} ELSE ${classes.length} END,`
      : '';
    const poolOrder = pools.length
      ? `CASE work_pool ${pools.map(() => 'WHEN ? THEN ?').join(' ')} ELSE ${pools.length} END,`
      : '';
    const classOrderParameters = classes.flatMap((value, index) => [value, index]);
    const poolOrderParameters = pools.flatMap((pool, index) => [pool, index]);
    return this.database.transaction(async (tx) => {
      const rows = await tx.query<RunRow>(
        `SELECT * FROM tutor_agent_runs
         WHERE status = 'queued' AND (next_run_at IS NULL OR next_run_at <= ?)${poolFilter}${classFilter}
         ORDER BY ${classOrder}${poolOrder} updated_at, id LIMIT ?`,
        [options.now, ...pools, ...classes, ...classOrderParameters, ...poolOrderParameters, options.limit]
      );
      const claimed: AgentRunAggregate[] = [];
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index];
        const result = await tx.run(`UPDATE tutor_agent_runs SET status='running', attempt_count=attempt_count+1, lease_owner=?, lease_expires_at=?, updated_at=?, version=version+1 WHERE id=? AND version=? AND status='queued'`, [options.workerId.trim(), options.leaseExpiresAt, options.now, row.id, row.version]);
        if (result.changes !== 1) continue;
        const event: AgentRunEventRecord = { id: options.eventIds[index], agentRunId: row.id as AgentRunId, eventType: 'started', fromStatus: 'queued', toStatus: 'running', reasonCode: 'agent_run.claimed', payload: { workerId: options.workerId.trim(), leaseExpiresAt: options.leaseExpiresAt }, occurredAt: options.now, idempotencyKey: `agent-run:${row.id}:claim:${row.version + 1}` };
        await insertEvent(tx, event);
        claimed.push({ run: { ...mapRun(row), status: 'running', attemptCount: row.attempt_count + 1, leaseOwner: options.workerId.trim(), leaseExpiresAt: options.leaseExpiresAt, updatedAt: options.now, version: row.version + 1 }, events: [event] });
      }
      return claimed;
    });
  }
  async renewLease(runId:AgentRunId,workerId:string,leaseExpiresAt:InstantMs):Promise<boolean> {
    const result=await this.database.run(
      "UPDATE tutor_agent_runs SET lease_expires_at=? WHERE id=? AND status='running' AND lease_owner=?",
      [leaseExpiresAt,runId,workerId]
    );
    return result.changes===1;
  }
  async recoverExpiredLeases(options: AgentRunRecoveryOptions): Promise<readonly AgentRunAggregate[]> {
    if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 100 || options.eventIds.length < options.limit) throw new Error('Invalid agent run recovery options');
    return this.database.transaction(async (tx) => {
      const rows = await tx.query<RunRow>(`SELECT * FROM tutor_agent_runs WHERE status='running' AND lease_expires_at <= ? ORDER BY lease_expires_at, id LIMIT ?`, [options.now, options.limit]);
      const recovered: AgentRunAggregate[] = [];
      for (let index=0; index<rows.length; index+=1) { const row=rows[index]; const result=await tx.run(`UPDATE tutor_agent_runs SET status='queued', next_run_at=?, lease_owner=NULL, lease_expires_at=NULL, updated_at=?, version=version+1 WHERE id=? AND version=? AND status='running' AND lease_expires_at <= ?`, [options.now,options.now,row.id,row.version,options.now]); if(result.changes!==1)continue; const event:AgentRunEventRecord={id:options.eventIds[index],agentRunId:row.id as AgentRunId,eventType:'recovered',fromStatus:'running',toStatus:'queued',reasonCode:'agent_run.lease_expired',payload:{},occurredAt:options.now,idempotencyKey:`agent-run:${row.id}:recover:${row.version+1}`};await insertEvent(tx,event);recovered.push({run:{...mapRun(row),status:'queued',nextRunAt:options.now,leaseOwner:undefined,leaseExpiresAt:undefined,updatedAt:options.now,version:row.version+1},events:[event]}); }
      return recovered;
    });
  }
  private async find(where: string, values: readonly string[]): Promise<AgentRunAggregate | undefined> {
    const rows = await this.database.query<RunRow>(`SELECT * FROM tutor_agent_runs WHERE ${where} LIMIT 1`, values);
    return rows[0] ? this.load(rows[0]) : undefined;
  }
  private async load(run: RunRow): Promise<AgentRunAggregate> {
    const events = await this.database.query<EventRow>('SELECT * FROM tutor_agent_run_events WHERE agent_run_id = ? ORDER BY occurred_at, id', [run.id]);
    return { run: mapRun(run), events: events.map(mapEvent) };
  }
}
function assertRecentLimit(limit: number): void { if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new RangeError('Agent recent limit must be between 1 and 50'); }
function insertEvent(tx: ReturnType<SqlTransactionScope['resolve']>, value: AgentRunEventRecord): Promise<unknown> { return tx.run('INSERT INTO tutor_agent_run_events(id, agent_run_id, event_type, from_status, to_status, reason_code, payload_json, occurred_at, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [value.id, value.agentRunId, value.eventType, value.fromStatus ?? null, value.toStatus, value.reasonCode, JSON.stringify(value.payload), value.occurredAt, value.idempotencyKey]); }
function mapRun(r: RunRow): AgentRunRecord { return { id:r.id as AgentRunId, runType:r.run_type, workPool:r.work_pool, executionClass:r.execution_class, status:r.status, examCycleId:r.exam_cycle_id as ExamCycleId | null ?? undefined, learningThreadId:r.learning_thread_id as LearningThreadId | null ?? undefined, targetResourceType:r.target_resource_type??undefined, targetResourceId:r.target_resource_id??undefined, inputSnapshot:json(r.input_snapshot_json), checkpoint:json(r.checkpoint_json), attemptCount:r.attempt_count, nextRunAt:r.next_run_at as InstantMs | null ?? undefined, leaseOwner:r.lease_owner??undefined, leaseExpiresAt:r.lease_expires_at as InstantMs | null ?? undefined, errorCode:r.error_code??undefined, cancellationReason:r.cancellation_reason??undefined, idempotencyKey:r.idempotency_key, createdAt:r.created_at as InstantMs, updatedAt:r.updated_at as InstantMs, completedAt:r.completed_at as InstantMs | null ?? undefined, version:r.version }; }
function mapEvent(r: EventRow): AgentRunEventRecord { return { id:r.id, agentRunId:r.agent_run_id as AgentRunId, eventType:r.event_type, fromStatus:r.from_status??undefined, toStatus:r.to_status, reasonCode:r.reason_code, payload:json(r.payload_json), occurredAt:r.occurred_at as InstantMs, idempotencyKey:r.idempotency_key }; }
function mapInvocation(r: InvocationRow): AgentInvocationRecord { return { id:r.id as AiInvocationId, agentRunId:r.agent_run_id as AgentRunId, provider:r.provider, model:r.model, modelRole:r.model_role, promptVersionId:r.prompt_version_id as PromptVersionId | null ?? undefined, toolSchemaVersion:r.tool_schema_version??undefined, requestHash:r.request_hash, providerRequestId:r.provider_request_id??undefined, inputTokens:r.input_tokens??undefined, outputTokens:r.output_tokens??undefined, latencyMs:r.latency_ms??undefined, finishReason:r.finish_reason??undefined, validationStatus:r.validation_status, errorCode:r.error_code??undefined, createdAt:r.created_at as InstantMs }; }
function json(value:string) { const parsed:unknown=JSON.parse(value); if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)) throw new TypeError('Agent runtime JSON must be an object'); return parsed as import('@/kernel/public').JsonObject; }
function normalizeWorkPools(values?: readonly AgentWorkPoolValue[]): AgentWorkPoolValue[] {
  if (!values?.length) return [];
  const allowed = new Set(Object.values(AgentWorkPool));
  const pools = [...new Set(values)];
  if (pools.some((pool) => !allowed.has(pool))) throw new Error('Invalid agent work pool filter');
  return pools;
}
function normalizeExecutionClasses(values?: readonly AgentExecutionClassValue[]): AgentExecutionClassValue[] {
  if (!values?.length) return [];
  const allowed = new Set(Object.values(AgentExecutionClass));
  const classes = [...new Set(values)];
  if (classes.some((value) => !allowed.has(value))) throw new Error('Invalid agent execution class filter');
  return classes;
}
