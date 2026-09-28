import type { LearningDataRecord } from '../../contracts/TutorDataMaintenance';
import { TutorIndexedDbStore } from './TutorIndexedDb';

type Row = LearningDataRecord;
export type RowsByStore = ReadonlyMap<TutorIndexedDbStore, readonly Row[]>;

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
  TutorIndexedDbStore.LearningProgress,
  TutorIndexedDbStore.LearningAssets,
  TutorIndexedDbStore.QuestionImportDrafts,
  TutorIndexedDbStore.QuestionReferencePacks,
  TutorIndexedDbStore.TutorCycleConclusions,
  TutorIndexedDbStore.AbilityCalibrationSnapshots
] as const;

/**
 * Every store clearLearningData deletes from. Clearing, exporting and validating
 * a restore all select rows through learningRecordsOf, so a backup carries
 * exactly what the cleanup removes.
 */
export const learningRecordStores: readonly TutorIndexedDbStore[] = [
  ...cycleStores,
  TutorIndexedDbStore.AgentRunIdempotency,
  TutorIndexedDbStore.AgentToolReceipts,
  TutorIndexedDbStore.ErrorDiagnosisProjections,
  TutorIndexedDbStore.AIInvocations,
  TutorIndexedDbStore.QuestionSourceLinks,
  TutorIndexedDbStore.QuestionLineages,
  TutorIndexedDbStore.QuestionSourceImportReceipts,
  TutorIndexedDbStore.QuestionImportCandidates,
  TutorIndexedDbStore.QuestionImportPublishReceipts,
  TutorIndexedDbStore.DomainOutbox,
  TutorIndexedDbStore.SystemMessages
];

/** The rows of each learning store that belong to the cycle, judged only from the given rows. */
export function learningRecordsOf(rowsByStore: RowsByStore, examCycleId: string): Map<TutorIndexedDbStore, Row[]> {
  const owned = new Map<TutorIndexedDbStore, Row[]>();
  for (const store of cycleStores) {
    owned.set(store, rowsOf(rowsByStore, store).filter((row) => matchesCycle(row, examCycleId)));
  }
  const diagnosisIds = fieldValues(owned, TutorIndexedDbStore.ErrorDiagnoses, 'id');
  const workflowIds = fieldValues(owned, TutorIndexedDbStore.GenerationAggregates, 'workflowId');
  const questionSetIds = fieldValues(owned, TutorIndexedDbStore.ContentQuestionSetBundles, 'questionSetId');
  const agentRunIds = fieldValues(owned, TutorIndexedDbStore.AgentRunAggregates, 'runId');
  const agentRunKeys = fieldValues(owned, TutorIndexedDbStore.AgentRunAggregates, 'idempotencyKey');
  const learningThreadIds = fieldValues(owned, TutorIndexedDbStore.LearningThreadAggregates, 'threadId');
  const learningSessionIds = fieldValues(owned, TutorIndexedDbStore.LearningSessionFacts, 'sessionId');
  const learningEvidenceIds = fieldValues(owned, TutorIndexedDbStore.LearningEvidenceAggregates, 'evidenceId');
  const dailyPlanIds = storeKeys(owned, TutorIndexedDbStore.DailyPlanAggregates);
  const reviewQueueIds = storeKeys(owned, TutorIndexedDbStore.ReviewQueue);
  const draftIds = fieldValues(owned, TutorIndexedDbStore.QuestionImportDrafts, 'id');
  const questionIds = questionIdsOf(owned);
  const sourceIds = linkedSourceIds(rowsByStore, questionIds, draftIds);
  const link = (store: TutorIndexedDbStore, matches: (row: Row) => boolean) => {
    owned.set(store, rowsOf(rowsByStore, store).filter(matches));
  };

  link(TutorIndexedDbStore.AgentRunIdempotency, (row) => agentRunKeys.has(text(row.idempotencyKey)));
  link(TutorIndexedDbStore.AgentToolReceipts, (row) => agentRunIds.has(text(row.agentRunId)));
  link(TutorIndexedDbStore.ErrorDiagnosisProjections, (row) => diagnosisIds.has(text(row.diagnosisId)));
  link(TutorIndexedDbStore.AIInvocations, (row) => workflowIds.has(text(row.workflowId)));
  link(TutorIndexedDbStore.QuestionSourceLinks, (row) => questionIds.has(text(row.questionId)));
  link(TutorIndexedDbStore.QuestionLineages, (row) => (
    questionIds.has(text(row.questionId)) || questionIds.has(text(row.parentQuestionId))
  ));
  link(TutorIndexedDbStore.QuestionSourceImportReceipts, (row) => sourceIds.has(text(row.sourceId)));
  link(TutorIndexedDbStore.QuestionImportCandidates, (row) => draftIds.has(text(row.draftId)));
  link(TutorIndexedDbStore.QuestionImportPublishReceipts, (row) => draftIds.has(text(row.draftId)));
  link(TutorIndexedDbStore.DomainOutbox, (row) => {
    const aggregateId = text(row.aggregateId);
    const aggregateType = text(row.aggregateType);
    if (aggregateType === 'learning_thread') return learningThreadIds.has(aggregateId);
    if (aggregateType === 'tutor_agent_run') return agentRunIds.has(aggregateId);
    if (aggregateType === 'error_diagnosis') return diagnosisIds.has(aggregateId);
    if (aggregateType === 'learning_session') return learningSessionIds.has(aggregateId);
    if (aggregateType === 'learning_evidence') return learningEvidenceIds.has(aggregateId);
    if (aggregateType === 'generation_workflow') return workflowIds.has(aggregateId);
    if (aggregateType === 'question_set') return questionSetIds.has(aggregateId);
    return false;
  });
  link(TutorIndexedDbStore.SystemMessages, (row) => {
    const sourceId = text(row.sourceId);
    const sourceType = text(row.sourceType);
    if (sourceType === 'exam_cycle') return sourceId === examCycleId;
    if (sourceType === 'agent_run') return agentRunIds.has(sourceId);
    if (sourceType === 'daily_plan') return dailyPlanIds.has(sourceId);
    if (sourceType === 'review_queue') return reviewQueueIds.has(sourceId);
    if (sourceType === 'learning_session') return learningSessionIds.has(sourceId);
    return false;
  });
  return owned;
}

