import { TUTOR_DATABASE_NAME } from '../../config/TutorDatabaseConfig';

export const TUTOR_INDEXEDDB_NAME = `${TUTOR_DATABASE_NAME}-web`;
export const TUTOR_INDEXEDDB_VERSION = 31;

export const TutorIndexedDbStore = {
  CandidateCycleBundles: 'candidate_cycle_bundles',
  CurriculumBundles: 'curriculum_bundles',
  DomainOutbox: 'domain_outbox',
  OnboardingDrafts: 'onboarding_drafts',
  CommandReceipts: 'command_receipts',
  ContentMetadataBundles: 'content_metadata_bundles',
  ContentQuestionSetBundles: 'content_question_set_bundles',
  PromptBundles: 'prompt_bundles',
  AIInvocations: 'ai_invocations',
  GenerationAggregates: 'generation_aggregates',
  LearningThreadAggregates: 'learning_thread_aggregates',
  LearningSessionFacts: 'learning_session_facts',
  ErrorDiagnoses: 'error_diagnoses',
  ErrorDiagnosisConfirmations: 'error_diagnosis_confirmations',
  ErrorDiagnosisProjections: 'error_diagnosis_projections',
  AgentRunAggregates: 'agent_run_aggregates',
  AgentRunIdempotency: 'agent_run_idempotency',
  AgentToolReceipts: 'agent_tool_receipts',
  MasteryTracks: 'mastery_tracks',
  MasterySnapshots: 'mastery_snapshots',
  ReviewQueue: 'review_queue',
  DailyPlanAggregates: 'daily_plan_aggregates',
  LearningEvidenceAggregates: 'learning_evidence_aggregates',
  SystemMessages: 'system_messages',
  ProactiveSignals: 'proactive_signals',
  LearningAssets: 'learning_assets',
  QuestionSources: 'question_sources',
  QuestionSourceLinks: 'question_source_links',
  QuestionLineages: 'question_lineages',
  QuestionSourceImportReceipts: 'question_source_import_receipts',
  QuestionImportDrafts: 'question_import_drafts',
  QuestionImportCandidates: 'question_import_candidates',
  QuestionImportPublishReceipts: 'question_import_publish_receipts',
  QuestionReferencePacks: 'question_reference_packs',
  TutorCycleConclusions: 'tutor_cycle_conclusions',
  AbilityCalibrationSnapshots: 'ability_calibration_snapshots'
} as const;

export type TutorIndexedDbStore = typeof TutorIndexedDbStore[keyof typeof TutorIndexedDbStore];

export interface IndexedDbWriteOperation {
  readonly type: 'add' | 'put' | 'delete';
  readonly store: TutorIndexedDbStore;
  readonly value?: unknown;
  readonly key?: IDBValidKey;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Tutor IndexedDB request failed'));
  });
}

function transactionCompletion(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Tutor IndexedDB transaction failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Tutor IndexedDB transaction aborted'));
  });
}

export class TutorIndexedDb {
  private database: IDBDatabase | undefined;
  private openPromise: Promise<void> | undefined;

  open(): Promise<void> {
    if (this.database) return Promise.resolve();
    if (!this.openPromise) {
      this.openPromise = this.openDatabase().catch((error: unknown) => {
        this.openPromise = undefined;
        throw error;
      });
    }
    return this.openPromise;
  }

  close(): void {
    this.database?.close();
    this.database = undefined;
    this.openPromise = undefined;
  }

  async resetForDevelopment(): Promise<void> {
    this.close();
    await new Promise<void>((resolve, reject) => {
      const request = globalThis.indexedDB.deleteDatabase(TUTOR_INDEXEDDB_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error('Tutor IndexedDB reset failed'));
      request.onblocked = () => reject(new Error('Tutor IndexedDB reset is blocked by another tab'));
    });
  }

  async get<Value>(storeName: TutorIndexedDbStore, key: string): Promise<Value | undefined> {
    await this.open();
    const transaction = this.requireDatabase().transaction(storeName, 'readonly');
    return requestResult<Value | undefined>(transaction.objectStore(storeName).get(key));
  }

