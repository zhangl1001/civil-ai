import { IndexedDbTransactionScope, IndexedDbUnitOfWork } from '@/capabilities/database/adapters/indexeddb/IndexedDbUnitOfWork';
import { TutorIndexedDb } from '@/capabilities/database/adapters/indexeddb/TutorIndexedDb';
import { IndexedDbTutorDataMaintenance } from '@/capabilities/database/adapters/indexeddb/IndexedDbTutorDataMaintenance';
import type {
  TutorDataMaintenance,
  TutorDatabaseLifecycle,
  UnitOfWork
} from '@/capabilities/database/public';
import { IndexedDbCandidateRepository } from '@/modules/candidate/adapters/IndexedDbCandidateRepository';
import { WebAgentWorkspaceStorage } from '@/modules/agent/adapters/WebAgentWorkspaceStorage';
import { ConversationMessageLog, ConversationSessionLog, ConversationStore } from '@/modules/conversation/public';
import {
  AlignCandidateCurriculum,
  candidateOnboardingPolicy,
  CreateCandidateCycle,
  GetCandidateHome,
  UpdateLearningPreferences,
  UpdateScoreTargets,
  type CandidateRepository
} from '@/modules/candidate/public';
import { IndexedDbCurriculumRepository } from '@/modules/curriculum/adapters/IndexedDbCurriculumRepository';
import {
  createBundledNationalCurriculum,
  EnsureCurriculumBundle,
  type CurriculumRepository
} from '@/modules/curriculum/public';
import { IndexedDbOutboxRepository } from '@/modules/task/adapters/IndexedDbOutboxRepository';
import { IndexedDbCommandReceiptRepository } from '@/modules/task/adapters/IndexedDbCommandReceiptRepository';
import type { CommandReceiptRepository, OutboxRepository } from '@/modules/task/public';
import { UuidV7IdGenerator } from '@/capabilities/platform/public';
import type { Clock, CurriculumVersionId } from '@/kernel/public';
import { IndexedDbPromptRepository } from '@/capabilities/ai-runtime/adapters/IndexedDbPromptRepository';
import { IndexedDbAIInvocationRepository } from '@/capabilities/ai-runtime/adapters/IndexedDbAIInvocationRepository';
import {
  businessTutorPromptCatalog,
  EnsurePromptBundle,
  errorDiagnosisBatchPromptV1,
  errorDiagnosisPromptV1,
  PromptCompiler,
  PromptRegistry,
  structuredObjectivePromptV2,
  type AIInvocationRepository,
  type PromptRepository
} from '@/capabilities/ai-runtime/public';
import { IndexedDbContentRepository } from '@/modules/content/adapters/IndexedDbContentRepository';
import { IndexedDbGenerationRepository } from '@/modules/content/adapters/IndexedDbGenerationRepository';
import { IndexedDbLearningAssetRepository } from '@/modules/content/adapters/IndexedDbLearningAssetRepository';
import {
  createBundledContentMetadata,
  CreateGenerationWorkflow,
  EnsureContentMetadata,
  GenerationContextCompiler,
  GetGenerationStatus,
  LearningAssetStore,
  RunStructuredObjectiveGenerationWorkflow,
  type ContentRepository,
  type GenerationRepository,
  type LearningAssetRepository
} from '@/modules/content/public';
import { IndexedDbLearningThreadRepository } from '@/modules/teaching/adapters/IndexedDbLearningThreadRepository';
import { IndexedDbAgentRunRepository } from '@/modules/agent/adapters/IndexedDbAgentRunRepository';
import {
  AgentRunExecutionRegistry,
  CancelAgentRun,
  ClaimAgentRuns,
  CreateAgentRun,
  DefaultAgentToolPolicy,
  FileAgentMemoryRepository,
  GetAgentRunViews,
  InvokeAgentModel,
  RecoverExpiredAgentRuns,
  RunAgentLoop,
  RunTutorAgentBatch,
  SaveAgentLoopCheckpoint,
  TransitionAgentRun,
  UpdateAgentRunProgress,
  type AgentRunRepository,
  type AgentMemoryRepository,
  type AgentRuntimeObserver,
  type AgentToolExecutor
} from '@/modules/agent/public';
import { IndexedDbMessageCenterRepository } from '@/modules/message-center/adapters/IndexedDbMessageCenterRepository';
import {
  MessageCenter,
  type MessageCenterRepository
} from '@/modules/message-center/public';
import { IndexedDbProactiveSignalRepository } from '@/modules/proactive/adapters/IndexedDbProactiveSignalRepository';
import { DeliverProactiveSignals, EvaluateProactiveSignals, type ProactiveSignalRepository } from '@/modules/proactive/public';
import { IndexedDbMasteryRepository } from '@/modules/mastery/adapters/IndexedDbMasteryRepository';
import { createGenerationLearningContextPort } from './createGenerationLearningContextPort';
import { BuildDailyPlanProposal, CompleteReviewQueueItem, FailReviewQueueItem, RefreshMasteryTrack, RetryReviewQueueItem, StartReviewQueueItem, type MasteryRepository } from '@/modules/mastery/public';
import { IndexedDbDailyPlanRepository } from '@/modules/planning/adapters/IndexedDbDailyPlanRepository';
import { DailyPlanRebalanceReason, PersistDailyPlanProposal, RebalanceDailyPlanAfterLearning, UpdateDailyPlanItemStatus, type DailyPlanRepository } from '@/modules/planning/public';
import {
  CreateLearningThread,
  StartStructuredTeaching,
  RequestStructuredPractice,
  TransitionLearningThread,
  type LearningThreadRepository
} from '@/modules/teaching/public';
import {
  IndexedDbErrorDiagnosisRepository,
  IndexedDbLearningEvidenceRepository,
  IndexedDbLearningSessionRepository
} from '@/modules/evidence/adapters/IndexedDbLearningFactRepositories';
import {
  CorrectLearningEvidence,
  ConfirmErrorDiagnosis,
  GetObjectiveSessionReview,
  GetWrongBookEntries,
  CompleteObjectivePractice,
  ObjectiveSubmissionPostProcessor,
  ProcessObjectiveSubmissionOutbox,
  RunAiErrorDiagnosis,
  RequestAiErrorDiagnosis,
  RecordSubjectiveAssessment,
  SubmitObjectiveSession,
  type ErrorDiagnosisRepository,
  type LearningEvidenceRepository,
  type LearningSessionRepository
} from '@/modules/evidence/public';
import { createTutorAgentHandlers } from '../agent/createTutorAgentHandlers';
import { TaskMessageProjector } from '../agent/TaskMessageProjector';

