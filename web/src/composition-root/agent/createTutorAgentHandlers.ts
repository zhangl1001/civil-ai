import type { PromptCompiler, ProviderGateway } from '@/capabilities/ai-runtime/public';
import { AssessmentRole, type CapabilityNodeId, type JsonObject } from '@/kernel/public';
import {
  AgentRunAction,
  AgentRunType,
  TaskCenterStep,
  TaskTargetType,
  leaseTokenOf,
  type AgentRunAggregate,
  type InvokeAgentModel,
  type CreateAgentRun,
  type TransitionAgentRun,
  type TutorAgentHandler,
  type UpdateAgentRunProgress
} from '@/modules/agent/public';
import type { CandidateRepository } from '@/modules/candidate/public';
import {
  GenerationWorkflowStatus,
  type ApplyQuestionSetEnrichment,
  type ContentRepository,
  type LearningAssetStore,
  type QuestionImportDraftRepository,
  type RunStructuredObjectiveGenerationWorkflow,
  type ScanQuestionImportDraft
} from '@/modules/content/public';
import type { CurriculumRepository } from '@/modules/curriculum/public';
import type {
  ErrorDiagnosisRepository,
  RecordSubjectiveAssessment,
  RunAiErrorDiagnosis
} from '@/modules/evidence/public';
import type {
  FailReviewQueueItem,
  MasteryRepository,
  RetryReviewQueueItem,
  StartReviewQueueItem
} from '@/modules/mastery/public';
import type { UpdateDailyPlanItemStatus } from '@/modules/planning/public';
import type { RequestStructuredPractice } from '@/modules/teaching/public';
import { aiBusinessTools, type AIBusinessToolCall, type AIBusinessToolName, type AIBusinessToolResult } from '@/services/AIBusinessTools';
import { practiceModuleCode } from '@/domain/labels';
import type { GenerationIntent } from '@/services/GenerationTaskService';
import {
  createStructuredPracticeAgentHandler,
  type StructuredPracticeAgentDependencies
} from './StructuredPracticeAgentHandler';
import {
  digestExecutor,
  essayGradeExecutor,
  generatePracticeExecutor,
  mockExecutor,
  studyExecutor,
  type BusinessAgentExecutionContext,
  type BusinessAgentExecutor,
  type BusinessAgentTask,
  type BusinessAgentTaskType
} from './BusinessAgentExecutors';
import { interviewQuestionsExecutor, interviewReviewExecutor } from './BusinessAgentInterviewExecutors';
import { invokeBusinessAgentModel } from './BusinessAgentModelBridge';
import {
  runTrueQuestionResearchAgent,
  type TrueQuestionResearchAgentDependencies
} from './TrueQuestionResearchAgent';
import { executeContentEnrichment } from './ContentEnrichmentAgentHandler';
import { ContentEnrichmentStrategyRegistry } from './ContentEnrichmentStrategy';
import type { EnsureQuestionSetEnrichment } from './EnsureQuestionSetEnrichment';
import { executeErrorDiagnosis } from './ErrorDiagnosisAgentHandler';
import { createQuestionSetContentEnrichmentStrategy } from './QuestionSetContentEnrichmentStrategy';

export interface TutorAgentHandlerDependencies {
  readonly candidates: CandidateRepository;
  readonly curriculums: CurriculumRepository;
  readonly diagnoses: ErrorDiagnosisRepository;
  readonly runErrorDiagnosis: RunAiErrorDiagnosis;
  readonly promptCompiler: PromptCompiler;
  readonly transitionAgentRun: TransitionAgentRun;
  readonly updateAgentRunProgress: UpdateAgentRunProgress;
  readonly invokeAgentModel: InvokeAgentModel;
  readonly requestStructuredPractice: RequestStructuredPractice;
  readonly runStructuredObjectiveGenerationWorkflow: RunStructuredObjectiveGenerationWorkflow;
  readonly learningAssetStore: LearningAssetStore;
  readonly updateDailyPlanItemStatus: UpdateDailyPlanItemStatus;
  readonly masteryRepository: MasteryRepository;
  readonly startReviewQueueItem: StartReviewQueueItem;
  readonly retryReviewQueueItem: RetryReviewQueueItem;
  readonly failReviewQueueItem: FailReviewQueueItem;
  readonly recordSubjectiveAssessment: RecordSubjectiveAssessment;
  readonly scanQuestionImportDraft: ScanQuestionImportDraft;
  readonly questionImportDraftRepository: QuestionImportDraftRepository;
  readonly createAgentLoop: TrueQuestionResearchAgentDependencies['createAgentLoop'];
  readonly createAgentRun: CreateAgentRun;
  readonly contentRepository: ContentRepository;
  readonly applyQuestionSetEnrichment: ApplyQuestionSetEnrichment;
  readonly ensureQuestionSetEnrichment: EnsureQuestionSetEnrichment;
}

