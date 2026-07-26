import type { PromptCompiler, ProviderGateway } from '@/capabilities/ai-runtime/public';
import {
  errorDiagnosisBatchPromptV1,
  errorDiagnosisPromptV1,
  parseStructuredJson
} from '@/capabilities/ai-runtime/public';
import type { UnitOfWork } from '@/capabilities/database/public';
import type { AgentRunId, Clock, ErrorDiagnosisId, IdGenerator, JsonObject } from '@/kernel/public';
import { AgentRunAction, InvokeAgentModel, TransitionAgentRun } from '@/modules/agent/public';
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
  readonly items: readonly ErrorDiagnosisBatchItem[];
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

export class RunAiErrorDiagnosis {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly diagnoses: ErrorDiagnosisRepository,
    private readonly outbox: OutboxRepository,
    private readonly compiler: PromptCompiler,
    private readonly invoke: InvokeAgentModel,
    private readonly transition: TransitionAgentRun,
    private readonly clock: Clock,
    private readonly ids: IdGenerator
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

    if (!pending.length) {
      await this.completeRun(command.agentRunId, diagnosisIds, [], 0);
      return diagnosisIds;
    }

    const batch = await this.invokeBatch(command.agentRunId, pending, gateway, signal);
    const validBatch: { pending: PendingDiagnosis; output: DiagnosisOutput }[] = [];
    const unresolved: PendingDiagnosis[] = [];
    for (const item of pending) {
      const output = batch.outputs.get(item.provisional.id);
      if (output) validBatch.push({ pending: item, output });
      else unresolved.push(item);
    }

    if (validBatch.length) {
      diagnosisIds.push(...await this.commit(command.agentRunId, validBatch));
    }

    const fallbackInvocationIds: string[] = [];
    for (const item of unresolved) {
      signal?.throwIfAborted();
      const fallback = await this.invokeSingle(command.agentRunId, item, gateway, signal);
      fallbackInvocationIds.push(fallback.invocationId);
      diagnosisIds.push(...await this.commit(command.agentRunId, [{
        pending: item,
        output: fallback.output
      }]));
    }

    await this.completeRun(
      command.agentRunId,
      diagnosisIds,
      [batch.invocationId, ...fallbackInvocationIds],
      unresolved.length
    );
    return diagnosisIds;
  }

  private async invokeBatch(
    agentRunId: AgentRunId,
    pending: readonly PendingDiagnosis[],
    gateway: ProviderGateway,
    signal?: AbortSignal
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
    signal?: AbortSignal
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
    values: readonly { readonly pending: PendingDiagnosis; readonly output: DiagnosisOutput }[]
  ): Promise<readonly ErrorDiagnosisId[]> {
    if (!values.length) return [];
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
    await this.unitOfWork.run(async (context) => {
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
    fallbackCount: number
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
      }
    });
  }
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
