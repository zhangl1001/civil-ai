import type { PromptCompiler, ProviderGateway } from '@/capabilities/ai-runtime/public';
import {
  errorDiagnosisBatchPromptV1,
  errorDiagnosisPromptV1,
  parseStructuredJson
} from '@/capabilities/ai-runtime/public';
import type { UnitOfWork } from '@/capabilities/database/public';
import type {
  AgentRunId,
  Clock,
  ErrorDiagnosisId,
  IdGenerator,
  JsonObject,
  LearningSessionId
} from '@/kernel/public';
import {
  AgentRunAction,
  InvokeAgentModel,
  TransitionAgentRun,
  type AgentRunLeaseToken
} from '@/modules/agent/public';
import type { OutboxRepository } from '@/modules/task/public';
import type { ErrorDiagnosisRepository } from '../contracts/LearningRepositories';
import type {
  ErrorCorrectionPlan,
  ErrorDiagnosisDimension,
  ErrorDiagnosisRecord
} from '../contracts/LearningFacts';
import {
  ConfirmationStatus,
  ErrorCauseCode,
  ErrorDiagnosisDimensionCode,
  ErrorDiagnosisDimensionStatus
} from '../domain/EvidenceCodes';

interface ErrorDiagnosisBatchItem {
  readonly provisionalDiagnosisId: ErrorDiagnosisId;
  readonly evidenceContext: JsonObject;
  readonly subject: string;
  readonly capabilityName?: string;
}

interface RunAiErrorDiagnosisCommand {
  readonly agentRunId: AgentRunId;
  readonly leaseToken?: AgentRunLeaseToken;
  readonly items: readonly ErrorDiagnosisBatchItem[];
}

export interface AiErrorDiagnosisCompletionObserver {
  completed(input: {
    readonly agentRunId: AgentRunId;
    readonly sessionId: LearningSessionId;
    readonly diagnosisIds: readonly ErrorDiagnosisId[];
  }): Promise<unknown>;
}

interface DiagnosisOutput {
  readonly provisionalDiagnosisId?: ErrorDiagnosisId;
  readonly causeCode: typeof ErrorCauseCode[keyof typeof ErrorCauseCode];
  readonly errorStage?: string;
  readonly detail: string;
  readonly confidence: number;
  readonly recommendedActionCode: string;
  readonly dimensions: readonly ErrorDiagnosisDimension[];
  readonly correctionPlan: ErrorCorrectionPlan;
}

interface PendingDiagnosis {
  readonly item: ErrorDiagnosisBatchItem;
  readonly provisional: ErrorDiagnosisRecord;
}

const MAX_PARALLEL_DIAGNOSIS_FALLBACKS = 3;

