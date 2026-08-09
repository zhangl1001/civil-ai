import type { ExamCycleId } from '@/kernel/public';
import type { TransactionContext } from '../../contracts/UnitOfWork';
import type { IndexedDbTransactionScope } from './IndexedDbUnitOfWork';
import type { TutorDataMaintenance } from '../../contracts/TutorDataMaintenance';
import {
  TutorIndexedDb,
  TutorIndexedDbStore,
  type IndexedDbWriteOperation
} from './TutorIndexedDb';

type Row = Record<string, unknown>;

const cycleStores = [
  TutorIndexedDbStore.ContentQuestionSetBundles,
  TutorIndexedDbStore.GenerationAggregates,
  TutorIndexedDbStore.LearningThreadAggregates,
  TutorIndexedDbStore.LearningSessionFacts,
  TutorIndexedDbStore.ErrorDiagnoses,
  TutorIndexedDbStore.ErrorDiagnosisConfirmations,
  TutorIndexedDbStore.AgentRunAggregates,
  TutorIndexedDbStore.MasteryTracks,
  TutorIndexedDbStore.MasterySnapshots,
  TutorIndexedDbStore.ReviewQueue,
  TutorIndexedDbStore.DailyPlanAggregates,
  TutorIndexedDbStore.LearningEvidenceAggregates,
  TutorIndexedDbStore.ProactiveSignals,
  TutorIndexedDbStore.LearningAssets,
  TutorIndexedDbStore.QuestionImportDrafts,
  TutorIndexedDbStore.QuestionReferencePacks,
  TutorIndexedDbStore.TutorCycleConclusions,
  TutorIndexedDbStore.AbilityCalibrationSnapshots
] as const;

export class IndexedDbTutorDataMaintenance implements TutorDataMaintenance {
  constructor(
    private readonly database: TutorIndexedDb,
    private readonly scope: IndexedDbTransactionScope
  ) {}

