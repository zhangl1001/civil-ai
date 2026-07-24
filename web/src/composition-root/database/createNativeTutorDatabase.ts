import { Capacitor } from '@capacitor/core';
import { CapacitorSqliteDatabase } from '@/capabilities/database/adapters/sqlite/CapacitorSqliteDatabase';
import { SqlTransactionScope, SqlUnitOfWork } from '@/capabilities/database/adapters/sqlite/SqlTransactionScope';
import { tutorDatabaseConfig } from '@/capabilities/database/config/TutorDatabaseConfig';
import { MigrationRunner } from '@/capabilities/database/migrations/MigrationRunner';
import { tutorMigrations } from '@/capabilities/database/migrations/tutorMigrations';
import type { UnitOfWork } from '@/capabilities/database/public';
import type { Clock, CurriculumVersionId } from '@/kernel/public';
import { SqliteCandidateRepository } from '@/modules/candidate/adapters/SqliteCandidateRepository';
import {
  candidateOnboardingPolicy,
  CreateCandidateCycle,
  GetCandidateHome,
  UpdateScoreTargets,
  type CandidateRepository
} from '@/modules/candidate/public';
import { SqliteCurriculumRepository } from '@/modules/curriculum/adapters/SqliteCurriculumRepository';
import {
  createBundledNationalCurriculum,
  EnsureCurriculumBundle,
  type CurriculumRepository
} from '@/modules/curriculum/public';
import { SqliteOutboxRepository } from '@/modules/task/adapters/SqliteOutboxRepository';
import { SqliteCommandReceiptRepository } from '@/modules/task/adapters/SqliteCommandReceiptRepository';
import type { CommandReceiptRepository, OutboxRepository } from '@/modules/task/public';
import { UuidV7IdGenerator } from '@/capabilities/platform/public';
import { SqlitePromptRepository } from '@/capabilities/ai-runtime/adapters/SqlitePromptRepository';
import { SqliteAIInvocationRepository } from '@/capabilities/ai-runtime/adapters/SqliteAIInvocationRepository';
import {
  EnsurePromptBundle,
  errorDiagnosisPromptV1,
  PromptCompiler,
  PromptRegistry,
  weakeningQuestionPromptV1,
  type AIInvocationRepository,
  type PromptRepository
} from '@/capabilities/ai-runtime/public';
import { SqliteContentRepository } from '@/modules/content/adapters/SqliteContentRepository';
import { SqliteGenerationRepository } from '@/modules/content/adapters/SqliteGenerationRepository';
import {
  createBundledContentMetadata,
  CreateGenerationWorkflow,
  EnsureContentMetadata,
  GenerationContextCompiler,
  GetGenerationStatus,
  RunWeakeningGenerationWorkflow,
  type ContentRepository,
  type GenerationRepository
} from '@/modules/content/public';
import { SqliteLearningThreadRepository } from '@/modules/teaching/adapters/SqliteLearningThreadRepository';
import { SqliteAgentRunRepository } from '@/modules/agent/adapters/SqliteAgentRunRepository';
import { CancelAgentRun, ClaimAgentRuns, CreateAgentRun, GetAgentRunViews, InvokeAgentModel, RecoverExpiredAgentRuns, RunTutorAgentBatch, TransitionAgentRun, type AgentRunRepository } from '@/modules/agent/public';
import { SqliteMasteryRepository } from '@/modules/mastery/adapters/SqliteMasteryRepository';
import { BuildDailyPlanProposal, CompleteReviewQueueItem, FailReviewQueueItem, RefreshMasteryTrack, RetryReviewQueueItem, StartReviewQueueItem, type MasteryRepository } from '@/modules/mastery/public';
import { SqliteDailyPlanRepository } from '@/modules/planning/adapters/SqliteDailyPlanRepository';
import { PersistDailyPlanProposal, UpdateDailyPlanItemStatus, type DailyPlanRepository } from '@/modules/planning/public';
import {
  CreateLearningThread,
  StartWeakeningTeaching,
  RequestWeakeningPractice,
  TransitionLearningThread,
  type LearningThreadRepository
} from '@/modules/teaching/public';
import {
  SqliteErrorDiagnosisRepository,
  SqliteLearningEvidenceRepository,
  SqliteLearningSessionRepository
} from '@/modules/evidence/adapters/SqliteLearningFactRepositories';
import {
  CorrectLearningEvidence,
  ConfirmErrorDiagnosis,
  GetObjectiveSessionReview,
  GetWrongBookEntries,
  CompleteObjectivePractice,
  RunAiErrorDiagnosis,
  RequestAiErrorDiagnosis,
  SubmitObjectiveSession,
  type ErrorDiagnosisRepository,
  type LearningEvidenceRepository,
  type LearningSessionRepository
} from '@/modules/evidence/public';
import { createTutorAgentHandlers } from '../agent/createTutorAgentHandlers';