export interface WebTutorDatabaseRuntime {
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
  readonly promptRepository: PromptRepository;
  readonly promptCompiler: PromptCompiler;
  readonly aiInvocationRepository: AIInvocationRepository;
  readonly learningThreadRepository: LearningThreadRepository;
  readonly learningSessionRepository: LearningSessionRepository;
  readonly errorDiagnosisRepository: ErrorDiagnosisRepository;
  readonly learningEvidenceRepository: LearningEvidenceRepository;
  readonly agentRunRepository: AgentRunRepository;
  readonly messageCenterRepository: MessageCenterRepository;
  readonly messageCenter: MessageCenter;
  readonly proactiveSignalRepository: ProactiveSignalRepository;
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
  readonly createGenerationWorkflow: CreateGenerationWorkflow;
  readonly runStructuredObjectiveGenerationWorkflow: RunStructuredObjectiveGenerationWorkflow;
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
  readonly createAgentRun: CreateAgentRun;
  readonly transitionAgentRun: TransitionAgentRun;
  readonly cancelAgentRun: CancelAgentRun;
  readonly claimAgentRuns: ClaimAgentRuns;
  readonly recoverExpiredAgentRuns: RecoverExpiredAgentRuns;
  readonly getAgentRunViews: GetAgentRunViews;
  readonly updateAgentRunProgress: UpdateAgentRunProgress;
  readonly runTutorAgentBatch: RunTutorAgentBatch;
  readonly invokeAgentModel: InvokeAgentModel;
  readonly createAgentLoop: (executor: AgentToolExecutor, observer?: AgentRuntimeObserver) => RunAgentLoop;
  readonly outboxRepository: OutboxRepository;
  readonly commandReceiptRepository: CommandReceiptRepository;
  readonly createCandidateCycle: CreateCandidateCycle;
  readonly getCandidateHome: GetCandidateHome;
  readonly updateLearningPreferences: UpdateLearningPreferences;
  readonly updateScoreTargets: UpdateScoreTargets;
  readonly defaultCurriculumVersionId: CurriculumVersionId;
  initialize(): Promise<void>;
  close(): Promise<void>;
  resetForDevelopment(): Promise<void>;
}