export function createTutorAgentHandlers(
  dependencies: TutorAgentHandlerDependencies
): readonly TutorAgentHandler[] {
  const contentEnrichmentStrategies = new ContentEnrichmentStrategyRegistry([
    createQuestionSetContentEnrichmentStrategy({
      contentRepository: dependencies.contentRepository,
      promptCompiler: dependencies.promptCompiler,
      invokeAgentModel: dependencies.invokeAgentModel,
      applyEnrichment: dependencies.applyQuestionSetEnrichment,
      updateProgress: dependencies.updateAgentRunProgress
    })
  ]);
  return [
    createGenerationHandler(
      AgentRunType.ContentGeneration,
      dependencies,
      contentEnrichmentStrategies,
      createStructuredPracticeAgentHandler(
        structuredDependencies(dependencies)
      )
    ),
    createGenerationHandler(AgentRunType.TeachingPlan, dependencies, contentEnrichmentStrategies),
    createGenerationHandler(AgentRunType.TutorTurn, dependencies, contentEnrichmentStrategies),
    createGenerationHandler(AgentRunType.Review, dependencies, contentEnrichmentStrategies),
    {
      runType: AgentRunType.ErrorDiagnosis,
      requiresGateway: true,
      execute: async (run, gateway, signal) => executeErrorDiagnosis(
        run,
        gateway,
        signal,
        dependencies.candidates,
        dependencies.curriculums,
        dependencies.diagnoses,
        dependencies.runErrorDiagnosis
      )
    }
  ];
}

