import {
  ModelMessageRole,
  type PromptCompiler,
  type ProviderGateway
} from '@/capabilities/ai-runtime/public';
import { AssessmentRole, type CapabilityNodeId, type JsonObject } from '@/kernel/public';
import {
  AgentRunAction,
  AgentRunType,
  TaskCenterStep,
  TaskTargetType,
  type AgentRunAggregate,
  type InvokeAgentModel,
  type TransitionAgentRun,
  type TutorAgentHandler,
  type UpdateAgentRunProgress
} from '@/modules/agent/public';
import type { CandidateRepository } from '@/modules/candidate/public';
import { GenerationWorkflowStatus, type LearningAssetStore, type RunStructuredObjectiveGenerationWorkflow } from '@/modules/content/public';
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
import type { GenerationIntent } from '@/services/GenerationTaskService';
import {
  createStructuredPracticeAgentHandler,
  type StructuredPracticeAgentDependencies
} from './StructuredPracticeAgentHandler';
import {
  digestExecutor,
  essayGradeExecutor,
  generatePracticeExecutor,
  interviewReviewExecutor,
  mockExecutor,
  studyExecutor,
  type BusinessAgentExecutionContext,
  type BusinessAgentExecutor,
  type BusinessAgentTask,
  type BusinessAgentTaskType
} from './BusinessAgentExecutors';

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
}

export function createTutorAgentHandlers(
  dependencies: TutorAgentHandlerDependencies
): readonly TutorAgentHandler[] {
  const structuredPractice = createStructuredPracticeAgentHandler(structuredDependencies(dependencies));
  return [
    createGenerationHandler(AgentRunType.ContentGeneration, dependencies, structuredPractice),
    createGenerationHandler(AgentRunType.TeachingPlan, dependencies),
    createGenerationHandler(AgentRunType.TutorTurn, dependencies),
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
    failReviewQueueItem: dependencies.failReviewQueueItem
  };
}