/** Question sources are shared and never cleared; a restore on a fresh browser needs the cited ones. */
export function citedQuestionSourceIds(records: RowsByStore): ReadonlySet<string> {
  const ids = new Set<string>();
  const add = (value: unknown) => {
    if (text(value)) ids.add(text(value));
  };
  for (const store of [
    TutorIndexedDbStore.QuestionSourceLinks,
    TutorIndexedDbStore.QuestionSourceImportReceipts,
    TutorIndexedDbStore.QuestionImportPublishReceipts
  ]) {
    rowsOf(records, store).forEach((row) => add(row.sourceId));
  }
  rowsOf(records, TutorIndexedDbStore.ContentQuestionSetBundles).forEach((row) => {
    const bundle = record(row.bundle);
    add(record(bundle.questionSet).sourceId);
    array(bundle.questions).forEach((question) => add(record(question).sourceId));
  });
  return ids;
}

export function keyOf(store: TutorIndexedDbStore, row: Row): IDBValidKey | undefined {
  if (store === TutorIndexedDbStore.DomainOutbox || store === TutorIndexedDbStore.SystemMessages) return text(row.id);
  if (store === TutorIndexedDbStore.ContentQuestionSetBundles) return text(row.questionSetId);
  if (store === TutorIndexedDbStore.GenerationAggregates) return text(row.workflowId);
  if (store === TutorIndexedDbStore.LearningThreadAggregates) return text(row.threadId);
  if (store === TutorIndexedDbStore.LearningSessionFacts) return text(row.sessionId);
  if (store === TutorIndexedDbStore.ErrorDiagnosisProjections) return text(row.diagnosisId);
  if (store === TutorIndexedDbStore.AgentRunAggregates) return text(row.runId);
  if (store === TutorIndexedDbStore.AgentRunIdempotency) return text(row.idempotencyKey);
  if (store === TutorIndexedDbStore.DailyPlanAggregates) return text(record(row.plan).id);
  if (store === TutorIndexedDbStore.LearningEvidenceAggregates) return text(row.evidenceId);
  if (store === TutorIndexedDbStore.AgentToolReceipts) {
    const agentRunId = text(row.agentRunId);
    const toolCallId = text(row.toolCallId);
    return agentRunId && toolCallId ? [agentRunId, toolCallId] : undefined;
  }
  return text(row.id);
}

export function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function questionIdsOf(owned: RowsByStore): ReadonlySet<string> {
  const ids = new Set<string>();
  rowsOf(owned, TutorIndexedDbStore.ContentQuestionSetBundles).forEach((row) => {
    array(record(row.bundle).questions).forEach((question) => {
      const id = text(record(question).id);
      if (id) ids.add(id);
    });
  });
  return ids;
}

function linkedSourceIds(
  rowsByStore: RowsByStore,
  questionIds: ReadonlySet<string>,
  draftIds: ReadonlySet<string>
): ReadonlySet<string> {
  const ids = new Set<string>();
  rowsOf(rowsByStore, TutorIndexedDbStore.QuestionSourceLinks).forEach((row) => {
    if (questionIds.has(text(row.questionId)) && text(row.sourceId)) ids.add(text(row.sourceId));
  });
  rowsOf(rowsByStore, TutorIndexedDbStore.QuestionImportPublishReceipts).forEach((row) => {
    if (draftIds.has(text(row.draftId)) && text(row.sourceId)) ids.add(text(row.sourceId));
  });
  return ids;
}

function fieldValues(owned: RowsByStore, store: TutorIndexedDbStore, field: string): ReadonlySet<string> {
  return new Set(rowsOf(owned, store).map((row) => text(row[field])).filter(Boolean));
}

function storeKeys(owned: RowsByStore, store: TutorIndexedDbStore): ReadonlySet<string> {
  return new Set(rowsOf(owned, store)
    .map((row) => keyOf(store, row))
    .filter((key): key is string => typeof key === 'string' && Boolean(key)));
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

function rowsOf(rowsByStore: RowsByStore, store: TutorIndexedDbStore): readonly Row[] {
  return rowsByStore.get(store) ?? [];
}

function array(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function record(value: unknown): Row {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
}