function structuredDependencies(
  dependencies: TutorAgentHandlerDependencies
): StructuredPracticeAgentDependencies {
  return {
    requestPractice: dependencies.requestStructuredPractice,
    runGeneration: dependencies.runStructuredObjectiveGenerationWorkflow,
    updateProgress: dependencies.updateAgentRunProgress,
    transition: dependencies.transitionAgentRun,
    updateDailyPlanItemStatus: dependencies.updateDailyPlanItemStatus,
    masteryRepository: dependencies.masteryRepository,
    startReviewQueueItem: dependencies.startReviewQueueItem,
    retryReviewQueueItem: dependencies.retryReviewQueueItem,
    failReviewQueueItem: dependencies.failReviewQueueItem,
    ensureQuestionSetEnrichment: dependencies.ensureQuestionSetEnrichment
  };
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Agent run input is missing ${field}`);
  return value.trim();
}

function object(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as JsonObject;
}

function createGenerationHandler(
  runType: AgentRunType,
  dependencies: TutorAgentHandlerDependencies,
  contentEnrichmentStrategies: ContentEnrichmentStrategyRegistry,
  structuredPractice?: TutorAgentHandler
): TutorAgentHandler {
  return {
    runType,
    execute: async (run, gateway, signal) => {
      if (run.run.targetResourceType === TaskTargetType.StructuredPractice && structuredPractice) {
        await structuredPractice.execute(run, gateway, signal);
        return;
      }
      if (run.run.targetResourceType === 'chat_tool') {
        await executeChatTool(run, signal, dependencies.transitionAgentRun);
        return;
      }
      if (run.run.targetResourceType === TaskTargetType.BusinessOperation) {
        await executeBusinessOperation(run, gateway, signal, dependencies);
        return;
      }
      if (run.run.targetResourceType === TaskTargetType.ContentEnrichment) {
        await executeContentEnrichment(run, gateway, signal, {
          strategies: contentEnrichmentStrategies,
          transition: dependencies.transitionAgentRun
        });
        return;
      }
      throw new Error(`Unsupported agent run target: ${run.run.targetResourceType || 'unknown'}`);
    }
  };
}

async function executeChatTool(run: AgentRunAggregate, signal: AbortSignal | undefined, transitionAgentRun: TransitionAgentRun): Promise<void> {
  if (signal?.aborted) throw new Error('agent_run.worker_aborted');
  if (run.run.targetResourceType !== 'chat_tool') throw new Error('Agent run is not a chat tool run');
  const toolName = text(run.run.inputSnapshot.toolName, 'toolName') as AIBusinessToolName;
  const sessionId = text(run.run.inputSnapshot.chatSessionId, 'chatSessionId');
  const call: AIBusinessToolCall = {
    name: toolName,
    arguments: object(run.run.inputSnapshot.arguments)
  };
  const result: AIBusinessToolResult = await aiBusinessTools.execute(call, { sessionId });
  await transitionAgentRun.execute({
    idempotencyKey: `chat-tool:${run.run.id}:completed`,
    agentRunId: run.run.id,
    action: AgentRunAction.Complete,
    reasonCode: 'chat_tool.completed',
    checkpoint: { taskId: result.taskId || null, toolName, reply: result.reply },
    payload: { taskId: result.taskId || null, toolName, reply: result.reply },
    leaseToken: leaseTokenOf(run.run)
  });
}

async function executeBusinessOperation(
  run: AgentRunAggregate,
  gateway: ProviderGateway | undefined,
  signal: AbortSignal | undefined,
  dependencies: TutorAgentHandlerDependencies
): Promise<void> {
  if (signal?.aborted) throw new Error('agent_run.worker_aborted');
  if (run.run.targetResourceType !== TaskTargetType.BusinessOperation) {
    throw new Error('Agent run is not a business operation');
  }
  if (!gateway) throw new Error('Business operation requires provider gateway');
  const intent = text(run.run.inputSnapshot.intent, 'intent') as GenerationIntent;
  const payload: JsonObject = {
    ...object(run.run.inputSnapshot.payload),
    intent,
    module: run.run.inputSnapshot.module ?? null,
    sourceId: run.run.inputSnapshot.sourceId ?? null
  };
  const task: BusinessAgentTask = {
    id: run.run.id,
    type: executorType(intent),
    detail: text(run.run.inputSnapshot.detail, 'detail'),
    payload
  };
  let resultData: JsonObject = {};
  const executionSignal = signal ?? new AbortController().signal;
  const context: BusinessAgentExecutionContext = {
    signal: executionSignal,
    compilePrompt: (promptCode, payload) => {
      const compiled = dependencies.promptCompiler.compile(promptCode, {}, payload);
      return {
        system: compiled.system,
        user: compiled.user,
        responseSchema: compiled.responseSchema
      };
    },
    update: async (progress, progressText = '执行中') => {
      executionSignal.throwIfAborted();
      await dependencies.updateAgentRunProgress.execute({
        agentRunId: run.run.id,
        step: stepForProgress(progress),
        progress,
        message: progressText,
        leaseToken: leaseTokenOf(run.run)
      });
    },
    log: async (message) => {
      executionSignal.throwIfAborted();
      await dependencies.updateAgentRunProgress.execute({
        agentRunId: run.run.id,
        step: TaskCenterStep.InvokingModel,
        progress: 70,
        message: message.slice(0, 160),
        leaseToken: leaseTokenOf(run.run)
      });
    },
    setResult: async (result) => {
      executionSignal.throwIfAborted();
      resultData = {
        ...resultData,
        ...(result.payload ? { result: toJsonObject(result.payload) } : {}),
        ...(result.resultRef ? { resultRef: result.resultRef } : {})
      };
    },
    complete: async (messages, options = {}) => {
      return invokeBusinessAgentModel({
        run, intent, messages, options, gateway, signal: executionSignal,
        invoke: dependencies.invokeAgentModel
      });
    },
    stream: async (messages, onDelta, options = {}) => {
      return invokeBusinessAgentModel({
        run, intent, messages, options, gateway, signal: executionSignal,
        invoke: dependencies.invokeAgentModel, onDelta
      });
    },
    generatePractice: async (input) => {
      executionSignal.throwIfAborted();
      const cycle = await dependencies.candidates.findCurrentCycle();
      if (!cycle) throw new Error('请先完成备考档案。');
      const curriculum = await dependencies.curriculums.findBundle(cycle.examCycle.curriculumVersionId);
      const nodes = curriculum?.capabilityNodes
        .filter((node) => node.status === 'active' && node.subject === 'aptitude') ?? [];
      const moduleCode = practiceModuleCode(input.module);
      const candidates = moduleCode ? nodes.filter((node) => node.module === moduleCode) : nodes;
      const matched = (
        input.knowledgePoint
          ? candidates.find((node) => (
            node.name.includes(input.knowledgePoint!)
            || input.knowledgePoint!.includes(node.name)
            || node.code.includes(input.knowledgePoint!)
          ))
          : undefined
      );
      const trainable = candidates.filter((node) => node.nodeType === 'sub_point' || node.nodeType === 'knowledge_point');
      const indexed = trainable.length
        ? trainable[Math.max(0, Math.floor(input.capabilityIndex ?? 0)) % trainable.length]
        : undefined;
      const capability = matched ?? indexed ?? candidates.find((node) => node.nodeType === 'sub_point' || node.nodeType === 'knowledge_point')
        ?? nodes[0];
      if (!capability) throw new Error('当前大纲没有可用的行测能力节点。');
      await context.update(42, '调用 AI 生成结构化讲义和题目');
      const aggregate = await dependencies.requestStructuredPractice.execute({
        idempotencyKey: `agent-run:${run.run.id}:structured-practice`,
        sourceAgentRunId: run.run.rootAgentRunId,
        capabilityNodeId: capability.id as CapabilityNodeId,
        assessmentRole: AssessmentRole.Practice,
        requestedCount: input.requestedCount,
        difficultyMin: input.difficultyMin,
        difficultyMax: input.difficultyMax,
        goal: input.purpose,
        constraints: {
          source: 'agent_business_operation',
          module: input.module,
          knowledgePoint: input.knowledgePoint ?? capability.name,
          requestedBy: input.review ? 'wrongbook_review' : 'ai_or_practice_entry'
        }
      });
      if (aggregate.workflow.status === GenerationWorkflowStatus.Failed) {
        await dependencies.runStructuredObjectiveGenerationWorkflow.retry(aggregate.workflow.id);
      }
      const result = await dependencies.runStructuredObjectiveGenerationWorkflow.execute(
        aggregate.workflow.id,
        gateway,
        executionSignal
      );
      executionSignal.throwIfAborted();
      if (!result.questionSetId || !aggregate.spec.learningThreadId) {
        throw new Error('结构化题组生成失败：缺少题组或学习主线');
      }
      await dependencies.ensureQuestionSetEnrichment.execute({
        questionSetId: result.questionSetId,
        parentAgentRunId: run.run.id
      }).catch((error: unknown) => {
        console.warn('[TutorAgent] failed to schedule question-set enrichment', error);
      });
      return {
        questionSetId: result.questionSetId,
        learningThreadId: aggregate.spec.learningThreadId,
        capabilityNodeId: capability.id,
        capabilityCode: capability.code
      };
    },
    saveLearningAsset: async (input) => {
      executionSignal.throwIfAborted();
      const cycle = await dependencies.candidates.findCurrentCycle();
      if (!cycle) throw new Error('请先完成备考档案。');
      const asset = await dependencies.learningAssetStore.save({
        examCycleId: cycle.examCycle.id,
        kind: input.kind,
        businessKey: input.businessKey,
        title: input.title,
        payload: toJsonObject(input.payload),
        purpose: input.purpose,
        sourceAgentRunId: run.run.id
      });
      executionSignal.throwIfAborted();
      return { id: asset.id, version: asset.version };
    },
    findLatestLearningAsset: async (input) => {
      const cycle = await dependencies.candidates.findCurrentCycle();
      if (!cycle) return undefined;
      const asset = await dependencies.learningAssetStore.findLatest(
        cycle.examCycle.id,
        input.kind,
        input.businessKey
      );
      return asset
        ? { id: asset.id, payload: asset.payload as Record<string, unknown> }
        : undefined;
    },
    listLearningAssets: async (input) => {
      const cycle = await dependencies.candidates.findCurrentCycle();
      if (!cycle) return [];
      const assets = await dependencies.learningAssetStore.list({
        examCycleId: cycle.examCycle.id,
        kinds: input.kinds,
        limit: input.limit
      });
      return assets.map((asset) => ({
        id: asset.id,
        businessKey: asset.businessKey,
        title: asset.title,
        payload: asset.payload as Record<string, unknown>,
        createdAt: asset.createdAt
      }));
    },
    recordSubjectiveAssessment: async (input) => {
      executionSignal.throwIfAborted();
      const cycle = await dependencies.candidates.findCurrentCycle();
      if (!cycle) throw new Error('请先完成备考档案。');
      const curriculum = await dependencies.curriculums.findBundle(cycle.examCycle.curriculumVersionId);
      if (!curriculum) throw new Error('当前考试大纲不可用。');
      const nodes = new Map(curriculum.capabilityNodes.map((node) => [node.code, node]));
      const dimensions = input.dimensions.flatMap((dimension) => {
        const node = nodes.get(dimension.capabilityCode);
        if (!node) return [];
        return [{
          capabilityNodeId: node.id,
          dimensionKey: dimension.dimensionKey,
          score: dimension.score,
          confidence: dimension.confidence,
          metadata: toJsonObject(dimension.metadata)
        }];
      });
      if (!dimensions.length) throw new Error('主观题评分没有匹配到能力节点。');
      await dependencies.recordSubjectiveAssessment.execute({
        examCycleId: cycle.examCycle.id,
        sourceAssetId: input.sourceAssetId,
        rubricVersion: input.rubricVersion,
        dimensions
      });
      executionSignal.throwIfAborted();
    }
  };
  if (intent === 'trueQuestionResearch') {
    const research = await runTrueQuestionResearchAgent(
      task,
      run.run,
      gateway,
      context,
      {
        candidates: dependencies.candidates,
        curriculums: dependencies.curriculums,
        scanDraft: dependencies.scanQuestionImportDraft,
        drafts: dependencies.questionImportDraftRepository,
        createAgentLoop: dependencies.createAgentLoop
      }
    );
    resultData = {
      resultRef: research.draftId,
      result: {
        draftId: research.draftId,
        totalCount: research.totalCount,
        readyCount: research.readyCount,
        needsConfirmationCount: research.needsConfirmationCount
      }
    };
  } else {
    await executorFor(intent)(task, context);
  }
  executionSignal.throwIfAborted();
  await markDailyPlanContentReady(run, payload, resultData, dependencies);
  const navigation = completedNavigation(intent, run.run.inputSnapshot, resultData);
  const completionMessage = intent === 'trueQuestionResearch'
    ? `已形成 ${String(objectValue(resultData.result).totalCount || 0)} 道待确认真题`
    : '已完成';
  await dependencies.transitionAgentRun.execute({
    idempotencyKey: `business:${run.run.id}:completed`,
    agentRunId: run.run.id,
    action: AgentRunAction.Complete,
    reasonCode: 'business_operation.completed',
    checkpoint: {
      ...resultData,
      intent,
      progress: 100,
      step: TaskCenterStep.Completed,
      message: completionMessage,
      dailyPlanItemId: optionalText(payload.dailyPlanItemId) ?? null,
      actionRoute: navigation.route,
      actionParams: navigation.params
    },
    payload: { intent, ...resultData },
    leaseToken: leaseTokenOf(run.run)
  });
}

async function markDailyPlanContentReady(
  run: AgentRunAggregate,
  payload: JsonObject,
  resultData: JsonObject,
  dependencies: TutorAgentHandlerDependencies
): Promise<void> {
  const dailyPlanItemId = optionalText(payload.dailyPlanItemId);
  if (!dailyPlanItemId) return;
  await dependencies.updateDailyPlanItemStatus.execute({
    dailyPlanItemId,
    status: 'in_progress',
    resultSummary: {
      contentReady: true,
      agentRunId: run.run.id,
      ...(optionalText(resultData.resultRef) ? { resultRef: optionalText(resultData.resultRef)! } : {})
    }
  }).catch((error: unknown) => {
    console.warn('[TutorAgent] generated content is ready but daily plan linkage could not be updated', error);
  });
}

function completedNavigation(
  intent: GenerationIntent,
  input: JsonObject,
  resultData: JsonObject
): { readonly route: JsonObject[string]; readonly params: JsonObject } {
  const fallbackRoute = input.actionRoute ?? null;
  const fallbackParams = objectValue(input.actionParams);
  const result = objectValue(resultData.result);
  if (intent !== 'practice' && intent !== 'redo') {
    const assetId = optionalText(result.assetId);
    if (intent === 'trueQuestionResearch') {
      return {
        route: '/vue/practice',
        params: {
          mode: 'true',
          ...(typeof result.draftId === 'string' ? { draftId: result.draftId } : {})
        }
      };
    }
    if (intent === 'study' && assetId) {
      return { route: '/vue/study/lecture', params: { ...fallbackParams, assetId } };
    }
    if (intent === 'mock' && assetId && result.subject === '行测') {
      return { route: '/vue/practice/objective-session', params: { ...fallbackParams, manifestId: assetId } };
    }
    return {
      route: fallbackRoute,
      params: {
        ...fallbackParams,
        ...(assetId ? { assetId } : {}),
        ...(typeof result.sessionId === 'string' ? { sessionId: result.sessionId } : {}),
        ...(typeof result.date === 'string' ? { date: result.date } : {}),
        ...(typeof result.tab === 'string' ? { tab: result.tab } : {}),
        ...(typeof result.year === 'number' ? { year: result.year } : {}),
        ...(typeof result.month === 'number' ? { month: result.month } : {})
      }
    };
  }
  const questionSetId = optionalText(result.questionSetId);
  const learningThreadId = optionalText(result.learningThreadId);
  if (!questionSetId || !learningThreadId) {
    return { route: fallbackRoute, params: fallbackParams };
  }
  return {
    route: '/vue/practice/objective-session',
    params: { ...fallbackParams, questionSetId, learningThreadId }
  };
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function objectValue(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function executorFor(intent: GenerationIntent): BusinessAgentExecutor {
  if (intent === 'practice' || intent === 'redo') return generatePracticeExecutor;
  if (intent === 'essayGrade') return essayGradeExecutor;
  if (intent === 'mock') return mockExecutor;
  if (intent === 'daily' || intent === 'digest' || intent === 'monthlyDigest') return digestExecutor;
  if (intent === 'study') return studyExecutor;
  if (intent === 'interviewQuestions') return interviewQuestionsExecutor;
  if (intent === 'interviewReview') return interviewReviewExecutor;
  throw new Error(`Unsupported business operation: ${intent}`);
}

function executorType(intent: GenerationIntent): BusinessAgentTaskType {
  if (intent === 'practice' || intent === 'redo') return intent === 'redo' ? 'redo' : 'generate';
  if (intent === 'essayGrade') return 'grade';
  if (intent === 'mock') return 'mock';
  if (intent === 'daily' || intent === 'digest' || intent === 'monthlyDigest') return 'digest';
  if (intent === 'study') return 'study';
  if (intent === 'trueQuestionResearch') return 'research';
  return 'interview';
}

function stepForProgress(progress: number) {
  if (progress < 25) return TaskCenterStep.PreparingContext;
  if (progress < 55) return TaskCenterStep.InvokingModel;
  if (progress < 80) return TaskCenterStep.ParsingResponse;
  return TaskCenterStep.CommittingResult;
}

function toJsonObject(value: Record<string, unknown>): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}