  async clearLearningData(examCycleId: ExamCycleId, context?: TransactionContext): Promise<number> {
    const rowsByStore = new Map<TutorIndexedDbStore, readonly Row[]>();
    for (const store of cycleStores) {
      rowsByStore.set(store, await this.database.getAll<Row>(store));
    }
    const diagnosisIds = idsMatching(rowsByStore, TutorIndexedDbStore.ErrorDiagnoses, examCycleId, 'id');
    const workflowIds = idsMatching(rowsByStore, TutorIndexedDbStore.GenerationAggregates, examCycleId, 'workflowId');
    const runIds = idsMatching(rowsByStore, TutorIndexedDbStore.AgentRunAggregates, examCycleId, 'runId');
    const draftIds = idsMatching(rowsByStore, TutorIndexedDbStore.QuestionImportDrafts, examCycleId, 'id');
    const questionIds = questionIdsMatching(
      rowsByStore.get(TutorIndexedDbStore.ContentQuestionSetBundles) || [],
      examCycleId
    );
    const [sourceLinks, publishReceipts, sourceReceipts, sources] = await Promise.all([
      this.database.getAll<Row>(TutorIndexedDbStore.QuestionSourceLinks),
      this.database.getAll<Row>(TutorIndexedDbStore.QuestionImportPublishReceipts),
      this.database.getAll<Row>(TutorIndexedDbStore.QuestionSourceImportReceipts),
      this.database.getAll<Row>(TutorIndexedDbStore.QuestionSources)
    ]);
    const sourceIds = sourceIdsMatching(
      rowsByStore.get(TutorIndexedDbStore.ContentQuestionSetBundles) || [],
      sourceLinks,
      publishReceipts,
      examCycleId,
      questionIds,
      draftIds
    );
    const operations: IndexedDbWriteOperation[] = [];

    for (const [store, rows] of rowsByStore) {
      rows.filter((row) => matchesCycle(row, examCycleId)).forEach((row) => {
        const key = keyOf(store, row);
        if (key) operations.push({ type: 'delete', store, key });
        if (store === TutorIndexedDbStore.AgentRunAggregates) {
          const idempotencyKey = text(row.idempotencyKey);
          if (idempotencyKey) {
            operations.push({
              type: 'delete',
              store: TutorIndexedDbStore.AgentRunIdempotency,
              key: idempotencyKey
            });
          }
        }
      });
    }
    await appendLinkedDeletes(this.database, operations, TutorIndexedDbStore.ErrorDiagnosisProjections, (row) => (
      diagnosisIds.has(text(row.diagnosisId))
    ));
    await appendLinkedDeletes(this.database, operations, TutorIndexedDbStore.AIInvocations, (row) => (
      workflowIds.has(text(row.workflowId))
    ));
    await appendLinkedDeletes(this.database, operations, TutorIndexedDbStore.AgentToolReceipts, (row) => (
      runIds.has(text(row.agentRunId))
    ));
    await appendLinkedDeletes(this.database, operations, TutorIndexedDbStore.QuestionImportCandidates, (row) => (
      draftIds.has(text(row.draftId))
    ));
    await appendLinkedDeletes(this.database, operations, TutorIndexedDbStore.QuestionImportPublishReceipts, (row) => (
      draftIds.has(text(row.draftId))
    ));
    await appendLinkedDeletes(this.database, operations, TutorIndexedDbStore.QuestionSourceLinks, (row) => (
      questionIds.has(text(row.questionId))
    ));
    await appendLinkedDeletes(this.database, operations, TutorIndexedDbStore.QuestionLineages, (row) => (
      questionIds.has(text(row.questionId)) || questionIds.has(text(row.parentQuestionId))
    ));
    sourceReceipts.filter((row) => sourceIds.has(text(row.sourceId))).forEach((row) => {
      const key = keyOf(TutorIndexedDbStore.QuestionSourceImportReceipts, row);
      if (key) operations.push({ type: 'delete', store: TutorIndexedDbStore.QuestionSourceImportReceipts, key });
    });
    sources.filter((row) => sourceIds.has(text(row.id))).forEach((row) => {
      const key = keyOf(TutorIndexedDbStore.QuestionSources, row);
      if (key) operations.push({ type: 'delete', store: TutorIndexedDbStore.QuestionSources, key });
    });
    await appendAllDeletes(this.database, operations, TutorIndexedDbStore.DomainOutbox);
    await appendAllDeletes(this.database, operations, TutorIndexedDbStore.SystemMessages);
    if (context) {
      operations.forEach((operation) => this.scope.stage(context, operation));
    } else {
      await this.database.writeBatch(operations);
    }
    return operations.length;
  }

}

function questionIdsMatching(rows: readonly Row[], examCycleId: string): ReadonlySet<string> {
  const ids = rows
    .filter((row) => matchesCycle(row, examCycleId))
    .flatMap((row) => {
      const questions = record(row.bundle).questions;
      return Array.isArray(questions)
        ? questions.map((question) => text(record(question).id))
        : [];
    })
    .filter(Boolean);
  return new Set(ids);
}

function sourceIdsMatching(
  bundles: readonly Row[],
  links: readonly Row[],
  publishReceipts: readonly Row[],
  examCycleId: string,
  questionIds: ReadonlySet<string>,
  draftIds: ReadonlySet<string>
): ReadonlySet<string> {
  const candidates = new Set<string>();
  links.filter((row) => questionIds.has(text(row.questionId)))
    .forEach((row) => candidates.add(text(row.sourceId)));
  publishReceipts.filter((row) => draftIds.has(text(row.draftId)))
    .forEach((row) => candidates.add(text(row.sourceId)));
  bundles.filter((row) => matchesCycle(row, examCycleId)).forEach((row) => {
    const bundle = record(row.bundle);
    candidates.add(text(record(bundle.questionSet).sourceId));
    const questions = Array.isArray(bundle.questions) ? bundle.questions : [];
    questions.forEach((question) => candidates.add(text(record(question).sourceId)));
  });
  candidates.delete('');

  const retained = new Set<string>();
  links.filter((row) => !questionIds.has(text(row.questionId)))
    .forEach((row) => retained.add(text(row.sourceId)));
  publishReceipts.filter((row) => !draftIds.has(text(row.draftId)))
    .forEach((row) => retained.add(text(row.sourceId)));
  bundles.filter((row) => !matchesCycle(row, examCycleId)).forEach((row) => {
    const bundle = record(row.bundle);
    retained.add(text(record(bundle.questionSet).sourceId));
    const questions = Array.isArray(bundle.questions) ? bundle.questions : [];
    questions.forEach((question) => retained.add(text(record(question).sourceId)));
  });
  return new Set([...candidates].filter((sourceId) => !retained.has(sourceId)));
}