  async getAll<Value>(storeName: TutorIndexedDbStore): Promise<readonly Value[]> {
    await this.open();
    const transaction = this.requireDatabase().transaction(storeName, 'readonly');
    return requestResult<Value[]>(transaction.objectStore(storeName).getAll());
  }

  async getAllByIndex<Value>(
    storeName: TutorIndexedDbStore,
    indexName: string,
    key: IDBValidKey
  ): Promise<readonly Value[]> {
    await this.open();
    const transaction = this.requireDatabase().transaction(storeName, 'readonly');
    return requestResult<Value[]>(transaction.objectStore(storeName).index(indexName).getAll(key));
  }

  async writeBatch(operations: readonly IndexedDbWriteOperation[]): Promise<void> {
    if (operations.length === 0) return;
    await this.open();
    const storeNames = [...new Set(operations.map((operation) => operation.store))];
    const transaction = this.requireDatabase().transaction(storeNames, 'readwrite');
    for (const operation of operations) {
      const store = transaction.objectStore(operation.store);
      if (operation.type === 'add') store.add(operation.value);
      if (operation.type === 'put') store.put(operation.value);
      if (operation.type === 'delete' && operation.key !== undefined) store.delete(operation.key);
    }
    await transactionCompletion(transaction);
  }

  async mutateStore<Value, Result>(
    storeName: TutorIndexedDbStore,
    mutation: (values: readonly Value[]) => { readonly operations: readonly IndexedDbWriteOperation[]; readonly result: Result }
  ): Promise<Result> {
    await this.open();
    return new Promise<Result>((resolve, reject) => {
      const transaction = this.requireDatabase().transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.getAll();
      let mutationResult: Result | undefined;
      let hasResult = false;

      request.onsuccess = () => {
        try {
          const outcome = mutation(request.result as Value[]);
          for (const operation of outcome.operations) {
            if (operation.store !== storeName) throw new Error('IndexedDB mutation cannot write another store');
            if (operation.type === 'add') store.add(operation.value);
            if (operation.type === 'put') store.put(operation.value);
            if (operation.type === 'delete' && operation.key !== undefined) store.delete(operation.key);
          }
          mutationResult = outcome.result;
          hasResult = true;
        } catch (error) {
          transaction.abort();
          reject(error);
        }
      };
      request.onerror = () => reject(request.error ?? new Error('Tutor IndexedDB mutation read failed'));
      transaction.oncomplete = () => {
        if (hasResult) resolve(mutationResult as Result);
      };
      transaction.onerror = () => reject(transaction.error ?? new Error('Tutor IndexedDB mutation failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Tutor IndexedDB mutation aborted'));
    });
  }

  async mutateStores<Result>(
    requestedStores: readonly TutorIndexedDbStore[],
    mutation: (
      values: ReadonlyMap<TutorIndexedDbStore, readonly unknown[]>
    ) => { readonly operations: readonly IndexedDbWriteOperation[]; readonly result: Result }
  ): Promise<Result> {
    const storeNames = [...new Set(requestedStores)];
    if (storeNames.length === 0) throw new Error('IndexedDB mutation requires at least one store');
    await this.open();
    return new Promise<Result>((resolve, reject) => {
      const transaction = this.requireDatabase().transaction(storeNames, 'readwrite');
      const values = new Map<TutorIndexedDbStore, readonly unknown[]>();
      let pending = storeNames.length;
      let mutationResult: Result | undefined;
      let hasResult = false;
      let rejected = false;

      const rejectOnce = (error: unknown) => {
        if (rejected) return;
        rejected = true;
        reject(error);
      };
      const applyMutation = () => {
        try {
          const outcome = mutation(values);
          for (const operation of outcome.operations) {
            if (!storeNames.includes(operation.store)) {
              throw new Error('IndexedDB mutation cannot write an unopened store');
            }
            const store = transaction.objectStore(operation.store);
            if (operation.type === 'add') store.add(operation.value);
            if (operation.type === 'put') store.put(operation.value);
            if (operation.type === 'delete' && operation.key !== undefined) store.delete(operation.key);
          }
          mutationResult = outcome.result;
          hasResult = true;
        } catch (error) {
          transaction.abort();
          rejectOnce(error);
        }
      };

      for (const storeName of storeNames) {
        const request = transaction.objectStore(storeName).getAll();
        request.onsuccess = () => {
          values.set(storeName, request.result);
          pending -= 1;
          if (pending === 0) applyMutation();
        };
        request.onerror = () => {
          transaction.abort();
          rejectOnce(request.error ?? new Error('IndexedDB multi-store mutation read failed'));
        };
      }
      transaction.oncomplete = () => {
        if (hasResult) resolve(mutationResult as Result);
      };
      transaction.onerror = () => rejectOnce(
        transaction.error ?? new Error('IndexedDB multi-store mutation failed')
      );
      transaction.onabort = () => rejectOnce(
        transaction.error ?? new Error('IndexedDB multi-store mutation aborted')
      );
    });
  }