export interface NativeTutorDatabaseRuntime {
  readonly unitOfWork: UnitOfWork;
  readonly candidateRepository: CandidateRepository;
  readonly curriculumRepository: CurriculumRepository;
  readonly contentRepository: ContentRepository;
  readonly generationRepository: GenerationRepository;
  readonly promptRepository: PromptRepository;
  readonly promptCompiler: PromptCompiler;
  readonly aiInvocationRepository: AIInvocationRepository;
  readonly learningThreadRepository: LearningThreadRepository;
  readonly learningSessionRepository: LearningSessionRepository;
  readonly errorDiagnosisRepository: ErrorDiagnosisRepository;
  readonly learningEvidenceRepository: LearningEvidenceRepository;
  readonly agentRunRepository: AgentRunRepository;
  readonly masteryRepository: MasteryRepository;
  readonly dailyPlanRepository: DailyPlanRepository;
  readonly refreshMasteryTrack: RefreshMasteryTrack;
  readonly startReviewQueueItem: StartReviewQueueItem;
  readonly completeReviewQueueItem: CompleteReviewQueueItem;
  readonly failReviewQueueItem: FailReviewQueueItem;
  readonly retryReviewQueueItem: RetryReviewQueueItem;
  readonly buildDailyPlanProposal: BuildDailyPlanProposal;
  readonly persistDailyPlanProposal: PersistDailyPlanProposal;
  readonly updateDailyPlanItemStatus: UpdateDailyPlanItemStatus;
  readonly createGenerationWorkflow: CreateGenerationWorkflow;
  readonly runWeakeningGenerationWorkflow: RunWeakeningGenerationWorkflow;
  readonly getGenerationStatus: GetGenerationStatus;
  readonly createLearningThread: CreateLearningThread;
  readonly transitionLearningThread: TransitionLearningThread;
  readonly startWeakeningTeaching: StartWeakeningTeaching;
  readonly requestWeakeningPractice: RequestWeakeningPractice;
  readonly submitObjectiveSession: SubmitObjectiveSession;
  readonly correctLearningEvidence: CorrectLearningEvidence;
  readonly confirmErrorDiagnosis: ConfirmErrorDiagnosis;
  readonly getObjectiveSessionReview: GetObjectiveSessionReview;
  readonly getWrongBookEntries: GetWrongBookEntries;
  readonly runAiErrorDiagnosis: RunAiErrorDiagnosis;
  readonly requestAiErrorDiagnosis: RequestAiErrorDiagnosis;
  readonly completeObjectivePractice: CompleteObjectivePractice;
  readonly createAgentRun: CreateAgentRun;
  readonly transitionAgentRun: TransitionAgentRun;
  readonly cancelAgentRun: CancelAgentRun;
  readonly claimAgentRuns: ClaimAgentRuns;
  readonly recoverExpiredAgentRuns: RecoverExpiredAgentRuns;
  readonly getAgentRunViews: GetAgentRunViews;
  readonly runTutorAgentBatch: RunTutorAgentBatch;
  readonly invokeAgentModel: InvokeAgentModel;
  readonly outboxRepository: OutboxRepository;
  readonly commandReceiptRepository: CommandReceiptRepository;
  readonly createCandidateCycle: CreateCandidateCycle;
  readonly getCandidateHome: GetCandidateHome;
  readonly updateScoreTargets: UpdateScoreTargets;
  readonly defaultCurriculumVersionId: CurriculumVersionId;
  initialize(): Promise<void>;
  close(): Promise<void>;
  resetForDevelopment(): Promise<void>;
}