async function appendAllDeletes(
  database: TutorIndexedDb,
  operations: IndexedDbWriteOperation[],
  store: TutorIndexedDbStore
): Promise<void> {
  const rows = await database.getAll<Row>(store);
  rows.forEach((row) => {
    const key = keyOf(store, row);
    if (key) operations.push({ type: 'delete', store, key });
  });
}

function idsMatching(
  rowsByStore: ReadonlyMap<TutorIndexedDbStore, readonly Row[]>,
  store: TutorIndexedDbStore,
  examCycleId: string,
  key: string
): ReadonlySet<string> {
  return new Set((rowsByStore.get(store) || [])
    .filter((row) => matchesCycle(row, examCycleId))
    .map((row) => text(row[key]))
    .filter(Boolean));
}

async function appendLinkedDeletes(
  database: TutorIndexedDb,
  operations: IndexedDbWriteOperation[],
  store: TutorIndexedDbStore,
  matches: (row: Row) => boolean
): Promise<void> {
  const rows = await database.getAll<Row>(store);
  rows.filter(matches).forEach((row) => {
    const key = keyOf(store, row);
    if (key) operations.push({ type: 'delete', store, key });
  });
}

function matchesCycle(row: Row, examCycleId: string): boolean {
  if (text(row.examCycleId) === examCycleId || text(row.examCycleKey) === examCycleId) return true;
  return ['aggregate', 'run', 'plan', 'spec', 'session', 'asset', 'bundle']
    .some((key) => {
      const nested = record(row[key]);
      return text(nested.examCycleId) === examCycleId
        || text(record(nested.spec).examCycleId) === examCycleId
        || text(record(nested.questionSet).examCycleId) === examCycleId;
    });
}

function keyOf(store: TutorIndexedDbStore, row: Row): IDBValidKey | undefined {
  if (store === TutorIndexedDbStore.DomainOutbox || store === TutorIndexedDbStore.SystemMessages) return text(row.id);
  if (store === TutorIndexedDbStore.ContentQuestionSetBundles) return text(row.questionSetId);
  if (store === TutorIndexedDbStore.GenerationAggregates) return text(row.workflowId);
  if (store === TutorIndexedDbStore.LearningThreadAggregates) return text(row.threadId);
  if (store === TutorIndexedDbStore.LearningSessionFacts) return text(row.sessionId);
  if (store === TutorIndexedDbStore.ErrorDiagnosisProjections) return text(row.diagnosisId);
  if (store === TutorIndexedDbStore.AgentRunAggregates) return text(row.runId);
  if (store === TutorIndexedDbStore.AgentToolReceipts) {
    const agentRunId = text(row.agentRunId);
    const toolCallId = text(row.toolCallId);
    return agentRunId && toolCallId ? [agentRunId, toolCallId] : undefined;
  }
  if (store === TutorIndexedDbStore.DailyPlanAggregates) return text(record(row.plan).id);
  if (store === TutorIndexedDbStore.LearningEvidenceAggregates) return text(row.evidenceId);
  return text(row.id);
}

function record(value: unknown): Row {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