  private openDatabase(): Promise<void> {
    if (!globalThis.indexedDB) return Promise.reject(new Error('IndexedDB is not available in this environment'));
    return new Promise((resolve, reject) => {
      const request = globalThis.indexedDB.open(TUTOR_INDEXEDDB_NAME, TUTOR_INDEXEDDB_VERSION);
      request.onupgradeneeded = (event) => {
        const database = request.result;
        if (!database.objectStoreNames.contains(TutorIndexedDbStore.CandidateCycleBundles)) {
          database.createObjectStore(TutorIndexedDbStore.CandidateCycleBundles, { keyPath: 'projectId' });
        }
        if (!database.objectStoreNames.contains(TutorIndexedDbStore.CurriculumBundles)) {
          database.createObjectStore(TutorIndexedDbStore.CurriculumBundles, { keyPath: 'curriculumVersionId' });
        }
        if (!database.objectStoreNames.contains(TutorIndexedDbStore.DomainOutbox)) {
          database.createObjectStore(TutorIndexedDbStore.DomainOutbox, { keyPath: 'id' });
        }
        if (!database.objectStoreNames.contains(TutorIndexedDbStore.OnboardingDrafts)) {
          database.createObjectStore(TutorIndexedDbStore.OnboardingDrafts, { keyPath: 'id' });
        }
        if (!database.objectStoreNames.contains(TutorIndexedDbStore.CommandReceipts)) {
          database.createObjectStore(TutorIndexedDbStore.CommandReceipts, { keyPath: 'idempotencyKey' });
        }
        if (!database.objectStoreNames.contains(TutorIndexedDbStore.ContentMetadataBundles)) {
          database.createObjectStore(TutorIndexedDbStore.ContentMetadataBundles, { keyPath: 'releaseId' });
        }
        if (!database.objectStoreNames.contains(TutorIndexedDbStore.ContentQuestionSetBundles)) {
          database.createObjectStore(TutorIndexedDbStore.ContentQuestionSetBundles, { keyPath: 'questionSetId' });
        }
        if (!database.objectStoreNames.contains(TutorIndexedDbStore.PromptBundles)) {
          database.createObjectStore(TutorIndexedDbStore.PromptBundles, { keyPath: 'key' });
        }
        if (!database.objectStoreNames.contains(TutorIndexedDbStore.AIInvocations)) {
          database.createObjectStore(TutorIndexedDbStore.AIInvocations, { keyPath: 'id' });
        }
        if (!database.objectStoreNames.contains(TutorIndexedDbStore.GenerationAggregates)) {
          database.createObjectStore(TutorIndexedDbStore.GenerationAggregates, { keyPath: 'workflowId' });
        }
        if (!database.objectStoreNames.contains(TutorIndexedDbStore.LearningThreadAggregates)) {
          database.createObjectStore(TutorIndexedDbStore.LearningThreadAggregates, { keyPath: 'threadId' });
        }
        if (!database.objectStoreNames.contains(TutorIndexedDbStore.LearningSessionFacts)) {
          database.createObjectStore(TutorIndexedDbStore.LearningSessionFacts, { keyPath: 'sessionId' });
        }
        const sessionStore = request.transaction?.objectStore(TutorIndexedDbStore.LearningSessionFacts);
        if (sessionStore && !sessionStore.indexNames.contains('by_question_set')) {
          sessionStore.createIndex('by_question_set', 'session.questionSetId', { unique: false });
        }
        if (!database.objectStoreNames.contains(TutorIndexedDbStore.ErrorDiagnoses)) {
          database.createObjectStore(TutorIndexedDbStore.ErrorDiagnoses, { keyPath: 'id' });
        }
        if (!database.objectStoreNames.contains(TutorIndexedDbStore.ErrorDiagnosisConfirmations)) {
          database.createObjectStore(TutorIndexedDbStore.ErrorDiagnosisConfirmations, { keyPath: 'id' });
        }
        if (!database.objectStoreNames.contains(TutorIndexedDbStore.ErrorDiagnosisProjections)) {
          database.createObjectStore(TutorIndexedDbStore.ErrorDiagnosisProjections, { keyPath: 'diagnosisId' });
        }
        if (!database.objectStoreNames.contains(TutorIndexedDbStore.AgentRunAggregates)) {
          database.createObjectStore(TutorIndexedDbStore.AgentRunAggregates, { keyPath: 'runId' });
        }
        const agentRunIdempotencyStore = database.objectStoreNames.contains(TutorIndexedDbStore.AgentRunIdempotency)
          ? request.transaction?.objectStore(TutorIndexedDbStore.AgentRunIdempotency)
          : database.createObjectStore(TutorIndexedDbStore.AgentRunIdempotency, {
              keyPath: 'idempotencyKey'
            });
        if (!database.objectStoreNames.contains(TutorIndexedDbStore.AgentToolReceipts)) {
          database.createObjectStore(TutorIndexedDbStore.AgentToolReceipts, {
            keyPath: ['agentRunId', 'toolCallId']
          });
        }
        const agentRunStore = request.transaction?.objectStore(TutorIndexedDbStore.AgentRunAggregates);
        if (agentRunStore && !agentRunStore.indexNames.contains('by_target')) {
          agentRunStore.createIndex('by_target', ['run.targetResourceType', 'run.targetResourceId'], { unique: false });
        }
        if (event.oldVersion < 30 && agentRunStore && agentRunIdempotencyStore) {
          const cursorRequest = agentRunStore.openCursor();
          cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result;
            if (!cursor) return;
            const value = cursor.value as {
              readonly runId?: string;
              readonly idempotencyKey?: string;
            };
            if (value.runId && value.idempotencyKey) {
              agentRunIdempotencyStore.put({
                idempotencyKey: value.idempotencyKey,
                runId: value.runId
              });
            }
            cursor.continue();
          };
        }
        if (!database.objectStoreNames.contains(TutorIndexedDbStore.MasteryTracks)) database.createObjectStore(TutorIndexedDbStore.MasteryTracks, { keyPath: 'id' });
        if (!database.objectStoreNames.contains(TutorIndexedDbStore.MasterySnapshots)) database.createObjectStore(TutorIndexedDbStore.MasterySnapshots, { keyPath: 'id' });
        if (!database.objectStoreNames.contains(TutorIndexedDbStore.ReviewQueue)) database.createObjectStore(TutorIndexedDbStore.ReviewQueue, { keyPath: 'id' });
        if (!database.objectStoreNames.contains(TutorIndexedDbStore.DailyPlanAggregates)) database.createObjectStore(TutorIndexedDbStore.DailyPlanAggregates, { keyPath: 'plan.id' });
        if (!database.objectStoreNames.contains(TutorIndexedDbStore.LearningEvidenceAggregates)) {
          database.createObjectStore(TutorIndexedDbStore.LearningEvidenceAggregates, { keyPath: 'evidenceId' });
        }
        if (!database.objectStoreNames.contains(TutorIndexedDbStore.SystemMessages)) {
          database.createObjectStore(TutorIndexedDbStore.SystemMessages, { keyPath: 'id' });
        }
        if (!database.objectStoreNames.contains(TutorIndexedDbStore.ProactiveSignals)) {
          database.createObjectStore(TutorIndexedDbStore.ProactiveSignals, { keyPath: 'id' });
        }
        const learningAssetStore = database.objectStoreNames.contains(TutorIndexedDbStore.LearningAssets)
          ? request.transaction?.objectStore(TutorIndexedDbStore.LearningAssets)
          : database.createObjectStore(TutorIndexedDbStore.LearningAssets, { keyPath: 'id' });
        if (learningAssetStore && !learningAssetStore.indexNames.contains('by_cycle_kind_purpose_status')) {
          learningAssetStore.createIndex(
            'by_cycle_kind_purpose_status',
            ['examCycleId', 'kind', 'purpose', 'status'],
            { unique: false }
          );
        }
        if (event.oldVersion < 31 && learningAssetStore) {
          migrateLearningAssetPurposes(learningAssetStore, agentRunStore);
        }
        if (!database.objectStoreNames.contains(TutorIndexedDbStore.QuestionSources)) {
          const sourceStore = database.createObjectStore(TutorIndexedDbStore.QuestionSources, { keyPath: 'id' });
          sourceStore.createIndex('by_identity_hash', 'identityHash', { unique: true });
          sourceStore.createIndex('by_content_hash', 'contentHash', { unique: true });
          sourceStore.createIndex('by_status', 'status', { unique: false });
        }
        if (!database.objectStoreNames.contains(TutorIndexedDbStore.QuestionSourceLinks)) {
          const linkStore = database.createObjectStore(TutorIndexedDbStore.QuestionSourceLinks, { keyPath: 'id' });
          linkStore.createIndex('by_question', 'questionId', { unique: false });
          linkStore.createIndex('by_source', 'sourceId', { unique: false });
        }
        if (!database.objectStoreNames.contains(TutorIndexedDbStore.QuestionLineages)) {
          const lineageStore = database.createObjectStore(TutorIndexedDbStore.QuestionLineages, { keyPath: 'id' });
          lineageStore.createIndex('by_question', 'questionId', { unique: true });
          lineageStore.createIndex('by_parent', 'parentQuestionId', { unique: false });
        }
        if (!database.objectStoreNames.contains(TutorIndexedDbStore.QuestionSourceImportReceipts)) {
          const receiptStore = database.createObjectStore(
            TutorIndexedDbStore.QuestionSourceImportReceipts,
            { keyPath: 'id' }
          );
          receiptStore.createIndex('by_idempotency_key', 'idempotencyKey', { unique: true });
          receiptStore.createIndex('by_source', 'sourceId', { unique: false });
        }
        if (!database.objectStoreNames.contains(TutorIndexedDbStore.QuestionImportDrafts)) {
          const draftStore = database.createObjectStore(
            TutorIndexedDbStore.QuestionImportDrafts,
            { keyPath: 'id' }
          );
          draftStore.createIndex('by_idempotency_key', 'idempotencyKey', { unique: true });
          draftStore.createIndex('by_status', ['examCycleId', 'status'], { unique: false });
          draftStore.createIndex('by_owner', 'ownerSessionId', { unique: false });
        }
        if (!database.objectStoreNames.contains(TutorIndexedDbStore.QuestionImportCandidates)) {
          const candidateStore = database.createObjectStore(
            TutorIndexedDbStore.QuestionImportCandidates,
            { keyPath: 'id' }
          );
          candidateStore.createIndex('by_draft', 'draftId', { unique: false });
          candidateStore.createIndex('by_draft_sequence', ['draftId', 'sequence'], { unique: true });
        }
        if (!database.objectStoreNames.contains(TutorIndexedDbStore.QuestionImportPublishReceipts)) {
          const publishReceiptStore = database.createObjectStore(
            TutorIndexedDbStore.QuestionImportPublishReceipts,
            { keyPath: 'id' }
          );
          publishReceiptStore.createIndex('by_draft', 'draftId', { unique: true });
          publishReceiptStore.createIndex('by_idempotency_key', 'idempotencyKey', { unique: true });
        }
        if (!database.objectStoreNames.contains(TutorIndexedDbStore.QuestionReferencePacks)) {
          const referencePackStore = database.createObjectStore(
            TutorIndexedDbStore.QuestionReferencePacks,
            { keyPath: 'id' }
          );
          referencePackStore.createIndex('by_content_hash', 'contentHash', { unique: true });
          referencePackStore.createIndex(
            'by_scope',
            ['examCycleId', 'capabilityNodeId'],
            { unique: false }
          );
        }
        if (!database.objectStoreNames.contains(TutorIndexedDbStore.TutorCycleConclusions)) {
          const tutorCycleStore = database.createObjectStore(
            TutorIndexedDbStore.TutorCycleConclusions,
            { keyPath: 'id' }
          );
          tutorCycleStore.createIndex('by_idempotency_key', 'idempotencyKey', { unique: true });
          tutorCycleStore.createIndex('by_exam_cycle', 'examCycleId', { unique: false });
          tutorCycleStore.createIndex('by_thread', 'learningThreadId', { unique: false });
        }
        if (!database.objectStoreNames.contains(TutorIndexedDbStore.AbilityCalibrationSnapshots)) {
          const calibrationStore = database.createObjectStore(
            TutorIndexedDbStore.AbilityCalibrationSnapshots,
            { keyPath: 'id' }
          );
          calibrationStore.createIndex('by_input_fingerprint', 'inputFingerprint', { unique: true });
          calibrationStore.createIndex('by_exam_cycle', 'examCycleId', { unique: false });
        }
        if (event.oldVersion < 23 && database.objectStoreNames.contains('conversation_sessions')) {
          database.deleteObjectStore('conversation_sessions');
        }
        if (event.oldVersion < 23 && database.objectStoreNames.contains('conversation_messages')) {
          database.deleteObjectStore('conversation_messages');
        }
      };
      request.onsuccess = () => {
        this.database = request.result;
        this.database.onversionchange = () => this.close();
        resolve();
      };
      request.onerror = () => reject(request.error ?? new Error('Tutor IndexedDB failed to open'));
      request.onblocked = () => reject(new Error('Tutor IndexedDB upgrade is blocked by another tab'));
    });
  }

  private requireDatabase(): IDBDatabase {
    if (!this.database) throw new Error('Tutor IndexedDB is not open');
    return this.database;
  }
}

