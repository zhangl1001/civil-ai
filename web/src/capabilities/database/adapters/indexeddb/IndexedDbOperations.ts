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
  LearningProgress: 'learning_progress',
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
  readonly type: 'add' | 'put' | 'delete' | 'update' | 'check';
  readonly store: TutorIndexedDbStore;
  readonly value?: unknown;
  readonly key?: IDBValidKey;
  /** Synchronous commit-time mutation of a row, not a value read while staging. */
  readonly update?: (current: unknown) => unknown;
  /** Commit-time constraint evaluated before subsequent writes in this batch. */
  readonly check?: (current: readonly unknown[]) => void;
}
