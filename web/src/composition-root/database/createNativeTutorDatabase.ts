import { Capacitor } from '@capacitor/core';
import { CapacitorSqliteDatabase } from '@/capabilities/database/adapters/sqlite/CapacitorSqliteDatabase';
import { SqliteTutorDataMaintenance } from '@/capabilities/database/adapters/sqlite/SqliteTutorDataMaintenance';
import { SqlTransactionScope, SqlUnitOfWork } from '@/capabilities/database/adapters/sqlite/SqlTransactionScope';
import { tutorDatabaseConfig } from '@/capabilities/database/config/TutorDatabaseConfig';
import { MigrationRunner } from '@/capabilities/database/migrations/MigrationRunner';
import { tutorMigrations } from '@/capabilities/database/migrations/tutorMigrations';
import type { Clock } from '@/kernel/public';
import { SqliteCandidateRepository } from '@/modules/candidate/adapters/SqliteCandidateRepository';
import { NativeAgentWorkspaceStorage } from '@/modules/agent/adapters/NativeAgentWorkspaceStorage';
import { ConversationMessageLog, ConversationSessionLog, ConversationStore } from '@/modules/conversation/public';
import {
  AlignCandidateCurriculum,
  candidateOnboardingPolicy,
  CreateCandidateCycle,
  GetCandidateHome,
  UpdateLearningPreferences,
  UpdateScoreTargets
} from '@/modules/candidate/public';
import { SqliteCurriculumRepository } from '@/modules/curriculum/adapters/SqliteCurriculumRepository';
import {
  createBundledNationalCurriculum,
  EnsureCurriculumBundle
} from '@/modules/curriculum/public';
import { SqliteOutboxRepository } from '@/modules/task/adapters/SqliteOutboxRepository';
import { SqliteCommandReceiptRepository } from '@/modules/task/adapters/SqliteCommandReceiptRepository';
import { UuidV7IdGenerator } from '@/capabilities/platform/public';
import { SqlitePromptRepository } from '@/capabilities/ai-runtime/adapters/SqlitePromptRepository';
import { SqliteAIInvocationRepository } from '@/capabilities/ai-runtime/adapters/SqliteAIInvocationRepository';
import {
  businessTutorPromptCatalog,
  EnsurePromptBundle,
  errorDiagnosisBatchPromptV1,
  errorDiagnosisPromptV1,
  PromptCompiler,
  PromptRegistry,
  questionImportPolicyV1,
  structuredObjectivePromptV2
} from '@/capabilities/ai-runtime/public';
import { SqliteContentRepository } from '@/modules/content/adapters/SqliteContentRepository';
import { SqliteGenerationRepository } from '@/modules/content/adapters/SqliteGenerationRepository';
import { SqliteLearningAssetRepository } from '@/modules/content/adapters/SqliteLearningAssetRepository';
import { SqliteQuestionSourceRepository } from '@/modules/content/adapters/SqliteQuestionSourceRepository';
import { SqliteQuestionImportDraftRepository } from '@/modules/content/adapters/SqliteQuestionImportDraftRepository';
import { SqliteQuestionReferencePackRepository } from '@/modules/content/adapters/SqliteQuestionReferencePackRepository';
import {
  ArchiveQuestionSource,
  BuildTrueQuestionReferencePack,
  ConfirmQuestionImportDraft,
  createBundledContentMetadata,
  CreateGenerationWorkflow,
  EnsureContentMetadata,
  GenerationContextCompiler,
  GetGenerationStatus,
  ImportQuestionSource,
  LearningAssetStore,
  PublishQuestionImportDraft,
  RunStructuredObjectiveGenerationWorkflow,
  ScanQuestionImportDraft
} from '@/modules/content/public';
import { SqliteLearningThreadRepository } from '@/modules/teaching/adapters/SqliteLearningThreadRepository';
import { SqliteAgentRunRepository } from '@/modules/agent/adapters/SqliteAgentRunRepository';
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
  type AgentRuntimeObserver,
  type AgentToolExecutor
} from '@/modules/agent/public';
import { SqliteMessageCenterRepository } from '@/modules/message-center/adapters/SqliteMessageCenterRepository';
import { MessageCenter } from '@/modules/message-center/public';
import { SqliteProactiveSignalRepository } from '@/modules/proactive/adapters/SqliteProactiveSignalRepository';
import { DeliverProactiveSignals, EvaluateProactiveSignals } from '@/modules/proactive/public';
import { SqliteMasteryRepository } from '@/modules/mastery/adapters/SqliteMasteryRepository';
import { createGenerationLearningContextPort } from './createGenerationLearningContextPort';
import { BuildDailyPlanProposal, CompleteReviewQueueItem, FailReviewQueueItem, RefreshMasteryTrack, RetryReviewQueueItem, StartReviewQueueItem } from '@/modules/mastery/public';
import { SqliteDailyPlanRepository } from '@/modules/planning/adapters/SqliteDailyPlanRepository';
import { DailyPlanRebalanceReason, PersistDailyPlanProposal, RebalanceDailyPlanAfterLearning, UpdateDailyPlanItemStatus } from '@/modules/planning/public';
import {
  CreateLearningThread,
  StartStructuredTeaching,
  RequestStructuredPractice,
  TransitionLearningThread
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
  ObjectiveSubmissionPostProcessor,
  ProcessObjectiveSubmissionOutbox,
  RunAiErrorDiagnosis,
  RequestAiErrorDiagnosis,
  RecordSubjectiveAssessment,
  SubmitObjectiveSession
} from '@/modules/evidence/public';
import { createTutorAgentHandlers } from '../agent/createTutorAgentHandlers';
import { TaskMessageProjector } from '../agent/TaskMessageProjector';
import { SqliteTutorCycleRepository } from '@/modules/tutoring/adapters/SqliteTutorCycleRepository';
import { SqliteAbilityCalibrationRepository } from '@/modules/calibration/adapters/SqliteAbilityCalibrationRepository';
import { BuildAbilityCalibration } from '@/modules/calibration/public';
import {
  BuildTutorDailyContext,
  FinalizeObjectiveTutorConclusion,
  RecordObjectiveTutorConclusion
} from '@/modules/tutoring/public';
import type { TutorDatabaseRuntime } from './TutorDatabaseRuntime';