function migrateLearningAssetPurposes(store: IDBObjectStore, agentRunStore?: IDBObjectStore): void {
  if (!agentRunStore) {
    migrateLearningAssetPurposeRecords(store, new Map());
    return;
  }
  const runRequest = agentRunStore.getAll();
  runRequest.onsuccess = () => {
    const sourceByRunId = new Map<string, string>();
    for (const raw of runRequest.result as Array<Record<string, unknown>>) {
      const run = objectValue(raw.run);
      const snapshot = objectValue(run.inputSnapshot);
      if (typeof run.id === 'string' && typeof snapshot.sourceId === 'string') {
        sourceByRunId.set(run.id, snapshot.sourceId);
      }
    }
    migrateLearningAssetPurposeRecords(store, sourceByRunId);
  };
}

function migrateLearningAssetPurposeRecords(store: IDBObjectStore, sourceByRunId: ReadonlyMap<string, string>): void {
  const request = store.openCursor();
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;
    const asset = cursor.value as Record<string, unknown>;
    if (asset.kind === 'essay_question' && !asset.purpose) {
      const payload = objectValue(asset.payload);
      const context = objectValue(payload.essayContext);
      const sourceId = typeof asset.sourceAgentRunId === 'string'
        ? sourceByRunId.get(asset.sourceAgentRunId)
        : undefined;
      cursor.update({ ...asset, purpose: inferLegacyEssayPurpose(context, sourceId) });
    }
    cursor.continue();
  };
}

function inferLegacyEssayPurpose(context: Record<string, unknown>, sourceId?: string): string {
  if (context.purpose === 'mock') return 'mock';
  if (context.purpose === 'true_question' || context.entryMode === 'true') return 'true_question';
  if (context.purpose === 'practice' || context.entryMode === 'tutor') return 'practice';
  if (sourceId?.startsWith('mock:申论:')) return 'mock';
  if (sourceId?.startsWith('essay:')) return 'practice';
  return 'legacy_unknown';
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