export function createWebTutorDatabase(clock: Clock): WebTutorDatabaseRuntime {
  const database = new TutorIndexedDb();
  const databaseLifecycle: TutorDatabaseLifecycle = {
    waitUntilReady: () => Promise.resolve(),
    healthCheck: () => database.open(),
    recoverAfterInterruption: async () => {
      database.close();
      await database.open();
    }
  };
  const transactionScope = new IndexedDbTransactionScope();
  const unitOfWork = new IndexedDbUnitOfWork(database, transactionScope);
  const dataMaintenance = new IndexedDbTutorDataMaintenance(database, transactionScope);
  const candidateRepository = new IndexedDbCandidateRepository(database, transactionScope);
  const agentWorkspaceStorage = new WebAgentWorkspaceStorage();
  const agentMemoryRepository = new FileAgentMemoryRepository(agentWorkspaceStorage);
  const conversationStore = new ConversationStore(
    new ConversationSessionLog(agentWorkspaceStorage),
    new ConversationMessageLog(agentWorkspaceStorage),
    clock,
    new UuidV7IdGenerator(clock),
    agentMemoryRepository
  );
  const curriculumRepository = new IndexedDbCurriculumRepository(database, transactionScope);
  const contentRepository = new IndexedDbContentRepository(database, transactionScope);
  const generationRepository = new IndexedDbGenerationRepository(database, transactionScope);
  const learningAssetRepository = new IndexedDbLearningAssetRepository(database, transactionScope);
  const learningAssetStore = new LearningAssetStore(
    unitOfWork,
    learningAssetRepository,
    clock,
    new UuidV7IdGenerator(clock)
  );
  const promptRepository = new IndexedDbPromptRepository(database, transactionScope);
  const aiInvocationRepository = new IndexedDbAIInvocationRepository(database, transactionScope);
  const learningThreadRepository = new IndexedDbLearningThreadRepository(database, transactionScope);
  const learningSessionRepository = new IndexedDbLearningSessionRepository(database, transactionScope);
  const errorDiagnosisRepository = new IndexedDbErrorDiagnosisRepository(database, transactionScope);
  const learningEvidenceRepository = new IndexedDbLearningEvidenceRepository(database, transactionScope);
  const agentRunRepository = new IndexedDbAgentRunRepository(database, transactionScope);
  const messageCenterRepository = new IndexedDbMessageCenterRepository(database, transactionScope);
  const proactiveSignalRepository = new IndexedDbProactiveSignalRepository(database, transactionScope);
  const messageCenter = new MessageCenter(
    unitOfWork,
    messageCenterRepository,
    clock,
    new UuidV7IdGenerator(clock)
  );
  const masteryRepository = new IndexedDbMasteryRepository(database, transactionScope);
  const dailyPlanRepository = new IndexedDbDailyPlanRepository(database, transactionScope);
  const evaluateProactiveSignals = new EvaluateProactiveSignals(unitOfWork,candidateRepository,dailyPlanRepository,masteryRepository,proactiveSignalRepository,clock,new UuidV7IdGenerator(clock));
  const deliverProactiveSignals = new DeliverProactiveSignals(unitOfWork,proactiveSignalRepository,messageCenter,clock);
  const outboxRepository = new IndexedDbOutboxRepository(database, transactionScope);
  const commandReceiptRepository = new IndexedDbCommandReceiptRepository(database, transactionScope);
  const ensureCurriculum = new EnsureCurriculumBundle(unitOfWork, curriculumRepository);
  const bundledCurriculum = createBundledNationalCurriculum();
  const ensureContentMetadata = new EnsureContentMetadata(unitOfWork, contentRepository);
  const bundledContentMetadata = createBundledContentMetadata();
  const ensurePromptBundle = new EnsurePromptBundle(unitOfWork, promptRepository);
  const promptRegistry = new PromptRegistry();
  promptRegistry.register(structuredObjectivePromptV2);
  promptRegistry.register(errorDiagnosisPromptV1);
  promptRegistry.register(errorDiagnosisBatchPromptV1);
  businessTutorPromptCatalog.forEach((bundle) => promptRegistry.register(bundle));
  const promptCompiler = new PromptCompiler(promptRegistry);
  const generationContextCompiler = new GenerationContextCompiler(
    candidateRepository,
    curriculumRepository,
    createGenerationLearningContextPort(masteryRepository, learningSessionRepository, errorDiagnosisRepository)
  );
  const createGenerationWorkflow = new CreateGenerationWorkflow(
    unitOfWork,
    generationRepository,
    contentRepository,
    outboxRepository,
    generationContextCompiler,
    structuredObjectivePromptV2.versionId,
    clock,
    new UuidV7IdGenerator(clock)
  );
  const runStructuredObjectiveGenerationWorkflow = new RunStructuredObjectiveGenerationWorkflow(
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
  const startStructuredTeaching = new StartStructuredTeaching(candidateRepository,curriculumRepository,createLearningThread);
  const requestStructuredPractice = new RequestStructuredPractice(startStructuredTeaching,createGenerationWorkflow);
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
  const agentRunExecutions = new AgentRunExecutionRegistry();
  const taskMessageProjector = new TaskMessageProjector(messageCenter, agentRunRepository);
  const cancelAgentRun = new CancelAgentRun(transitionAgentRun, agentRunExecutions, taskMessageProjector);
  const claimAgentRuns = new ClaimAgentRuns(agentRunRepository, clock, new UuidV7IdGenerator(clock));
  const recoverExpiredAgentRuns = new RecoverExpiredAgentRuns(agentRunRepository, clock, new UuidV7IdGenerator(clock));
  const getAgentRunViews = new GetAgentRunViews(agentRunRepository);
  const updateAgentRunProgress = new UpdateAgentRunProgress(unitOfWork, agentRunRepository, outboxRepository, clock, new UuidV7IdGenerator(clock));
  const invokeAgentModel = new InvokeAgentModel(unitOfWork, agentRunRepository, clock, new UuidV7IdGenerator(clock));
  const saveAgentLoopCheckpoint = new SaveAgentLoopCheckpoint(unitOfWork, agentRunRepository, clock, new UuidV7IdGenerator(clock));
  const defaultAgentToolPolicy = new DefaultAgentToolPolicy();
  const createAgentLoop = (executor: AgentToolExecutor, observer?: AgentRuntimeObserver) => (
    new RunAgentLoop(invokeAgentModel, defaultAgentToolPolicy, executor, saveAgentLoopCheckpoint, observer)
  );
  const runAiErrorDiagnosis = new RunAiErrorDiagnosis(unitOfWork,errorDiagnosisRepository,outboxRepository,promptCompiler,invokeAgentModel,transitionAgentRun,clock,new UuidV7IdGenerator(clock));
  const requestAiErrorDiagnosis = new RequestAiErrorDiagnosis(errorDiagnosisRepository,createAgentRun);
  const refreshMasteryTrack = new RefreshMasteryTrack(
    unitOfWork, masteryRepository, learningEvidenceRepository, clock, new UuidV7IdGenerator(clock)
  );
  const recordSubjectiveAssessment = new RecordSubjectiveAssessment(
    unitOfWork,
    learningEvidenceRepository,
    refreshMasteryTrack,
    clock,
    new UuidV7IdGenerator(clock)
  );
  const startReviewQueueItem = new StartReviewQueueItem(unitOfWork, masteryRepository, clock);
  const completeReviewQueueItem = new CompleteReviewQueueItem(unitOfWork, masteryRepository, clock);
  const failReviewQueueItem = new FailReviewQueueItem(unitOfWork, masteryRepository, clock);
  const retryReviewQueueItem = new RetryReviewQueueItem(unitOfWork, masteryRepository, clock);
  const buildDailyPlanProposal = new BuildDailyPlanProposal(masteryRepository, clock);
  const persistDailyPlanProposal = new PersistDailyPlanProposal(unitOfWork, dailyPlanRepository, clock, new UuidV7IdGenerator(clock));
  const updateDailyPlanItemStatus = new UpdateDailyPlanItemStatus(unitOfWork, dailyPlanRepository, clock);
  const rebalanceDailyPlanAfterLearning = new RebalanceDailyPlanAfterLearning(candidateRepository,dailyPlanRepository,buildDailyPlanProposal,persistDailyPlanProposal,clock);
  const runTutorAgentBatch = new RunTutorAgentBatch(
    claimAgentRuns,
    recoverExpiredAgentRuns,
    transitionAgentRun,
    clock,
    createTutorAgentHandlers({
      candidates: candidateRepository,
      curriculums: curriculumRepository,
      diagnoses: errorDiagnosisRepository,
      runErrorDiagnosis: runAiErrorDiagnosis,
      promptCompiler,
      transitionAgentRun,
      updateAgentRunProgress,
      invokeAgentModel,
      requestStructuredPractice,
      runStructuredObjectiveGenerationWorkflow,
      learningAssetStore,
      updateDailyPlanItemStatus,
      masteryRepository,
      startReviewQueueItem,
      retryReviewQueueItem,
      failReviewQueueItem,
      recordSubjectiveAssessment
    }),
    agentRunExecutions,
    taskMessageProjector
  );
  const proactiveTutorRefresh = { execute: async (examCycleId:string) => {
    await evaluateProactiveSignals.execute(examCycleId as Parameters<EvaluateProactiveSignals['execute']>[0]);
    return deliverProactiveSignals.execute(examCycleId as Parameters<DeliverProactiveSignals['execute']>[0]);
  } };
  const dailyPlanRebalancePort = { execute: (command:{examCycleId:Parameters<RebalanceDailyPlanAfterLearning['execute']>[0]['examCycleId'];sourceId:string}) => (
    rebalanceDailyPlanAfterLearning.execute({...command,reason:DailyPlanRebalanceReason.LearningResult})
  ) };
  const objectiveSubmissionPostProcessor = new ObjectiveSubmissionPostProcessor(
    getObjectiveSessionReview,
    requestAiErrorDiagnosis,
    refreshMasteryTrack,
    completeReviewQueueItem,
    updateDailyPlanItemStatus,
    dailyPlanRebalancePort,
    proactiveTutorRefresh
  );
  const completeObjectivePractice = new CompleteObjectivePractice(
    submitObjectiveSession,
    objectiveSubmissionPostProcessor
  );
  const processObjectiveSubmissionOutbox = new ProcessObjectiveSubmissionOutbox(
    outboxRepository,
    objectiveSubmissionPostProcessor,
    clock
  );
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
  const getCandidateHome = new GetCandidateHome(candidateRepository, {
    list: async (examCycleId) => masteryRepository.listTracks(examCycleId, 100)
  });
  const updateLearningPreferences = new UpdateLearningPreferences(unitOfWork,candidateRepository,clock);
  const alignCandidateCurriculum = new AlignCandidateCurriculum(unitOfWork, candidateRepository, clock);
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
    dataMaintenance,
    databaseLifecycle,
    candidateRepository,
    conversationStore,
    agentMemoryRepository,
    curriculumRepository,
    contentRepository,
    generationRepository,
    learningAssetRepository,
    learningAssetStore,
    promptRepository,
    promptCompiler,
    aiInvocationRepository,
    learningThreadRepository,
    learningSessionRepository,
    errorDiagnosisRepository,
    learningEvidenceRepository,
    agentRunRepository,
    messageCenterRepository,
    messageCenter,
    proactiveSignalRepository,
    evaluateProactiveSignals,
    deliverProactiveSignals,
    masteryRepository,
    dailyPlanRepository,
    refreshMasteryTrack,
    startReviewQueueItem,
    completeReviewQueueItem,
    failReviewQueueItem,
    retryReviewQueueItem,
    buildDailyPlanProposal,
    persistDailyPlanProposal,
    rebalanceDailyPlanAfterLearning,
    updateDailyPlanItemStatus,
    createGenerationWorkflow,
    runStructuredObjectiveGenerationWorkflow,
    getGenerationStatus,
    createLearningThread,
    transitionLearningThread,
    startStructuredTeaching,
    requestStructuredPractice,
    submitObjectiveSession,
    correctLearningEvidence,
    confirmErrorDiagnosis,
    getObjectiveSessionReview,
    getWrongBookEntries,
    runAiErrorDiagnosis,
    requestAiErrorDiagnosis,
    completeObjectivePractice,
    processObjectiveSubmissionOutbox,
    recordSubjectiveAssessment,
    createAgentRun,
    transitionAgentRun,
    cancelAgentRun,
    claimAgentRuns,
    recoverExpiredAgentRuns,
    getAgentRunViews,
    updateAgentRunProgress,
    runTutorAgentBatch,
    invokeAgentModel,
    createAgentLoop,
    outboxRepository,
    commandReceiptRepository,
    createCandidateCycle,
    getCandidateHome,
    updateLearningPreferences,
    updateScoreTargets,
    defaultCurriculumVersionId: bundledCurriculum.curriculum.id,
    initialize: async () => {
      await database.open();
      await ensureCurriculum.execute(bundledCurriculum);
      await alignCandidateCurriculum.execute(bundledCurriculum);
      await ensureContentMetadata.execute(bundledContentMetadata);
      await ensurePromptBundle.execute(structuredObjectivePromptV2);
      await ensurePromptBundle.execute(errorDiagnosisPromptV1);
      await ensurePromptBundle.execute(errorDiagnosisBatchPromptV1);
      for (const bundle of businessTutorPromptCatalog) {
        await ensurePromptBundle.execute(bundle);
      }
      await recoverExpiredAgentRuns.execute();
    },
    close: async () => database.close(),
    resetForDevelopment: () => {
      if (!import.meta.env.DEV) return Promise.reject(new Error('Database reset is disabled in production'));
      return database.resetForDevelopment();
    }
  };
}