export class RunAiErrorDiagnosis {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly diagnoses: ErrorDiagnosisRepository,
    private readonly outbox: OutboxRepository,
    private readonly compiler: PromptCompiler,
    private readonly invoke: InvokeAgentModel,
    private readonly transition: TransitionAgentRun,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly completionObserver?: AiErrorDiagnosisCompletionObserver
  ) {}

  async execute(
    command: RunAiErrorDiagnosisCommand,
    gateway: ProviderGateway,
    signal?: AbortSignal
  ): Promise<readonly ErrorDiagnosisId[]> {
    if (!command.items.length || command.items.length > 25) {
      throw new RangeError('AI diagnosis batch must contain between 1 and 25 items');
    }
    const uniqueIds = new Set(command.items.map((item) => item.provisionalDiagnosisId));
    if (uniqueIds.size !== command.items.length) throw new Error('AI diagnosis batch contains duplicate diagnoses');

    const committed = await this.diagnoses.findByIdempotencyKeys(
      command.items.map((item) => diagnosisIdempotencyKey(item.provisionalDiagnosisId))
    );
    const committedByKey = new Map(committed.map((item) => [item.idempotencyKey, item]));
    const unresolvedItems = command.items.filter((item) => (
      !committedByKey.has(diagnosisIdempotencyKey(item.provisionalDiagnosisId))
    ));
    const provisionalRecords = await this.diagnoses.findMany(
      unresolvedItems.map((item) => item.provisionalDiagnosisId)
    );
    const provisionalById = new Map(provisionalRecords.map((item) => [item.id, item]));
    const pending: PendingDiagnosis[] = unresolvedItems.map((item) => {
      const provisional = provisionalById.get(item.provisionalDiagnosisId);
      if (!provisional) throw new Error(`Provisional diagnosis does not exist: ${item.provisionalDiagnosisId}`);
      return { item, provisional };
    });
    const diagnosisIds = committed.map((item) => item.id);
    const sessionId = requireSingleSessionId([...committed, ...provisionalRecords]);

    if (!pending.length) {
      await this.completionObserver?.completed({ agentRunId: command.agentRunId, sessionId, diagnosisIds });
      await this.completeRun(command.agentRunId, diagnosisIds, [], 0, command.leaseToken);
      return diagnosisIds;
    }

    const batch = await this.invokeBatch(command.agentRunId, pending, gateway, signal, command.leaseToken);
    const validBatch: { pending: PendingDiagnosis; output: DiagnosisOutput }[] = [];
    const unresolved: PendingDiagnosis[] = [];
    for (const item of pending) {
      const output = batch.outputs.get(item.provisional.id);
      if (output) validBatch.push({ pending: item, output });
      else unresolved.push(item);
    }

    if (validBatch.length) {
      diagnosisIds.push(...await this.commit(command.agentRunId, validBatch, signal));
    }

    const fallbackResults = await mapSettledWithConcurrency(
      unresolved,
      MAX_PARALLEL_DIAGNOSIS_FALLBACKS,
      (item) => this.invokeSingle(
        command.agentRunId,
        item,
        gateway,
        signal,
        command.leaseToken
      )
    );
    const fallbackValues = fallbackResults.flatMap((result, index) => (
      result.status === 'fulfilled'
        ? [{ pending: unresolved[index]!, output: result.value.output }]
        : []
    ));
    if (fallbackValues.length) {
      diagnosisIds.push(...await this.commit(command.agentRunId, fallbackValues, signal));
    }
    const failedFallback = fallbackResults.find((result) => result.status === 'rejected');
    if (failedFallback?.status === 'rejected') {
      // Successful siblings are already durable. The next AgentRun attempt only
      // retries unresolved provisional diagnoses through their idempotency keys.
      throw failedFallback.reason;
    }
    const fallbackInvocationIds = fallbackResults.flatMap((result) => (
      result.status === 'fulfilled' ? [result.value.invocationId] : []
    ));

    signal?.throwIfAborted();
    await this.completionObserver?.completed({ agentRunId: command.agentRunId, sessionId, diagnosisIds });
    signal?.throwIfAborted();
    await this.completeRun(
      command.agentRunId,
      diagnosisIds,
      [batch.invocationId, ...fallbackInvocationIds],
      unresolved.length,
      command.leaseToken
    );
    return diagnosisIds;
  }

  private async invokeBatch(
    agentRunId: AgentRunId,
    pending: readonly PendingDiagnosis[],
    gateway: ProviderGateway,
    signal?: AbortSignal,
    leaseToken?: AgentRunLeaseToken
  ): Promise<{ readonly invocationId: string; readonly outputs: ReadonlyMap<ErrorDiagnosisId, DiagnosisOutput> }> {
    const subjects = [...new Set(pending.map((item) => item.item.subject))];
    const compiled = this.compiler.compile(
      errorDiagnosisBatchPromptV1.promptCode,
      { SUBJECT: subjects.length === 1 ? subjects[0]! : '公务员考试' },
      {
        items: pending.map(({ item, provisional }) => ({
          provisionalDiagnosisId: provisional.id,
          subject: item.subject,
          capabilityName: item.capabilityName ?? null,
          provisionalDiagnosis: provisional,
          evidence: item.evidenceContext
        }))
      },
      errorDiagnosisBatchPromptV1.version
    );
    const response = await this.invoke.execute({
      agentRunId,
      leaseToken,
      modelRole: 'error_diagnosis_batch',
      system: compiled.system,
      user: compiled.user,
      promptVersionId: errorDiagnosisBatchPromptV1.versionId,
      responseSchema: compiled.responseSchema,
      maxOutputTokens: Math.min(12_000, 500 + pending.length * 650)
    }, gateway, signal);
    return {
      invocationId: response.invocationId,
      outputs: parseBatch(response.text, new Set(pending.map((item) => item.provisional.id)))
    };
  }

  private async invokeSingle(
    agentRunId: AgentRunId,
    pending: PendingDiagnosis,
    gateway: ProviderGateway,
    signal?: AbortSignal,
    leaseToken?: AgentRunLeaseToken
  ): Promise<{ readonly invocationId: string; readonly output: DiagnosisOutput }> {
    const compiled = this.compiler.compile(
      errorDiagnosisPromptV1.promptCode,
      { SUBJECT: pending.item.subject },
      {
        provisionalDiagnosis: pending.provisional,
        evidence: pending.item.evidenceContext
      },
      errorDiagnosisPromptV1.version
    );
    const response = await this.invoke.execute({
      agentRunId,
      leaseToken,
      modelRole: 'error_diagnosis_fallback',
      system: compiled.system,
      user: compiled.user,
      promptVersionId: errorDiagnosisPromptV1.versionId,
      responseSchema: compiled.responseSchema,
      maxOutputTokens: 1200
    }, gateway, signal);
    return {
      invocationId: response.invocationId,
      output: parseDiagnosisOutput(parseJson(response.text))
    };
  }

  private async commit(
    agentRunId: AgentRunId,
    values: readonly { readonly pending: PendingDiagnosis; readonly output: DiagnosisOutput }[],
    signal?: AbortSignal
  ): Promise<readonly ErrorDiagnosisId[]> {
    if (!values.length) return [];
    signal?.throwIfAborted();
    const now = this.clock.now();
    const records = values.map(({ pending, output }): ErrorDiagnosisRecord => ({
      id: this.ids.next('ErrorDiagnosisId'),
      sessionId: pending.provisional.sessionId,
      gradingResultId: pending.provisional.gradingResultId,
      attemptId: pending.provisional.attemptId,
      examCycleId: pending.provisional.examCycleId,
      capabilityNodeId: pending.provisional.capabilityNodeId,
      causeCode: output.causeCode,
      errorStage: output.errorStage,
      detail: output.detail,
      confidence: output.confidence,
      confirmationStatus: ConfirmationStatus.Pending,
      prerequisiteCapabilityNodeId: undefined,
      recommendedActionCode: output.recommendedActionCode,
      dimensions: output.dimensions,
      correctionPlan: output.correctionPlan,
      source: 'tutor_ai',
      createdAt: now,
      idempotencyKey: diagnosisIdempotencyKey(pending.provisional.id)
    }));
    signal?.throwIfAborted();
    await this.unitOfWork.run(async (context) => {
      signal?.throwIfAborted();
      await this.diagnoses.append(records, context);
      for (let index = 0; index < records.length; index += 1) {
        const record = records[index]!;
        const provisional = values[index]!.pending.provisional;
        await this.outbox.append({
          id: this.ids.next('OutboxEventId'),
          aggregateType: 'error_diagnosis',
          aggregateId: record.id,
          eventType: 'error_diagnosis.ai_proposed',
          payload: {
            diagnosisId: record.id,
            provisionalDiagnosisId: provisional.id,
            agentRunId
          },
          occurredAt: now,
          attemptCount: 0,
          idempotencyKey: `${record.idempotencyKey}:outbox`
        }, context);
      }
    });
    return records.map((record) => record.id);
  }

  private async completeRun(
    agentRunId: AgentRunId,
    diagnosisIds: readonly ErrorDiagnosisId[],
    invocationIds: readonly string[],
    fallbackCount: number,
    leaseToken?: AgentRunLeaseToken
  ): Promise<void> {
    await this.transition.execute({
      idempotencyKey: `${agentRunId}:complete`,
      agentRunId,
      action: AgentRunAction.Complete,
      reasonCode: 'error_diagnosis.completed',
      payload: {
        diagnosisIds: [...diagnosisIds],
        diagnosisCount: diagnosisIds.length,
        fallbackCount,
        invocationIds: [...invocationIds]
      },
      leaseToken
    });
  }
}

