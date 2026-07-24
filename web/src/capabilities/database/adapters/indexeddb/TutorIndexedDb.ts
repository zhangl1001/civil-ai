import { TUTOR_DATABASE_NAME } from '../../config/TutorDatabaseConfig';

export const TUTOR_INDEXEDDB_NAME = `${TUTOR_DATABASE_NAME}-web`;
export const TUTOR_INDEXEDDB_VERSION = 15;

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
  MasteryTracks: 'mastery_tracks',
  MasterySnapshots: 'mastery_snapshots',
  ReviewQueue: 'review_queue',
  DailyPlanAggregates: 'daily_plan_aggregates',
  LearningEvidenceAggregates: 'learning_evidence_aggregates'
} as const;

export type TutorIndexedDbStore = typeof TutorIndexedDbStore[keyof typeof TutorIndexedDbStore];

export interface IndexedDbWriteOperation {
  readonly type: 'add' | 'put' | 'delete';
  readonly store: TutorIndexedDbStore;
  readonly value?: unknown;
  readonly key?: string;
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

  private openDatabase(): Promise<void> {
    if (!globalThis.indexedDB) return Promise.reject(new Error('IndexedDB is not available in this environment'));
    return new Promise((resolve, reject) => {
      const request = globalThis.indexedDB.open(TUTOR_INDEXEDDB_NAME, TUTOR_INDEXEDDB_VERSION);
      request.onupgradeneeded = () => {
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
        if (!database.objectStoreNames.contains(TutorIndexedDbStore.MasteryTracks)) database.createObjectStore(TutorIndexedDbStore.MasteryTracks, { keyPath: 'id' });
        if (!database.objectStoreNames.contains(TutorIndexedDbStore.MasterySnapshots)) database.createObjectStore(TutorIndexedDbStore.MasterySnapshots, { keyPath: 'id' });
        if (!database.objectStoreNames.contains(TutorIndexedDbStore.ReviewQueue)) database.createObjectStore(TutorIndexedDbStore.ReviewQueue, { keyPath: 'id' });
        if (!database.objectStoreNames.contains(TutorIndexedDbStore.DailyPlanAggregates)) database.createObjectStore(TutorIndexedDbStore.DailyPlanAggregates, { keyPath: 'plan.id' });
        if (!database.objectStoreNames.contains(TutorIndexedDbStore.LearningEvidenceAggregates)) {
          database.createObjectStore(TutorIndexedDbStore.LearningEvidenceAggregates, { keyPath: 'evidenceId' });
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
