import type {
  AIInvocationRepository,
  PromptCompiler,
  PromptRepository
} from '@/capabilities/ai-runtime/public';
import type {
  TutorDataMaintenance,
  TutorDatabaseLifecycle,
  UnitOfWork
} from '@/capabilities/database/public';
import type {
  AgentMemoryRepository,
  AgentRunExecutionRegistry,
  AgentRunRepository,
  AgentRuntimeObserver,
  AgentToolReceiptRepository,
  AgentToolExecutor,
  CancelAgentRun,
  ClaimAgentRuns,
  CreateAgentRun,
  GetAgentRunViews,
  InvokeAgentModel,
  RecoverExpiredAgentRuns,
  AgentLoopRuntime,
  RunTutorAgentBatch,
  TransitionAgentRun,
  UpdateAgentRunProgress
} from '@/modules/agent/public';
import type {
  CandidateRepository,
  CreateCandidateCycle,
  GetCandidateHome,
  UpdateLearningPreferences,
  UpdateScoreTargets
} from '@/modules/candidate/public';
import type {
  ArchiveQuestionSource,
  ApplyQuestionSetEnrichment,
  ConfirmQuestionImportDraft,
  ContentRepository,
  CreateGenerationWorkflow,
  GenerationRepository,
  GetGenerationStatus,
  ImportQuestionSource,
  LearningAssetRepository,
  LearningAssetStore,
  PublishQuestionImportDraft,
  QuestionImportDraftRepository,
  QuestionReferencePackRepository,
  QuestionSourceRepository,
  RetireQuestionSet,
  RunStructuredObjectiveGenerationWorkflow,
  ScanQuestionImportDraft
} from '@/modules/content/public';
import type { ConversationStore } from '@/modules/conversation/public';
import type { BundledCurriculumPack, CurriculumRepository } from '@/modules/curriculum/public';
import type {
  CompleteObjectivePractice,
  ConfirmErrorDiagnosis,
  CorrectLearningEvidence,
  ErrorDiagnosisRepository,
  GetObjectiveSessionReview,
  GetWrongBookEntries,
  LearningEvidenceRepository,
  LearningSessionRepository,
  ProcessObjectiveSubmissionOutbox,
  RecordSubjectiveAssessment,
  RequestAiErrorDiagnosis,
  RunAiErrorDiagnosis,
  SubmitObjectiveSession
} from '@/modules/evidence/public';
import type {
  CompleteReviewQueueItem,
  FailReviewQueueItem,
  MasteryRepository,
  RefreshMasteryTrack,
  RetryReviewQueueItem,
  StartReviewQueueItem
} from '@/modules/mastery/public';
import type { MessageCenter, MessageCenterRepository } from '@/modules/message-center/public';
import type {
  BuildDailyPlanProposal,
  CompleteDailyPlanItem,
  DailyPlanRepository,
  PersistDailyPlanProposal,
  RebalanceDailyPlanAfterLearning,
  UpdateDailyPlanItemStatus
} from '@/modules/planning/public';
import type {
  DeliverProactiveSignals,
  EvaluateProactiveSignals,
  ProactiveSignalRepository
} from '@/modules/proactive/public';
import type {
  LearningProgressRepository,
  TrackLearningProgress
} from '@/modules/learning-progress/public';
import type {
  CreateLearningThread,
  LearningThreadRepository,
  RequestStructuredPractice,
  StartStructuredTeaching,
  TransitionLearningThread
} from '@/modules/teaching/public';
import type { CommandReceiptRepository, OutboxRepository } from '@/modules/task/public';
import type {
  BuildLearnerPrioritySnapshot,
  BuildTutorDailyContext,
  TutorCycleRepository
} from '@/modules/tutoring/public';
import type {
  AbilityCalibrationRepository,
  BuildAbilityCalibration
} from '@/modules/calibration/public';
import type { EnsureQuestionSetEnrichment } from '../agent/EnsureQuestionSetEnrichment';