function requireSingleSessionId(records: readonly ErrorDiagnosisRecord[]): LearningSessionId {
  const sessionIds = [...new Set(records.map((item) => item.sessionId))];
  if (sessionIds.length !== 1) throw new Error('AI diagnosis batch must belong to exactly one learning session');
  return sessionIds[0]!;
}

function parseBatch(
  text: string,
  expectedIds: ReadonlySet<ErrorDiagnosisId>
): ReadonlyMap<ErrorDiagnosisId, DiagnosisOutput> {
  let value: unknown;
  try {
    value = parseJson(text);
  } catch {
    return new Map();
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return new Map();
  const rows = (value as Record<string, unknown>).diagnoses;
  if (!Array.isArray(rows)) return new Map();

  const outputs = new Map<ErrorDiagnosisId, DiagnosisOutput>();
  const duplicateIds = new Set<ErrorDiagnosisId>();
  for (const row of rows) {
    try {
      if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
      const provisionalDiagnosisId = (row as Record<string, unknown>).provisionalDiagnosisId;
      if (typeof provisionalDiagnosisId !== 'string' || !expectedIds.has(provisionalDiagnosisId as ErrorDiagnosisId)) continue;
      const id = provisionalDiagnosisId as ErrorDiagnosisId;
      if (outputs.has(id)) {
        outputs.delete(id);
        duplicateIds.add(id);
        continue;
      }
      if (duplicateIds.has(id)) continue;
      outputs.set(id, {
        ...parseDiagnosisOutput(row),
        provisionalDiagnosisId: id
      });
    } catch {
      // A malformed item is retried independently; valid siblings remain usable.
    }
  }
  return outputs;
}

function parseJson(text: string): unknown {
  try {
    return parseStructuredJson(text);
  } catch {
    throw diagnosisOutputError('AI error diagnosis returned invalid JSON');
  }
}

function parseDiagnosisOutput(value: unknown): DiagnosisOutput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw diagnosisOutputError('AI error diagnosis must be an object');
  }
  const parsed = value as Record<string, unknown>;
  if (
    !Object.values(ErrorCauseCode).includes(parsed.causeCode as never)
    || typeof parsed.detail !== 'string'
    || !parsed.detail.trim()
    || typeof parsed.confidence !== 'number'
    || parsed.confidence < 0
    || parsed.confidence > 0.85
    || typeof parsed.recommendedActionCode !== 'string'
    || !parsed.recommendedActionCode.trim()
  ) {
    throw diagnosisOutputError('AI error diagnosis violates output contract');
  }
  const dimensions = parseDimensions(parsed.dimensions);
  const correctionPlan = parseCorrectionPlan(parsed.correctionPlan);
  return {
    causeCode: parsed.causeCode as typeof ErrorCauseCode[keyof typeof ErrorCauseCode],
    errorStage: typeof parsed.errorStage === 'string' && parsed.errorStage.trim()
      ? parsed.errorStage.trim()
      : undefined,
    detail: parsed.detail.trim(),
    confidence: parsed.confidence,
    recommendedActionCode: parsed.recommendedActionCode.trim(),
    dimensions,
    correctionPlan
  };
}