export function createNativeTutorDatabase(clock: Clock): NativeTutorDatabaseRuntime | undefined {
  if (!Capacitor.isNativePlatform()) return undefined;

  const database = new CapacitorSqliteDatabase(tutorDatabaseConfig);
  const migrationRunner = new MigrationRunner(database, tutorDatabaseConfig, tutorMigrations);
  const transactionScope = new SqlTransactionScope();
  const unitOfWork = new SqlUnitOfWork(database, transactionScope);
  const candidateRepository = new SqliteCandidateRepository(database, transactionScope);
  const curriculumRepository = new SqliteCurriculumRepository(database, transactionScope);
  const contentRepository = new SqliteContentRepository(database, transactionScope);
  const generationRepository = new SqliteGenerationRepository(database, transactionScope);
  const promptRepository = new SqlitePromptRepository(database, transactionScope);
  const aiInvocationRepository = new SqliteAIInvocationRepository(database, transactionScope);
  const learningThreadRepository = new SqliteLearningThreadRepository(database, transactionScope);
  const learningSessionRepository = new SqliteLearningSessionRepository(database, transactionScope);
  const errorDiagnosisRepository = new SqliteErrorDiagnosisRepository(database, transactionScope);
  const learningEvidenceRepository = new SqliteLearningEvidenceRepository(database, transactionScope);
  const agentRunRepository = new SqliteAgentRunRepository(database, transactionScope);
  const masteryRepository = new SqliteMasteryRepository(database, transactionScope);
  const dailyPlanRepository = new SqliteDailyPlanRepository(database, transactionScope);
  const outboxRepository = new SqliteOutboxRepository(database, transactionScope);
  const commandReceiptRepository = new SqliteCommandReceiptRepository(database, transactionScope);
  const ensureCurriculum = new EnsureCurriculumBundle(unitOfWork, curriculumRepository);
  const bundledCurriculum = createBundledNationalCurriculum();
  const ensureContentMetadata = new EnsureContentMetadata(unitOfWork, contentRepository);
  const bundledContentMetadata = createBundledContentMetadata();
  const ensurePromptBundle = new EnsurePromptBundle(unitOfWork, promptRepository);
  const promptRegistry = new PromptRegistry();
  promptRegistry.register(weakeningQuestionPromptV1);
  promptRegistry.register(errorDiagnosisPromptV1);
  const promptCompiler = new PromptCompiler(promptRegistry);
  const generationContextCompiler = new GenerationContextCompiler(candidateRepository, curriculumRepository);
  const createGenerationWorkflow = new CreateGenerationWorkflow(
    unitOfWork,
    generationRepository,
    contentRepository,
    outboxRepository,
    generationContextCompiler,
    weakeningQuestionPromptV1.versionId,
    clock,
    new UuidV7IdGenerator(clock)
  );
  const runWeakeningGenerationWorkflow = new RunWeakeningGenerationWorkflow(
    unitOfWork,
    generationRepository,
    contentRepository,
    promptRepository,
    aiInvocationRepository,
    outboxRepository,
    promptCompiler,
    clock,
    new UuidV7IdGenerator(clock)
  );
  const getGenerationStatus = new GetGenerationStatus(generationRepository, contentRepository);
  const createLearningThread = new CreateLearningThread(
    unitOfWork,
    learningThreadRepository,
    candidateRepository,
    curriculumRepository,
    outboxRepository,
    clock,
    new UuidV7IdGenerator(clock)
  );
  const transitionLearningThread = new TransitionLearningThread(
    unitOfWork,
    learningThreadRepository,
    outboxRepository,
    clock,
    new UuidV7IdGenerator(clock)
  );
  const startWeakeningTeaching = new StartWeakeningTeaching(candidateRepository,curriculumRepository,createLearningThread);
  const requestWeakeningPractice = new RequestWeakeningPractice(startWeakeningTeaching,createGenerationWorkflow);
  const submitObjectiveSession = new SubmitObjectiveSession(
    unitOfWork,
    contentRepository,
    learningThreadRepository,
    learningSessionRepository,
    errorDiagnosisRepository,
    learningEvidenceRepository,
    outboxRepository,
    clock,
    new UuidV7IdGenerator(clock)
  );
  const correctLearningEvidence = new CorrectLearningEvidence(
    unitOfWork,
    learningEvidenceRepository,
    outboxRepository,
    clock,
    new UuidV7IdGenerator(clock)
  );
  const confirmErrorDiagnosis = new ConfirmErrorDiagnosis(
    unitOfWork,
    errorDiagnosisRepository,
    outboxRepository,
    clock,
    new UuidV7IdGenerator(clock)
  );
  const getObjectiveSessionReview = new GetObjectiveSessionReview(
    learningSessionRepository,
    errorDiagnosisRepository,
    contentRepository
  );
  const getWrongBookEntries = new GetWrongBookEntries(
    learningSessionRepository,
    errorDiagnosisRepository,
    contentRepository
  );
  const createAgentRun = new CreateAgentRun(unitOfWork, agentRunRepository, outboxRepository, clock, new UuidV7IdGenerator(clock));
  const transitionAgentRun = new TransitionAgentRun(unitOfWork, agentRunRepository, outboxRepository, clock, new UuidV7IdGenerator(clock));
  const cancelAgentRun = new CancelAgentRun(transitionAgentRun);
  const claimAgentRuns = new ClaimAgentRuns(agentRunRepository, clock, new UuidV7IdGenerator(clock));
  const recoverExpiredAgentRuns = new RecoverExpiredAgentRuns(agentRunRepository, clock, new UuidV7IdGenerator(clock));
  const getAgentRunViews = new GetAgentRunViews(agentRunRepository);
  const invokeAgentModel = new InvokeAgentModel(unitOfWork, agentRunRepository, clock, new UuidV7IdGenerator(clock));
  const runAiErrorDiagnosis = new RunAiErrorDiagnosis(unitOfWork,errorDiagnosisRepository,outboxRepository,promptCompiler,invokeAgentModel,transitionAgentRun,clock,new UuidV7IdGenerator(clock));
  const requestAiErrorDiagnosis = new RequestAiErrorDiagnosis(errorDiagnosisRepository,createAgentRun);
  const runTutorAgentBatch = new RunTutorAgentBatch(
    claimAgentRuns, recoverExpiredAgentRuns, transitionAgentRun, clock,
    createTutorAgentHandlers(candidateRepository, curriculumRepository, errorDiagnosisRepository, runAiErrorDiagnosis, transitionAgentRun)
  );
  const refreshMasteryTrack = new RefreshMasteryTrack(
    unitOfWork, masteryRepository, learningEvidenceRepository, clock, new UuidV7IdGenerator(clock)
  );
  const startReviewQueueItem = new StartReviewQueueItem(unitOfWork, masteryRepository, clock);
  const completeReviewQueueItem = new CompleteReviewQueueItem(unitOfWork, masteryRepository, clock);
  const failReviewQueueItem = new FailReviewQueueItem(unitOfWork, masteryRepository, clock);
  const retryReviewQueueItem = new RetryReviewQueueItem(unitOfWork, masteryRepository, clock);
  const buildDailyPlanProposal = new BuildDailyPlanProposal(masteryRepository, clock);
  const persistDailyPlanProposal = new PersistDailyPlanProposal(unitOfWork, dailyPlanRepository, clock, new UuidV7IdGenerator(clock));
  const updateDailyPlanItemStatus = new UpdateDailyPlanItemStatus(unitOfWork, dailyPlanRepository);
  const completeObjectivePractice = new CompleteObjectivePractice(submitObjectiveSession,getObjectiveSessionReview,requestAiErrorDiagnosis,refreshMasteryTrack,completeReviewQueueItem,updateDailyPlanItemStatus);
  const createCandidateCycle = new CreateCandidateCycle(
    unitOfWork,
    candidateRepository,
    curriculumRepository,
    outboxRepository,
    commandReceiptRepository,
    clock,
    new UuidV7IdGenerator(clock),
    candidateOnboardingPolicy
  );
  const getCandidateHome = new GetCandidateHome(candidateRepository);
  const updateScoreTargets = new UpdateScoreTargets(
    unitOfWork,
    candidateRepository,
    outboxRepository,
    commandReceiptRepository,
    clock,
    new UuidV7IdGenerator(clock)
  );
  return {
    unitOfWork,
    candidateRepository,
    curriculumRepository,
    contentRepository,
    generationRepository,
    promptRepository,
    promptCompiler,
    aiInvocationRepository,
    learningThreadRepository,
    learningSessionRepository,
    errorDiagnosisRepository,
    learningEvidenceRepository,
    agentRunRepository,
    masteryRepository,
    dailyPlanRepository,
    refreshMasteryTrack,
    startReviewQueueItem,
    completeReviewQueueItem,
    failReviewQueueItem,
    retryReviewQueueItem,
    buildDailyPlanProposal,
    persistDailyPlanProposal,
    updateDailyPlanItemStatus,
    createGenerationWorkflow,
    runWeakeningGenerationWorkflow,
    getGenerationStatus,
    createLearningThread,
    transitionLearningThread,
    startWeakeningTeaching,
    requestWeakeningPractice,
    submitObjectiveSession,
    correctLearningEvidence,
    confirmErrorDiagnosis,
    getObjectiveSessionReview,
    getWrongBookEntries,
    runAiErrorDiagnosis,
    requestAiErrorDiagnosis,
    completeObjectivePractice,
    createAgentRun,
    transitionAgentRun,
    cancelAgentRun,
    claimAgentRuns,
    recoverExpiredAgentRuns,
    getAgentRunViews,
    runTutorAgentBatch,
    invokeAgentModel,
    outboxRepository,
    commandReceiptRepository,
    createCandidateCycle,
    getCandidateHome,
    updateScoreTargets,
    defaultCurriculumVersionId: bundledCurriculum.curriculum.id,
    initialize: async () => {
      await migrationRunner.migrate(clock.now());
      await ensureCurriculum.execute(bundledCurriculum);
      await ensureContentMetadata.execute(bundledContentMetadata);
      await ensurePromptBundle.execute(weakeningQuestionPromptV1);
      await ensurePromptBundle.execute(errorDiagnosisPromptV1);
      await recoverExpiredAgentRuns.execute();
    },
    close: () => database.close(),
    resetForDevelopment: () => {
      if (!import.meta.env.DEV) return Promise.reject(new Error('Database reset is disabled in production'));
      return database.resetForDevelopment();
    }
  };
}