export type NativeTutorDatabaseRuntime = TutorDatabaseRuntime;

export function createNativeTutorDatabase(clock: Clock): NativeTutorDatabaseRuntime | undefined {
  if (!Capacitor.isNativePlatform()) return undefined;

  const database = new CapacitorSqliteDatabase(tutorDatabaseConfig);
  const migrationRunner = new MigrationRunner(database, tutorDatabaseConfig, tutorMigrations);
  const transactionScope = new SqlTransactionScope();
  const unitOfWork = new SqlUnitOfWork(database, transactionScope);
  const dataMaintenance = new SqliteTutorDataMaintenance(database, transactionScope);
  const candidateRepository = new SqliteCandidateRepository(database, transactionScope);
  const agentWorkspaceStorage = new NativeAgentWorkspaceStorage();
  const agentMemoryRepository = new FileAgentMemoryRepository(agentWorkspaceStorage);
  const conversationStore = new ConversationStore(
    new ConversationSessionLog(agentWorkspaceStorage),
    new ConversationMessageLog(agentWorkspaceStorage),
    clock,
    new UuidV7IdGenerator(clock),
    agentMemoryRepository
  );
  const curriculumRepository = new SqliteCurriculumRepository(database, transactionScope);
  const contentRepository = new SqliteContentRepository(database, transactionScope);
  const generationRepository = new SqliteGenerationRepository(database, transactionScope);
  const learningAssetRepository = new SqliteLearningAssetRepository(database, transactionScope);
  const questionSourceRepository = new SqliteQuestionSourceRepository(database, transactionScope);
  const questionReferencePackRepository = new SqliteQuestionReferencePackRepository(database, transactionScope);
  const tutorCycleRepository = new SqliteTutorCycleRepository(database, transactionScope);
  const abilityCalibrationRepository = new SqliteAbilityCalibrationRepository(database, transactionScope);
  const questionImportDraftRepository = new SqliteQuestionImportDraftRepository(database, transactionScope);
  const importQuestionSource = new ImportQuestionSource(
    unitOfWork,
    questionSourceRepository,
    clock,
    new UuidV7IdGenerator(clock)
  );
  const archiveQuestionSource = new ArchiveQuestionSource(unitOfWork, questionSourceRepository, clock);
  const scanQuestionImportDraft = new ScanQuestionImportDraft(
    unitOfWork,
    questionImportDraftRepository,
    clock,
    new UuidV7IdGenerator(clock)
  );
  const confirmQuestionImportDraft = new ConfirmQuestionImportDraft(
    unitOfWork,
    questionImportDraftRepository,
    clock,
    new UuidV7IdGenerator(clock)
  );
  const publishQuestionImportDraft = new PublishQuestionImportDraft(
    unitOfWork,
    questionImportDraftRepository,
    generationRepository,
    contentRepository,
    questionSourceRepository,
    clock,
    new UuidV7IdGenerator(clock)
  );
  const learningAssetStore = new LearningAssetStore(
    unitOfWork,
    learningAssetRepository,
    clock,
    new UuidV7IdGenerator(clock)
  );
  const promptRepository = new SqlitePromptRepository(database, transactionScope);
  const aiInvocationRepository = new SqliteAIInvocationRepository(database, transactionScope);
  const learningThreadRepository = new SqliteLearningThreadRepository(database, transactionScope);
  const learningSessionRepository = new SqliteLearningSessionRepository(database, transactionScope);
  const errorDiagnosisRepository = new SqliteErrorDiagnosisRepository(database, transactionScope);
  const learningEvidenceRepository = new SqliteLearningEvidenceRepository(database, transactionScope);
  const agentRunRepository = new SqliteAgentRunRepository(database, transactionScope);
  const messageCenterRepository = new SqliteMessageCenterRepository(database, transactionScope);
  const proactiveSignalRepository = new SqliteProactiveSignalRepository(database, transactionScope);
  const messageCenter = new MessageCenter(
    unitOfWork,
    messageCenterRepository,
    clock,
    new UuidV7IdGenerator(clock)
  );
  const masteryRepository = new SqliteMasteryRepository(database, transactionScope);
  const dailyPlanRepository = new SqliteDailyPlanRepository(database, transactionScope);
  const evaluateProactiveSignals = new EvaluateProactiveSignals(unitOfWork,candidateRepository,dailyPlanRepository,masteryRepository,proactiveSignalRepository,clock,new UuidV7IdGenerator(clock));
  const deliverProactiveSignals = new DeliverProactiveSignals(unitOfWork,proactiveSignalRepository,messageCenter,clock);
  const outboxRepository = new SqliteOutboxRepository(database, transactionScope);
  const commandReceiptRepository = new SqliteCommandReceiptRepository(database, transactionScope);
  const ensureCurriculum = new EnsureCurriculumBundle(unitOfWork, curriculumRepository);
  const bundledCurriculum = createBundledNationalCurriculum();
  const ensureContentMetadata = new EnsureContentMetadata(unitOfWork, contentRepository);
  const bundledContentMetadata = createBundledContentMetadata();
  const ensurePromptBundle = new EnsurePromptBundle(unitOfWork, promptRepository);
  const promptRegistry = new PromptRegistry();
  promptRegistry.register(structuredObjectivePromptV2);
  promptRegistry.register(questionImportPolicyV1);
  promptRegistry.register(errorDiagnosisPromptV1);
  promptRegistry.register(errorDiagnosisBatchPromptV1);
  businessTutorPromptCatalog.forEach((bundle) => promptRegistry.register(bundle));
  const promptCompiler = new PromptCompiler(promptRegistry);
  const generationContextCompiler = new GenerationContextCompiler(
    candidateRepository,
    curriculumRepository,
    createGenerationLearningContextPort(masteryRepository, learningSessionRepository, errorDiagnosisRepository)
  );
  const buildTrueQuestionReferencePack = new BuildTrueQuestionReferencePack(
    unitOfWork,
    contentRepository,
    questionReferencePackRepository,
    clock,
    new UuidV7IdGenerator(clock)
  );
  const createGenerationWorkflow = new CreateGenerationWorkflow(
    unitOfWork,
    generationRepository,
    contentRepository,
    outboxRepository,
    generationContextCompiler,
    buildTrueQuestionReferencePack,
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
    questionReferencePackRepository,
    questionSourceRepository,
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
  const finalizeObjectiveTutorConclusion = new FinalizeObjectiveTutorConclusion(
    unitOfWork,
    tutorCycleRepository,
    errorDiagnosisRepository,
    clock,
    new UuidV7IdGenerator(clock)
  );
  const runAiErrorDiagnosis = new RunAiErrorDiagnosis(
    unitOfWork,
    errorDiagnosisRepository,
    outboxRepository,
    promptCompiler,
    invokeAgentModel,
    transitionAgentRun,
    clock,
    new UuidV7IdGenerator(clock),
    { completed: (input) => finalizeObjectiveTutorConclusion.execute(input) }
  );
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
  const recordObjectiveTutorConclusion = new RecordObjectiveTutorConclusion(
    unitOfWork,
    tutorCycleRepository,
    getObjectiveSessionReview,
    candidateRepository,
    curriculumRepository,
    masteryRepository,
    dailyPlanRepository,
    clock,
    new UuidV7IdGenerator(clock)
  );
  const buildAbilityCalibration = new BuildAbilityCalibration(
    unitOfWork,
    abilityCalibrationRepository,
    candidateRepository,
    curriculumRepository,
    learningEvidenceRepository,
    masteryRepository,
    clock,
    new UuidV7IdGenerator(clock)
  );
  const buildTutorDailyContext = new BuildTutorDailyContext(
    candidateRepository,
    curriculumRepository,
    masteryRepository,
    dailyPlanRepository,
    learningSessionRepository,
    contentRepository,
    learningThreadRepository,
    tutorCycleRepository,
    buildAbilityCalibration,
    clock
  );
  const objectiveSubmissionPostProcessor = new ObjectiveSubmissionPostProcessor(
    getObjectiveSessionReview,
    requestAiErrorDiagnosis,
    refreshMasteryTrack,
    completeReviewQueueItem,
    updateDailyPlanItemStatus,
    dailyPlanRebalancePort,
    proactiveTutorRefresh,
    { execute: () => buildAbilityCalibration.execute() },
    recordObjectiveTutorConclusion
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
    list: async (examCycleId) => masteryRepository.listTracks(examCycleId, 100),
    coverage: async (examCycleId) => (await abilityCalibrationRepository.findLatest(examCycleId))?.baseline
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
    databaseLifecycle: database,
    candidateRepository,
    conversationStore,
    agentMemoryRepository,
    curriculumRepository,
    contentRepository,
    generationRepository,
    learningAssetRepository,
    learningAssetStore,
    questionSourceRepository,
    questionReferencePackRepository,
    tutorCycleRepository,
    abilityCalibrationRepository,
    questionImportDraftRepository,
    importQuestionSource,
    archiveQuestionSource,
    scanQuestionImportDraft,
    confirmQuestionImportDraft,
    publishQuestionImportDraft,
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
    buildTutorDailyContext,
    buildAbilityCalibration,
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
      await migrationRunner.migrate(clock.now());
      await ensureCurriculum.execute(bundledCurriculum);
      await alignCandidateCurriculum.execute(bundledCurriculum);
      await ensureContentMetadata.execute(bundledContentMetadata);
      await ensurePromptBundle.execute(structuredObjectivePromptV2);
      await ensurePromptBundle.execute(questionImportPolicyV1);
      await ensurePromptBundle.execute(errorDiagnosisPromptV1);
      await ensurePromptBundle.execute(errorDiagnosisBatchPromptV1);
      for (const bundle of businessTutorPromptCatalog) {
        await ensurePromptBundle.execute(bundle);
      }
      await recoverExpiredAgentRuns.execute();
      await database.healthCheck();
    },
    close: () => database.close(),
    resetForDevelopment: () => {
      if (!import.meta.env.DEV) return Promise.reject(new Error('Database reset is disabled in production'));
      return database.resetForDevelopment();
    }
  };
}