function parseDimensions(value: unknown): readonly ErrorDiagnosisDimension[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 4) {
    throw diagnosisOutputError('AI error diagnosis dimensions violate output contract');
  }
  const seen = new Set<string>();
  return value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw diagnosisOutputError('AI error diagnosis dimension must be an object');
    }
    const row = item as Record<string, unknown>;
    if (
      !Object.values(ErrorDiagnosisDimensionCode).includes(row.code as never)
      || !Object.values(ErrorDiagnosisDimensionStatus).includes(row.status as never)
      || typeof row.evidence !== 'string'
      || !row.evidence.trim()
      || seen.has(String(row.code))
    ) {
      throw diagnosisOutputError('AI error diagnosis dimension is invalid');
    }
    seen.add(String(row.code));
    return {
      code: row.code as ErrorDiagnosisDimension['code'],
      status: row.status as ErrorDiagnosisDimension['status'],
      evidence: row.evidence.trim()
    };
  });
}

function parseCorrectionPlan(value: unknown): ErrorCorrectionPlan {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw diagnosisOutputError('AI error correction plan must be an object');
  }
  const row = value as Record<string, unknown>;
  const steps = Array.isArray(row.steps)
    ? row.steps.filter((step): step is string => typeof step === 'string' && Boolean(step.trim())).map((step) => step.trim())
    : [];
  if (
    typeof row.objective !== 'string'
    || !row.objective.trim()
    || steps.length < 2
    || steps.length > 4
    || typeof row.practiceFocus !== 'string'
    || !row.practiceFocus.trim()
    || typeof row.successCriteria !== 'string'
    || !row.successCriteria.trim()
  ) {
    throw diagnosisOutputError('AI error correction plan violates output contract');
  }
  return {
    objective: row.objective.trim(),
    steps,
    practiceFocus: row.practiceFocus.trim(),
    successCriteria: row.successCriteria.trim()
  };
}

function diagnosisIdempotencyKey(provisionalDiagnosisId: ErrorDiagnosisId): string {
  return `${provisionalDiagnosisId}:tutor-ai:v1`;
}

function diagnosisOutputError(message: string): Error & { readonly code: string } {
  return Object.assign(new Error(message), { code: 'generation.error_diagnosis_invalid' });
}

async function mapSettledWithConcurrency<Input, Output>(
  values: readonly Input[],
  concurrency: number,
  action: (value: Input) => Promise<Output>
): Promise<readonly PromiseSettledResult<Output>[]> {
  const results: PromiseSettledResult<Output>[] = new Array(values.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), values.length) },
    async () => {
      while (cursor < values.length) {
        const index = cursor;
        cursor += 1;
        try {
          results[index] = { status: 'fulfilled', value: await action(values[index]!) };
        } catch (reason) {
          results[index] = { status: 'rejected', reason };
        }
      }
    }
  );
  await Promise.all(workers);
  return results;
}