/** Platform-neutral application runtime. Platform files may only supply adapters and lifecycle. */
export interface TutorDatabaseRuntime {
  readonly unitOfWork: UnitOfWork;
  readonly dataMaintenance: TutorDataMaintenance;
  readonly databaseLifecycle: TutorDatabaseLifecycle;
  readonly candidateRepository: CandidateRepository;
  readonly conversationStore: ConversationStore;
  readonly agentMemoryRepository: AgentMemoryRepository;
  readonly curriculumRepository: CurriculumRepository;
  readonly contentRepository: ContentRepository;
  readonly generationRepository: GenerationRepository;
  readonly learningAssetRepository: LearningAssetRepository;
  readonly learningAssetStore: LearningAssetStore;
  readonly questionSourceRepository: QuestionSourceRepository;
  readonly questionReferencePackRepository: QuestionReferencePackRepository;
  readonly tutorCycleRepository: TutorCycleRepository;
  readonly abilityCalibrationRepository: AbilityCalibrationRepository;
  readonly questionImportDraftRepository: QuestionImportDraftRepository;
  readonly importQuestionSource: ImportQuestionSource;
  readonly archiveQuestionSource: ArchiveQuestionSource;
  readonly scanQuestionImportDraft: ScanQuestionImportDraft;
  readonly confirmQuestionImportDraft: ConfirmQuestionImportDraft;
  readonly publishQuestionImportDraft: PublishQuestionImportDraft;
  readonly promptRepository: PromptRepository;
  readonly promptCompiler: PromptCompiler;
  readonly aiInvocationRepository: AIInvocationRepository;
  readonly learningThreadRepository: LearningThreadRepository;
  readonly learningSessionRepository: LearningSessionRepository;
  readonly errorDiagnosisRepository: ErrorDiagnosisRepository;
  readonly learningEvidenceRepository: LearningEvidenceRepository;
  readonly agentRunRepository: AgentRunRepository;
  readonly agentToolReceiptRepository: AgentToolReceiptRepository;
  readonly messageCenterRepository: MessageCenterRepository;
  readonly messageCenter: MessageCenter;
  readonly proactiveSignalRepository: ProactiveSignalRepository;
  readonly learningProgressRepository: LearningProgressRepository;
  readonly trackLearningProgress: TrackLearningProgress;
  readonly evaluateProactiveSignals: EvaluateProactiveSignals;
  readonly deliverProactiveSignals: DeliverProactiveSignals;
  readonly masteryRepository: MasteryRepository;
  readonly dailyPlanRepository: DailyPlanRepository;
  readonly refreshMasteryTrack: RefreshMasteryTrack;
  readonly startReviewQueueItem: StartReviewQueueItem;
  readonly completeReviewQueueItem: CompleteReviewQueueItem;
  readonly failReviewQueueItem: FailReviewQueueItem;
  readonly retryReviewQueueItem: RetryReviewQueueItem;
  readonly buildDailyPlanProposal: BuildDailyPlanProposal;
  readonly persistDailyPlanProposal: PersistDailyPlanProposal;
  readonly rebalanceDailyPlanAfterLearning: RebalanceDailyPlanAfterLearning;
  readonly updateDailyPlanItemStatus: UpdateDailyPlanItemStatus;
  readonly completeDailyPlanItem: CompleteDailyPlanItem;
  readonly createGenerationWorkflow: CreateGenerationWorkflow;
  readonly runStructuredObjectiveGenerationWorkflow: RunStructuredObjectiveGenerationWorkflow;
  readonly applyQuestionSetEnrichment: ApplyQuestionSetEnrichment;
  readonly retireQuestionSet: RetireQuestionSet;
  readonly ensureQuestionSetEnrichment: EnsureQuestionSetEnrichment;
  readonly getGenerationStatus: GetGenerationStatus;
  readonly createLearningThread: CreateLearningThread;
  readonly transitionLearningThread: TransitionLearningThread;
  readonly startStructuredTeaching: StartStructuredTeaching;
  readonly requestStructuredPractice: RequestStructuredPractice;
  readonly submitObjectiveSession: SubmitObjectiveSession;
  readonly correctLearningEvidence: CorrectLearningEvidence;
  readonly confirmErrorDiagnosis: ConfirmErrorDiagnosis;
  readonly getObjectiveSessionReview: GetObjectiveSessionReview;
  readonly getWrongBookEntries: GetWrongBookEntries;
  readonly runAiErrorDiagnosis: RunAiErrorDiagnosis;
  readonly requestAiErrorDiagnosis: RequestAiErrorDiagnosis;
  readonly completeObjectivePractice: CompleteObjectivePractice;
  readonly processObjectiveSubmissionOutbox: ProcessObjectiveSubmissionOutbox;
  readonly recordSubjectiveAssessment: RecordSubjectiveAssessment;
  readonly buildLearnerPrioritySnapshot: BuildLearnerPrioritySnapshot;
  readonly buildTutorDailyContext: BuildTutorDailyContext;
  readonly buildAbilityCalibration: BuildAbilityCalibration;
  readonly createAgentRun: CreateAgentRun;
  readonly transitionAgentRun: TransitionAgentRun;
  readonly agentRunExecutions: AgentRunExecutionRegistry;
  readonly cancelAgentRun: CancelAgentRun;
  readonly claimAgentRuns: ClaimAgentRuns;
  readonly recoverExpiredAgentRuns: RecoverExpiredAgentRuns;
  readonly getAgentRunViews: GetAgentRunViews;
  readonly updateAgentRunProgress: UpdateAgentRunProgress;
  readonly runTutorAgentBatch: RunTutorAgentBatch;
  readonly invokeAgentModel: InvokeAgentModel;
  readonly createAgentLoop: (executor: AgentToolExecutor, observer?: AgentRuntimeObserver) => AgentLoopRuntime;
  readonly outboxRepository: OutboxRepository;
  readonly commandReceiptRepository: CommandReceiptRepository;
  readonly createCandidateCycle: CreateCandidateCycle;
  readonly getCandidateHome: GetCandidateHome;
  readonly updateLearningPreferences: UpdateLearningPreferences;
  readonly updateScoreTargets: UpdateScoreTargets;
  /** Exam tracks bundled with the app, in the order they are offered. */
  readonly curriculumPacks: readonly BundledCurriculumPack[];
  initialize(): Promise<void>;
  close(): Promise<void>;
  resetForDevelopment(): Promise<void>;
}
