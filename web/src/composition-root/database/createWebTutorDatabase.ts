import { IndexedDbTransactionScope, IndexedDbUnitOfWork } from '@/capabilities/database/adapters/indexeddb/IndexedDbUnitOfWork';
import { TutorIndexedDb } from '@/capabilities/database/adapters/indexeddb/TutorIndexedDb';
import { IndexedDbTutorDataMaintenance } from '@/capabilities/database/adapters/indexeddb/IndexedDbTutorDataMaintenance';
import type { TutorDatabaseLifecycle } from '@/capabilities/database/public';
import { IndexedDbCandidateRepository } from '@/modules/candidate/adapters/IndexedDbCandidateRepository';
import { WebAgentWorkspaceStorage } from '@/modules/agent/adapters/WebAgentWorkspaceStorage';
import { ConversationMessageLog, ConversationSessionLog, ConversationStore } from '@/modules/conversation/public';
import {
  AlignCandidateCurriculum,
  candidateOnboardingPolicy,
  CreateCandidateCycle,
  GetCandidateHome,
  UpdateLearningPreferences,
  UpdateScoreTargets
} from '@/modules/candidate/public';
import { IndexedDbCurriculumRepository } from '@/modules/curriculum/adapters/IndexedDbCurriculumRepository';
import { createBundledCurriculumPacks, EnsureCurriculumBundle } from '@/modules/curriculum/public';
import { InstallExamPacks } from '../curriculum/InstallExamPacks';
import { IndexedDbOutboxRepository } from '@/modules/task/adapters/IndexedDbOutboxRepository';
import { IndexedDbCommandReceiptRepository } from '@/modules/task/adapters/IndexedDbCommandReceiptRepository';
import { UuidV7IdGenerator } from '@/capabilities/platform/public';
import type { Clock } from '@/kernel/public';
import { IndexedDbPromptRepository } from '@/capabilities/ai-runtime/adapters/IndexedDbPromptRepository';
import { IndexedDbAIInvocationRepository } from '@/capabilities/ai-runtime/adapters/IndexedDbAIInvocationRepository';
import {
  businessTutorPromptCatalog,
  EnsurePromptBundle,
  errorDiagnosisBatchPromptV1,
  errorDiagnosisPromptV1,
  PromptCompiler,
  PromptRegistry,
  questionImportPolicyV1,
  questionSetEnrichmentPromptV1,
  structuredObjectivePromptV2
} from '@/capabilities/ai-runtime/public';
import { IndexedDbContentRepository } from '@/modules/content/adapters/IndexedDbContentRepository';
import { IndexedDbGenerationRepository } from '@/modules/content/adapters/IndexedDbGenerationRepository';
import { IndexedDbLearningAssetRepository } from '@/modules/content/adapters/IndexedDbLearningAssetRepository';
import { IndexedDbQuestionSourceRepository } from '@/modules/content/adapters/IndexedDbQuestionSourceRepository';
import { IndexedDbQuestionImportDraftRepository } from '@/modules/content/adapters/IndexedDbQuestionImportDraftRepository';
import { IndexedDbQuestionReferencePackRepository } from '@/modules/content/adapters/IndexedDbQuestionReferencePackRepository';
import {
  ArchiveQuestionSource,
  ApplyQuestionSetEnrichment,
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
  RetireQuestionSet,
  RunStructuredObjectiveGenerationWorkflow,
  ScanQuestionImportDraft
} from '@/modules/content/public';
import { IndexedDbLearningThreadRepository } from '@/modules/teaching/adapters/IndexedDbLearningThreadRepository';
import { IndexedDbAgentRunRepository } from '@/modules/agent/adapters/IndexedDbAgentRunRepository';
import { IndexedDbAgentToolReceiptRepository } from '@/modules/agent/adapters/IndexedDbAgentToolReceiptRepository';
import {
  AgentRunExecutionRegistry,
  CancelAgentRun,
  ClaimAgentRuns,
  CreateAgentRun,
  createDurableAgentLoopFactory,
  DefaultAgentToolPolicy,
  FileAgentMemoryRepository,
  GetAgentRunViews,
  InvokeAgentModel,
  RecoverExpiredAgentRuns,
  RunTutorAgentBatch,
  SaveAgentLoopCheckpoint,
  TransitionAgentRun,
  UpdateAgentRunProgress
} from '@/modules/agent/public';
import { IndexedDbMessageCenterRepository } from '@/modules/message-center/adapters/IndexedDbMessageCenterRepository';
import { MessageCenter } from '@/modules/message-center/public';
import { IndexedDbProactiveSignalRepository } from '@/modules/proactive/adapters/IndexedDbProactiveSignalRepository';
import { DeliverProactiveSignals, EvaluateProactiveSignals } from '@/modules/proactive/public';
import { IndexedDbLearningProgressRepository } from '@/modules/learning-progress/adapters/IndexedDbLearningProgressRepository';
import { TrackLearningProgress } from '@/modules/learning-progress/public';
import { IndexedDbMasteryRepository } from '@/modules/mastery/adapters/IndexedDbMasteryRepository';
import { createGenerationLearningContextPort } from './createGenerationLearningContextPort';
import { CompleteReviewQueueItem, FailReviewQueueItem, RefreshMasteryTrack, RetryReviewQueueItem, StartReviewQueueItem } from '@/modules/mastery/public';
import { IndexedDbDailyPlanRepository } from '@/modules/planning/adapters/IndexedDbDailyPlanRepository';
import { BuildDailyPlanProposal, CompleteDailyPlanItem, DailyPlanRebalanceReason, PersistDailyPlanProposal, RebalanceDailyPlanAfterLearning, UpdateDailyPlanItemStatus } from '@/modules/planning/public';
import { CreateLearningThread, StartStructuredTeaching, RequestStructuredPractice, TransitionLearningThread } from '@/modules/teaching/public';
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
  SubmitObjectiveSession
} from '@/modules/evidence/public';
import { createTutorAgentHandlers } from '../agent/createTutorAgentHandlers';
import { EnqueueContentEnrichment } from '../agent/EnqueueContentEnrichment';
import { EnsureQuestionSetEnrichment } from '../agent/EnsureQuestionSetEnrichment';
import { TaskMessageProjector } from '../agent/TaskMessageProjector';
import { IndexedDbTutorCycleRepository } from '@/modules/tutoring/adapters/IndexedDbTutorCycleRepository';
import { IndexedDbAbilityCalibrationRepository } from '@/modules/calibration/adapters/IndexedDbAbilityCalibrationRepository';
import { BuildAbilityCalibration } from '@/modules/calibration/public';
import {
  BuildLearnerPrioritySnapshot,
  BuildTutorDailyContext,
  FinalizeObjectiveTutorConclusion,
  RecordObjectiveTutorConclusion
} from '@/modules/tutoring/public';
import type { TutorDatabaseRuntime } from './TutorDatabaseRuntime';
export type WebTutorDatabaseRuntime = TutorDatabaseRuntime;
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
  const questionSourceRepository = new IndexedDbQuestionSourceRepository(database, transactionScope);
  const questionReferencePackRepository = new IndexedDbQuestionReferencePackRepository(database, transactionScope);
  const questionImportDraftRepository = new IndexedDbQuestionImportDraftRepository(database, transactionScope);
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
  const learningAssetStore = new LearningAssetStore(unitOfWork, learningAssetRepository, clock, new UuidV7IdGenerator(clock));
  const promptRepository = new IndexedDbPromptRepository(database, transactionScope);
  const aiInvocationRepository = new IndexedDbAIInvocationRepository(database, transactionScope);
  const learningThreadRepository = new IndexedDbLearningThreadRepository(database, transactionScope);
  const learningSessionRepository = new IndexedDbLearningSessionRepository(database, transactionScope);
  const errorDiagnosisRepository = new IndexedDbErrorDiagnosisRepository(database, transactionScope);
  const learningEvidenceRepository = new IndexedDbLearningEvidenceRepository(database, transactionScope);
  const agentRunRepository = new IndexedDbAgentRunRepository(database, transactionScope);
  const agentToolReceiptRepository = new IndexedDbAgentToolReceiptRepository(database);
  const messageCenterRepository = new IndexedDbMessageCenterRepository(database, transactionScope);
  const proactiveSignalRepository = new IndexedDbProactiveSignalRepository(database, transactionScope);
  const learningProgressRepository = new IndexedDbLearningProgressRepository(database, transactionScope);
  const trackLearningProgress = new TrackLearningProgress(unitOfWork, learningProgressRepository, clock, new UuidV7IdGenerator(clock));
  const messageCenter = new MessageCenter(unitOfWork, messageCenterRepository, clock, new UuidV7IdGenerator(clock));
  const masteryRepository = new IndexedDbMasteryRepository(database, transactionScope);
  const buildLearnerPrioritySnapshot = new BuildLearnerPrioritySnapshot(candidateRepository, curriculumRepository, masteryRepository, learningProgressRepository, clock);
  const dailyPlanRepository = new IndexedDbDailyPlanRepository(database, transactionScope);
  const tutorCycleRepository = new IndexedDbTutorCycleRepository(database, transactionScope);
  const abilityCalibrationRepository = new IndexedDbAbilityCalibrationRepository(database, transactionScope);
  const evaluateProactiveSignals = new EvaluateProactiveSignals(unitOfWork,candidateRepository,dailyPlanRepository,masteryRepository,proactiveSignalRepository,clock,new UuidV7IdGenerator(clock));
  const deliverProactiveSignals = new DeliverProactiveSignals(unitOfWork,proactiveSignalRepository,messageCenter,clock);
  const outboxRepository = new IndexedDbOutboxRepository(database, transactionScope);
  const commandReceiptRepository = new IndexedDbCommandReceiptRepository(database, transactionScope);
  const ensureCurriculum = new EnsureCurriculumBundle(unitOfWork, curriculumRepository);
  const curriculumPacks = createBundledCurriculumPacks();
  const ensureContentMetadata = new EnsureContentMetadata(unitOfWork, contentRepository);
  const bundledContentMetadata = createBundledContentMetadata();
  const ensurePromptBundle = new EnsurePromptBundle(unitOfWork, promptRepository);
  const promptRegistry = new PromptRegistry();
  promptRegistry.register(structuredObjectivePromptV2);
  promptRegistry.register(questionSetEnrichmentPromptV1);
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
  const applyQuestionSetEnrichment = new ApplyQuestionSetEnrichment(unitOfWork, contentRepository);
  const retireQuestionSet = new RetireQuestionSet(unitOfWork, contentRepository);
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
  const ensureQuestionSetEnrichment = new EnsureQuestionSetEnrichment(contentRepository, agentRunRepository, new EnqueueContentEnrichment(createAgentRun));
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
  const createAgentLoop = createDurableAgentLoopFactory({ invoker: invokeAgentModel, policy: defaultAgentToolPolicy, receipts: agentToolReceiptRepository, runs: agentRunRepository, checkpoints: saveAgentLoopCheckpoint, clock });
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
  const confirmErrorDiagnosis = new ConfirmErrorDiagnosis(
    unitOfWork,
    errorDiagnosisRepository,
    learningEvidenceRepository,
    refreshMasteryTrack,
    outboxRepository,
    clock,
    new UuidV7IdGenerator(clock)
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
  const buildDailyPlanProposal = new BuildDailyPlanProposal(
    candidateRepository,
    masteryRepository,
    curriculumRepository,
    learningProgressRepository,
    clock
  );
  const persistDailyPlanProposal = new PersistDailyPlanProposal(unitOfWork, dailyPlanRepository, clock, new UuidV7IdGenerator(clock));
  const updateDailyPlanItemStatus = new UpdateDailyPlanItemStatus(unitOfWork, dailyPlanRepository, clock);
  const rebalanceDailyPlanAfterLearning = new RebalanceDailyPlanAfterLearning(candidateRepository,dailyPlanRepository,buildDailyPlanProposal,persistDailyPlanProposal,clock);
  const completeDailyPlanItem = new CompleteDailyPlanItem(candidateRepository, updateDailyPlanItemStatus, rebalanceDailyPlanAfterLearning);
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
      recordSubjectiveAssessment,
      scanQuestionImportDraft,
      questionImportDraftRepository,
      createAgentLoop,
      createAgentRun,
      contentRepository,
      applyQuestionSetEnrichment,
      ensureQuestionSetEnrichment
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
    buildLearnerPrioritySnapshot,
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
    databaseLifecycle,
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
    agentToolReceiptRepository,
    messageCenterRepository,
    messageCenter,
    proactiveSignalRepository,
    learningProgressRepository,
    trackLearningProgress,
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
    completeDailyPlanItem,
    createGenerationWorkflow,
    runStructuredObjectiveGenerationWorkflow,
    applyQuestionSetEnrichment,
    retireQuestionSet,
    ensureQuestionSetEnrichment,
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
    buildLearnerPrioritySnapshot,
    buildTutorDailyContext,
    buildAbilityCalibration,
    createAgentRun,
    transitionAgentRun,
    agentRunExecutions,
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
    curriculumPacks,
    initialize: async () => {
      await database.open();
      await new InstallExamPacks(curriculumPacks, ensureCurriculum, alignCandidateCurriculum, candidateRepository).execute();
      await ensureContentMetadata.execute(bundledContentMetadata);
      await ensurePromptBundle.execute(structuredObjectivePromptV2);
      await ensurePromptBundle.execute(questionSetEnrichmentPromptV1);
      await ensurePromptBundle.execute(questionImportPolicyV1);
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