async function executeErrorDiagnosis(
  run: AgentRunAggregate,
  gateway: ProviderGateway | undefined,
  signal: AbortSignal | undefined,
  candidates: CandidateRepository,
  curriculums: CurriculumRepository,
  diagnoses: ErrorDiagnosisRepository,
  runner: RunAiErrorDiagnosis
): Promise<void> {
  if (!gateway) throw new Error('Error diagnosis requires provider gateway');
  const inputItems = objectArray(run.run.inputSnapshot.items);
  if (!inputItems.length) throw new Error('Error diagnosis run is missing diagnosis items');
  if (!run.run.examCycleId) throw new Error('Error diagnosis run is missing its exam cycle');
  const cycle = await candidates.findCycle(run.run.examCycleId);
  if (!cycle) throw new Error(`Exam cycle does not exist: ${run.run.examCycleId}`);
  const curriculum = await curriculums.findBundle(cycle.examCycle.curriculumVersionId);
  if (!curriculum) throw new Error(`Curriculum does not exist: ${cycle.examCycle.curriculumVersionId}`);
  const provisionalDiagnosisIds = inputItems.map((item) => (
    text(item.provisionalDiagnosisId, 'provisionalDiagnosisId') as Parameters<ErrorDiagnosisRepository['find']>[0]
  ));
  const provisionalDiagnoses = await diagnoses.findMany(provisionalDiagnosisIds);
  const diagnosisById = new Map(provisionalDiagnoses.map((diagnosis) => [diagnosis.id, diagnosis]));
  const items = inputItems.map((item, index) => {
    const provisionalDiagnosisId = provisionalDiagnosisIds[index]!;
    const diagnosis = diagnosisById.get(provisionalDiagnosisId);
    if (!diagnosis) throw new Error(`Provisional diagnosis does not exist: ${provisionalDiagnosisId}`);
    const capability = curriculum.capabilityNodes.find((node) => node.id === diagnosis.capabilityNodeId);
    return {
      provisionalDiagnosisId: provisionalDiagnosisId as Parameters<RunAiErrorDiagnosis['execute']>[0]['items'][number]['provisionalDiagnosisId'],
      evidenceContext: object(item.evidence),
      subject: capability?.subject ?? '行测',
      capabilityName: capability?.name
    };
  });
  await runner.execute({
    agentRunId: run.run.id,
    items
  }, gateway, signal);
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Agent run input is missing ${field}`);
  return value.trim();
}

function object(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as JsonObject;
}

function objectArray(value: unknown): JsonObject[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is JsonObject => Boolean(item && typeof item === 'object' && !Array.isArray(item)));
}

function createGenerationHandler(
  runType: AgentRunType,
  dependencies: TutorAgentHandlerDependencies,
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
    payload: { taskId: result.taskId || null, toolName, reply: result.reply }
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
  const payload = {
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
  const context: BusinessAgentExecutionContext = {
    signal: signal ?? new AbortController().signal,
    compilePrompt: (promptCode, payload) => {
      const compiled = dependencies.promptCompiler.compile(promptCode, {}, payload);
      return {
        system: compiled.system,
        user: compiled.user,
        responseSchema: compiled.responseSchema
      };
    },
    update: async (progress, progressText = '执行中') => {
      await dependencies.updateAgentRunProgress.execute({
        agentRunId: run.run.id,
        step: stepForProgress(progress),
        progress,
        message: progressText
      });
    },
    log: async (message) => {
      await dependencies.updateAgentRunProgress.execute({
        agentRunId: run.run.id,
        step: TaskCenterStep.InvokingModel,
        progress: 70,
        message: message.slice(0, 160)
      });
    },
    setResult: async (result) => {
      resultData = {
        ...resultData,
        ...(result.payload ? { result: toJsonObject(result.payload) } : {}),
        ...(result.resultRef ? { resultRef: result.resultRef } : {})
      };
    },
    complete: async (messages, options = {}) => {
      const response = await dependencies.invokeAgentModel.execute({
        agentRunId: run.run.id,
        modelRole: `business.${intent}`,
        system: messages
          .filter((message) => message.role === 'system')
          .map((message) => message.content)
          .join('\n\n') || '你是个人公考 AI 私教。',
        messages: messages
          .filter((message) => message.role !== 'system')
          .map((message) => ({
            role: message.role === 'assistant' ? ModelMessageRole.Assistant : ModelMessageRole.User,
            content: message.content
          })),
        temperature: options.temperature,
        maxOutputTokens: options.maxOutputTokens,
        responseSchema: options.responseSchema
      }, gateway, signal);
      return response.text;
    },
    stream: async (messages, onDelta, options = {}) => {
      const response = await dependencies.invokeAgentModel.execute({
        agentRunId: run.run.id,
        modelRole: `business.${intent}`,
        system: messages
          .filter((message) => message.role === 'system')
          .map((message) => message.content)
          .join('\n\n') || '你是个人公考 AI 私教。',
        messages: messages
          .filter((message) => message.role !== 'system')
          .map((message) => ({
            role: message.role === 'assistant' ? ModelMessageRole.Assistant : ModelMessageRole.User,
            content: message.content
          })),
        temperature: options.temperature,
        maxOutputTokens: options.maxOutputTokens,
        responseSchema: options.responseSchema,
        preferStream: !options.responseSchema,
        onDelta
      }, gateway, signal);
      return response.text;
    },
    generatePractice: async (input) => {
      const cycle = await dependencies.candidates.findCurrentCycle();
      if (!cycle) throw new Error('请先完成备考档案。');
      const curriculum = await dependencies.curriculums.findBundle(cycle.examCycle.curriculumVersionId);
      const nodes = curriculum?.capabilityNodes
        .filter((node) => node.status === 'active' && node.subject === 'aptitude') ?? [];
      const moduleCode = moduleCodeFromLabel(input.module);
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
        capabilityNodeId: capability.id as CapabilityNodeId,
        assessmentRole: AssessmentRole.Practice,
        requestedCount: input.requestedCount,
        difficultyMin: input.difficultyMin,
        difficultyMax: input.difficultyMax,
        goal: input.purpose,
        constraints: {
          source: 'agent_business_operation',
          agentRunId: run.run.id,
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
        signal
      );
      if (!result.questionSetId || !aggregate.spec.learningThreadId) {
        throw new Error('结构化题组生成失败：缺少题组或学习主线');
      }
      return {
        questionSetId: result.questionSetId,
        learningThreadId: aggregate.spec.learningThreadId,
        capabilityNodeId: capability.id,
        capabilityCode: capability.code
      };
    },
    saveLearningAsset: async (input) => {
      const cycle = await dependencies.candidates.findCurrentCycle();
      if (!cycle) throw new Error('请先完成备考档案。');
      const asset = await dependencies.learningAssetStore.save({
        examCycleId: cycle.examCycle.id,
        kind: input.kind,
        businessKey: input.businessKey,
        title: input.title,
        payload: toJsonObject(input.payload),
        sourceAgentRunId: run.run.id
      });
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
    }
  };
  await executorFor(intent)(task, context);
  const navigation = completedNavigation(intent, run.run.inputSnapshot, resultData);
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
      message: '已完成',
      actionRoute: navigation.route,
      actionParams: navigation.params
    },
    payload: { intent, ...resultData }
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
    if (intent === 'study' && assetId) {
      return { route: '/vue/study/lecture', params: { assetId } };
    }
    if (intent === 'mock' && assetId && result.subject === '行测') {
      return { route: '/vue/practice/objective-session', params: { manifestId: assetId } };
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
    params: { questionSetId, learningThreadId }
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
  if (intent === 'interviewReview') return interviewReviewExecutor;
  throw new Error(`Unsupported business operation: ${intent}`);
}

function executorType(intent: GenerationIntent): BusinessAgentTaskType {
  if (intent === 'practice' || intent === 'redo') return intent === 'redo' ? 'redo' : 'generate';
  if (intent === 'essayGrade') return 'grade';
  if (intent === 'mock') return 'mock';
  if (intent === 'daily' || intent === 'digest' || intent === 'monthlyDigest') return 'digest';
  if (intent === 'study') return 'study';
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

function moduleCodeFromLabel(value: string): string {
  if (/判断|图推|逻辑/.test(value)) return 'judgment';
  if (/言语/.test(value)) return 'verbal';
  if (/资料/.test(value)) return 'data_analysis';
  if (/数量|数学/.test(value)) return 'quantity';
  if (/常识/.test(value)) return 'common_sense';
  return value;
}
