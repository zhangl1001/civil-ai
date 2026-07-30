import { buildCompanionChatPrompt } from '@/ai/prompts';
import {
  AI_EXECUTION_BUDGET,
  createProviderExecutionDeadline,
  ModelMessageRole,
  type ModelImageContentPart,
  type ModelMessage
} from '@/capabilities/ai-runtime/public';
import {
  createConfiguredProviderGateway,
  initializeTutorRuntime,
  type TutorDatabaseRuntime
} from '@/composition-root/public';
import type { AIMessage, AISession } from '@/domain/ai';
import type {
  AgentRunId,
  QuestionImportCandidateId,
  QuestionImportDraftId,
  SubjectCode
} from '@/kernel/public';
import {
  AgentRunAction,
  AgentRunType,
  AuthorizedAgentToolExecutor,
  AgentRunSuspendedError,
  agentExternalToolCatalog,
  isAgentRunSuspended,
  RegisteredAgentToolExecutor,
  TaskCenterStep,
  TaskTargetType,
  type AgentLoopCheckpoint,
  type AgentRuntimeEvent,
  type AgentWorkflowInvocation
} from '@/modules/agent/public';
import { aiBusinessTools, type AIBusinessToolName } from './AIBusinessTools';
import { aiChatRepository } from './AIChatRepository';
import { aiConfigService } from './AIConfigService';
import { AIPracticeLibraryService } from './AIPracticeLibraryService';
import { aiStudentContextService } from './AIStudentContextService';
import { agentToolActivityService } from './AgentToolActivityService';
import { isAgentCancellation, isAgentConfirmation } from './AgentConfirmationReply';
import {
  agentRunCompletionExpectation,
  agentRunCompletionVerification
} from './AgentCompletionEvidence';
import { agentFileReader } from './AgentFileReader';
import {
  chatExecutionFailureText,
  hasVisibleAssistantContent,
  visibleAssistantText
} from './AgentResponsePresentation';
import { chatTaskPresentation, publishChatTaskMessage } from './ChatAgentTaskPresentation';
import { compileChatAgentContext } from './ChatAgentContextCompiler';
import {
  chatAgentBusinessTools,
  chatAgentMemoryTools,
  chatAgentSystemPromptComposer,
  planChatAgentCapabilities,
} from './ChatAgentCapabilities';
import { webResearchService } from './WebResearchService';
import { registerChatAgentSkillSelector } from './ChatAgentSkillSelector';
import { QuestionImportAgentService } from './QuestionImportAgentService';
import { agentWorkspaceQueryService } from './AgentWorkspaceQueryService';
import { composeGroundedAgentSystem, readDeviceClock } from './AgentSystemTools';
import { registerQuestionImportRepairTool } from './RegisterQuestionImportRepairTool';
import { ChatAgentToolAuthorization } from './ChatAgentToolAuthorization';
import { agentConversationMemoryService, type RememberAgentPreferenceInput } from './AgentConversationMemoryService';
import {
  activityStatus,
  asJsonObject,
  asJsonRecord,
  budgetContinuationCheckpoint,
  compactText,
  confirmationText,
  eventStatus,
  findWaitingRun,
  isToolActivityEvent,
  isWeekend,
  normalizeFreshness,
  optionalNumber,
  optionalString,
  parseCheckpoint,
  toolLabel
} from './ChatAgentRuntimeSupport';
export interface ChatAgentResult {
  readonly handled: boolean;
}
export interface ChatAssistantStreamUpdate {
  readonly sessionId: string;
  readonly messageId: string;
  readonly content: string;
  readonly replaceMessageId?: string;
}
export interface ChatAgentOptions {
  readonly thinkingEnabled: boolean;
  readonly onAssistantStream?: (update: ChatAssistantStreamUpdate) => void | Promise<void>;
  /** Ephemeral image parts for the current user turn; never persisted in chat history. */
  readonly attachments?: readonly ModelImageContentPart[];
  /** Exact context from a first-party workflow. Free conversation leaves this empty. */
  readonly invocation?: AgentWorkflowInvocation;
}
interface ActiveChatRun {
  runId?: AgentRunId;
  readonly controller: AbortController;
  readonly guidanceQueue: string[];
}
export class ChatAgentService {
  private readonly activeRuns = new Map<string, ActiveChatRun>();
  cancel(sessionId?: string, reason: 'user' | 'lifecycle' = 'user'): void {
    const interruption = reason === 'lifecycle'
      ? new AgentRunSuspendedError('Foreground chat stopped because the app left the foreground.')
      : new DOMException('User cancelled the Agent run.', 'AbortError');
    if (sessionId) {
      this.activeRuns.get(sessionId)?.controller.abort(interruption);
      return;
    }
    this.activeRuns.forEach((run) => run.controller.abort(interruption));
  }
  async steer(text: string, session: AISession): Promise<AIMessage | undefined> {
    const guidance = text.trim();
    const active = this.activeRuns.get(session.id);
    if (
      !guidance
      || !active
      || active.controller.signal.aborted
    ) {
      return undefined;
    }
    active.guidanceQueue.push(guidance);
    if (active.guidanceQueue.length > 4) {
      active.guidanceQueue.splice(0, active.guidanceQueue.length - 4);
    }
    return aiChatRepository.addMessage({
      sessionId: session.id,
      role: 'user',
      content: guidance
    });
  }
  async handle(text: string, session: AISession, options: ChatAgentOptions): Promise<ChatAgentResult> {
    if (!shouldUseAgent(text)) return { handled: false };
    this.activeRuns.get(session.id)?.controller.abort();
    const active: ActiveChatRun = {
      controller: new AbortController(),
      guidanceQueue: []
    };
    this.activeRuns.set(session.id, active);
    let runtime: TutorDatabaseRuntime | undefined;
    try {
      runtime = await initializeTutorRuntime();
      active.controller.signal.throwIfAborted();
      const waiting = await findWaitingRun(runtime, session.id);
      if (waiting) {
        const waitingAggregate = await runtime.agentRunRepository.findById(waiting.id);
        const waitingCheckpoint = parseCheckpoint(waitingAggregate?.run.checkpoint.agentLoop);
        if (waitingCheckpoint?.pauseReason === 'budget') {
          if (isAgentCancellation(text)) {
            await aiChatRepository.addMessage({ sessionId: session.id, role: 'user', content: text });
            await runtime.cancelAgentRun.execute({
              agentRunId: waiting.id,
              reason: 'user_cancelled_budget_paused_agent'
            });
            return { handled: true };
          }
          await aiChatRepository.addMessage({ sessionId: session.id, role: 'user', content: text });
          active.runId = waiting.id;
          runtime.agentRunExecutions.register(waiting.id, active.controller);
          active.controller.signal.throwIfAborted();
          await this.resumeBudget(runtime, session, waiting.id, waitingCheckpoint, options, active);
          return { handled: true };
        }
        if (isAgentConfirmation(text) || isAgentCancellation(text)) {
          await aiChatRepository.addMessage({ sessionId: session.id, role: 'user', content: text });
          active.runId = waiting.id; runtime.agentRunExecutions.register(waiting.id, active.controller);
          active.controller.signal.throwIfAborted();
          await this.resume(runtime, session, waiting.id, isAgentConfirmation(text) ? 'confirm' : 'reject', options, active);
          return { handled: true };
        }
        await runtime.cancelAgentRun.execute({
          agentRunId: waiting.id,
          reason: 'user_replaced_pending_agent_action'
        });
      }
      await aiChatRepository.addMessage({ sessionId: session.id, role: 'user', content: text });
      active.controller.signal.throwIfAborted();
      const cycle = await runtime.candidateRepository.findCurrentCycle();
      active.controller.signal.throwIfAborted();
      const aggregate = await runtime.createAgentRun.execute({
        idempotencyKey: `chat-agent:${session.id}:${crypto.randomUUID()}`,
        runType: AgentRunType.TutorTurn,
        examCycleId: cycle?.examCycle.id,
        targetResourceType: TaskTargetType.ChatTool,
        targetResourceId: session.id,
        inputSnapshot: {
          title: 'AI 私教执行',
          detail: compactText(text),
          businessLine: 'tutor',
          category: 'tool',
          chatSessionId: session.id,
          toolName: 'agent_loop',
          scopeKey: `chat-agent:${session.id}`,
          actionParams: {}
        }
      });
      active.runId = aggregate.run.id; runtime.agentRunExecutions.register(aggregate.run.id, active.controller);
      active.controller.signal.throwIfAborted();
      await runtime.transitionAgentRun.execute({
        idempotencyKey: `chat-agent:${aggregate.run.id}:started`,
        agentRunId: aggregate.run.id,
        action: AgentRunAction.Start,
        reasonCode: 'chat_agent.started'
      });
      await this.run(runtime, session, aggregate.run.id, text, undefined, undefined, options, active, options.attachments);
      return { handled: true };
    } catch (error) {
      if (!active.controller.signal.aborted) throw error;
      if (runtime && active.runId) {
        const current = await runtime.agentRunRepository.findById(active.runId);
        if (current?.run.status === 'running' || current?.run.status === 'waiting_user') {
          await runtime.cancelAgentRun.execute({
            agentRunId: current.run.id,
            reason: isAgentRunSuspended(active.controller.signal.reason)
              ? 'app_lifecycle_interrupted_chat_agent'
              : 'user_cancelled_chat_agent'
          });
        }
      }
      return { handled: true };
    } finally {
      if (runtime && active.runId) runtime.agentRunExecutions.finish(active.runId, active.controller.signal);
      if (this.activeRuns.get(session.id) === active) {
        this.activeRuns.delete(session.id);
      }
    }
  }
  private async resume(
    runtime: TutorDatabaseRuntime,
    session: AISession,
    runId: Parameters<TutorDatabaseRuntime['agentRunRepository']['findById']>[0],
    decision: 'confirm' | 'reject',
    options: ChatAgentOptions,
    active: ActiveChatRun
  ): Promise<void> {
    const aggregate = await runtime.agentRunRepository.findById(runId);
    const checkpoint = parseCheckpoint(aggregate?.run.checkpoint.agentLoop);
    if (!aggregate || !checkpoint) throw new Error('待确认的 Agent 上下文已丢失，请重新发起操作。');
    await runtime.transitionAgentRun.execute({
      idempotencyKey: `chat-agent:${runId}:resume:${decision}:${Date.now()}`,
      agentRunId: runId,
      action: AgentRunAction.Resume,
      reasonCode: decision === 'confirm' ? 'chat_agent.confirmed' : 'chat_agent.rejected'
    });
    await this.run(runtime, session, runId, '', checkpoint, decision, options, active);
  }

  private async resumeBudget(
    runtime: TutorDatabaseRuntime,
    session: AISession,
    runId: Parameters<TutorDatabaseRuntime['agentRunRepository']['findById']>[0],
    checkpoint: AgentLoopCheckpoint,
    options: ChatAgentOptions,
    active: ActiveChatRun
  ): Promise<void> {
    await runtime.transitionAgentRun.execute({
      idempotencyKey: `chat-agent:${runId}:resume:budget:${Date.now()}`,
      agentRunId: runId,
      action: AgentRunAction.Resume,
      reasonCode: 'chat_agent.budget_continued'
    });
    await this.run(
      runtime,
      session,
      runId,
      '',
      budgetContinuationCheckpoint(checkpoint),
      undefined,
      options,
      active
    );
  }

  private async run(
    runtime: TutorDatabaseRuntime,
    session: AISession,
    runId: Parameters<TutorDatabaseRuntime['agentRunRepository']['findById']>[0],
    _routingText: string,
    checkpoint: AgentLoopCheckpoint | undefined,
    confirmationDecision: 'confirm' | 'reject' | undefined,
    options: ChatAgentOptions,
    active: ActiveChatRun,
    attachments?: readonly ModelImageContentPart[]
  ): Promise<void> {
    const controller = active.controller;
    controller.signal.throwIfAborted();
    const executor = new AuthorizedAgentToolExecutor(createExecutor(runtime, session.id), new ChatAgentToolAuthorization(runtime, session.id));
    const streamMessageId = `stream:${runId}`;
    let streamedText = '';
    let streamPublished = false;
    let persistedMessageId = '';
    let persistedContent = '';
    const publishAssistant = async (
      messageId: string,
      content: string,
      replaceMessageId?: string
    ) => {
      await options.onAssistantStream?.({
        sessionId: session.id,
        messageId,
        content,
        ...(replaceMessageId ? { replaceMessageId } : {})
      });
    };
    const appendAssistantDelta = async (delta: string) => {
      if (!delta) return;
      streamedText += delta;
      const visibleText = visibleAssistantText(streamedText);
      if (!hasVisibleAssistantContent(visibleText)) return;
      streamPublished = true;
      await publishAssistant(streamMessageId, visibleText);
    };
    const persistAssistant = async (content: string) => {
      if (!content.trim()) return;
      if (persistedMessageId) {
        if (content === persistedContent) return;
        const message = await aiChatRepository.updateMessageContent(session.id, persistedMessageId, content);
        persistedContent = content;
        if (message) await publishAssistant(message.id, message.content);
        return;
      }
      const message = await aiChatRepository.addMessage({
          sessionId: session.id,
          role: 'assistant',
          content,
          toolCallId: runId
      });
      persistedMessageId = message.id;
      persistedContent = message.content;
      await publishAssistant(
        message.id,
        message.content,
        streamPublished ? streamMessageId : undefined
      );
    };
    const observer = {
      onEvent: async (event: AgentRuntimeEvent) => {
        if (event.type === 'text_delta') {
          await appendAssistantDelta(event.text);
          return;
        }
        if (!isToolActivityEvent(event)) return;
        const status = eventStatus(event);
        if (!status) return;
        agentToolActivityService.record({
          chatSessionId: session.id,
          agentRunId: runId,
          call: event.call,
          label: toolLabel(event.call.name),
          status: activityStatus(event),
          ...('resultRef' in event && event.resultRef ? { resultRef: event.resultRef } : {}),
          ...('reasonCode' in event ? { reasonCode: event.reasonCode } : {})
        });
        const current = await runtime.agentRunRepository.findById(runId);
        if (current?.run.status === 'running') {
          const linkedTask = status.taskId
            ? (await runtime.getAgentRunViews.execute({ limit: 50 })).find((run) => run.id === status.taskId)
            : undefined;
          await runtime.updateAgentRunProgress.execute({
            agentRunId: runId,
            step: status.step,
            progress: status.progress,
            message: status.message,
            data: {
              ...(status.toolName ? { toolName: status.toolName } : {}),
              ...(status.taskId ? { taskId: status.taskId } : {}),
              ...chatTaskPresentation(status.toolName),
              ...(linkedTask?.actionRoute ? { actionRoute: linkedTask.actionRoute } : {}),
              ...(linkedTask?.actionParams ? { actionParams: linkedTask.actionParams } : {})
            }
          });
        }
      }
    };
    const history = await aiChatRepository.listMessages(session.id);
    const currentPrompt = history.filter((item) => item.role === 'user').at(-1)?.content || '';
    const currentUserContent: ModelMessage['content'] = attachments?.length
      ? [{ type: 'text', text: currentPrompt }, ...attachments]
      : currentPrompt;
    const preparedContext = await agentConversationMemoryService.prepare(
      runtime,
      session.id,
      currentPrompt,
      currentUserContent
    );
    const exposure = planChatAgentCapabilities({
      preselectedSkillNames: options.invocation?.skillNames,
      pendingToolName: checkpoint?.pendingConfirmation?.name
    });
    const studentContext = await aiStudentContextService.buildContextData();
    const system = chatAgentSystemPromptComposer.compose({
      basePrompt: buildCompanionChatPrompt(options.thinkingEnabled),
      skillCatalog: exposure.skillCatalog
    });
    const groundedSystem = composeGroundedAgentSystem([system, options.invocation?.systemConstraint].filter(Boolean).join('\n\n'));
    const compiledContext = await compileChatAgentContext({
      agentRunId: runId,
      system: groundedSystem,
      studentContext,
      conversation: preparedContext,
      tools: exposure.tools,
    });
    const config = await aiConfigService.load();
    const deadline = createProviderExecutionDeadline(
      controller.signal,
      AI_EXECUTION_BUDGET.chatRunMs,
      '本次 AI 对话'
    );
    try {
      const result = await runtime.createAgentLoop(executor, observer).execute({
        agentRunId: runId,
        system: compiledContext.system,
        messages: compiledContext.messages,
        tools: exposure.tools,
        availableTools: exposure.availableTools,
        skills: exposure.activations,
        executionContext: {
          agentRunId: runId,
          sessionId: session.id
        },
        checkpoint,
        confirmationDecision,
        maxParallelReadToolCalls: config.maxConcurrentTasks,
        consumeGuidance: () => this.consumeGuidance(session.id, runId),
        preferStream: config.streamingEnabled !== false,
      }, await createConfiguredProviderGateway(), deadline.signal);
      if (result.status === 'waiting_user') {
        await persistAssistant(streamedText);
        const call = result.checkpoint.pendingConfirmation;
        await aiChatRepository.addMessage({
          sessionId: session.id,
          role: 'assistant',
          content: confirmationText(call)
        });
        await agentConversationMemoryService.refreshSessionSummary(runtime, session.id);
        await runtime.transitionAgentRun.execute({
          idempotencyKey: `chat-agent:${runId}:waiting:${result.checkpoint.turnCount}`,
          agentRunId: runId,
          action: AgentRunAction.WaitForUser,
          reasonCode: 'chat_agent.confirmation_required'
        });
        return;
      }
      if (result.status === 'budget_exhausted') {
        await persistAssistant(streamedText);
        await aiChatRepository.addMessage({
          sessionId: session.id,
          role: 'assistant',
          content: '这一步已到达本段安全执行边界，进度和工具证据已经保留。你可以直接补充要求或让我继续，我会从当前状态接着处理。'
        });
        await agentConversationMemoryService.refreshSessionSummary(runtime, session.id);
        const current = await runtime.agentRunRepository.findById(runId);
        await runtime.transitionAgentRun.execute({
          idempotencyKey: `chat-agent:${runId}:waiting:budget:${result.checkpoint.turnCount}`,
          agentRunId: runId,
          action: AgentRunAction.WaitForUser,
          reasonCode: 'chat_agent.budget_paused',
          checkpoint: {
            ...(current?.run.checkpoint || {}),
            agentLoop: asJsonObject({
              ...result.checkpoint,
              pauseReason: 'budget'
            })
          }
        });
        return;
      }
      const latest = await runtime.agentRunRepository.findById(runId);
      if (latest?.run.status === 'cancelled') {
        return;
      }
      const visibleStreamedText = visibleAssistantText(streamedText);
      const finalText = visibleAssistantText(result.text);
      const finalContent = finalText && !visibleStreamedText.endsWith(finalText)
        ? [visibleStreamedText, finalText].filter(Boolean).join('\n\n')
        : visibleStreamedText || finalText;
      controller.signal.throwIfAborted();
      await persistAssistant(finalContent);
      await agentConversationMemoryService.refreshSessionSummary(runtime, session.id);
      const current = latest ?? await runtime.agentRunRepository.findById(runId);
      const delegated = result.status === 'delegated';
      const completed = await runtime.transitionAgentRun.execute({
        idempotencyKey: `chat-agent:${runId}:completed`,
        agentRunId: runId,
        action: AgentRunAction.Complete,
        reasonCode: delegated ? 'chat_agent.delegated' : 'chat_agent.completed',
        checkpoint: {
          ...(current?.run.checkpoint || {}),
          progress: 100,
          step: TaskCenterStep.Completed,
          message: delegated ? '任务已受理' : '已完成'
        }
      });
      await publishChatTaskMessage(runtime, completed, 'completed');
    } catch (error) {
      const aborted = controller.signal.aborted;
      const lifecycleInterrupted = isAgentRunSuspended(controller.signal.reason);
      const visibleStreamedText = visibleAssistantText(streamedText);
      const interruptedContent = aborted
        ? ''
        : [
            visibleStreamedText,
            visibleStreamedText
              ? `我已经完成前面的处理，但在整理结果时遇到问题：${chatExecutionFailureText(error)}`
              : chatExecutionFailureText(error)
          ].filter(Boolean).join('\n\n');
      if (interruptedContent) await persistAssistant(interruptedContent);
      if (interruptedContent) {
        await agentConversationMemoryService.refreshSessionSummary(runtime, session.id);
      }
      const current = await runtime.agentRunRepository.findById(runId);
      if (current?.run.status === 'running') {
        const failed = await runtime.transitionAgentRun.execute({
          idempotencyKey: `chat-agent:${runId}:${aborted ? 'cancelled' : 'failed'}:${Date.now()}`,
          agentRunId: runId,
          action: aborted ? AgentRunAction.Cancel : AgentRunAction.Fail,
          reasonCode: aborted ? 'chat_agent.cancelled' : 'chat_agent.failed',
          ...(aborted
            ? {
                cancellationReason: lifecycleInterrupted
                  ? 'app_lifecycle_interrupted_chat_agent'
                  : 'user_cancelled_chat_agent'
              }
            : { errorCode: 'agent.execution_failed' })
        });
        await publishChatTaskMessage(runtime, failed, aborted ? 'cancelled' : 'failed');
      }
    } finally {
      deadline.dispose();
    }
  }

  private consumeGuidance(sessionId: string, runId: string): readonly ModelMessage[] {
    const active = this.activeRuns.get(sessionId);
    if (!active || active.runId !== runId) return [];
    const pending = active.guidanceQueue.splice(0);
    return pending.map((content) => ({
      role: ModelMessageRole.User,
      content: `【用户在执行中补充的引导】\n${content}`
    }));
  }
}

function createExecutor(runtime: TutorDatabaseRuntime, sessionId: string): RegisteredAgentToolExecutor {
  const executor = new RegisteredAgentToolExecutor();
  const practiceLibrary = new AIPracticeLibraryService();
  const questionImport = new QuestionImportAgentService({
    candidates: runtime.candidateRepository,
    curriculums: runtime.curriculumRepository,
    scanDraft: runtime.scanQuestionImportDraft
  });
  registerChatAgentSkillSelector(executor);
  chatAgentBusinessTools.forEach((definition) => {
    executor.register(definition.name, async (call, context) => {
      const result = await aiBusinessTools.execute({
        name: call.name as AIBusinessToolName,
        arguments: call.arguments
      }, { sessionId, idempotencyKey: context.businessIdempotencyKey });
      return {
        content: JSON.stringify({ message: result.reply, taskId: result.taskId ?? null }),
        resultRef: result.taskId,
        ...agentRunCompletionExpectation(result.taskId)
      };
    });
  });
  agentExternalToolCatalog.forEach((definition) => {
    if (definition.name === 'web.search') {
      executor.register(definition.name, async (call, context) => {
        const result = await webResearchService.searchForAgentRun({
          agentRunId: context.agentRunId,
          query: String(call.arguments.query || ''),
          freshness: normalizeFreshness(call.arguments.freshness),
          limit: Number(call.arguments.limit || 5),
          signal: context.signal
        });
        return {
          content: JSON.stringify({
            query: result.query,
            fetchedAt: result.fetchedAt,
            results: result.hits.map((hit) => ({
              title: hit.title,
              url: hit.url,
              domain: hit.domain,
              snippet: (hit.snippet || hit.content || '').slice(0, 1_800),
              publishedAt: hit.publishedAt ?? null
            }))
          }),
          resultRef: result.hits[0]?.url,
          madeProgress: result.hits.length > 0
        };
      });
      return;
    }
    executor.register(definition.name, async (call, context) => {
      const page = await webResearchService.readPageForAgentRun({
        agentRunId: context.agentRunId,
        url: String(call.arguments.url || ''),
        focus: optionalString(call.arguments.focus),
        offset: optionalNumber(call.arguments.offset),
        signal: context.signal
      });
      return {
        content: JSON.stringify(page),
        resultRef: page.url
      };
    });
  });
  chatAgentMemoryTools.forEach((definition) => {
    if (definition.name === 'memory.remember') {
      executor.register(definition.name, async (call) => {
        const record = await agentConversationMemoryService.remember(runtime, sessionId, {
          memoryCode: String(call.arguments.memoryCode || '') as RememberAgentPreferenceInput['memoryCode'],
          statement: String(call.arguments.statement || ''),
          scope: String(call.arguments.scope || '') as RememberAgentPreferenceInput['scope'],
          confidence: optionalNumber(call.arguments.confidence)
        });
        return {
          content: JSON.stringify({ remembered: true, memoryCode: record.memoryCode }),
          resultRef: record.id,
          madeProgress: true
        };
      });
      return;
    }
    executor.register(definition.name, async (call) => {
      const forgotten = await agentConversationMemoryService.forget(
        runtime,
        sessionId,
        String(call.arguments.memoryCode || '') as RememberAgentPreferenceInput['memoryCode'],
        String(call.arguments.scope || '') as RememberAgentPreferenceInput['scope']
      );
      return {
        content: JSON.stringify({ forgotten }),
        madeProgress: true
      };
    });
  });
  executor.register('system.read_clock', async () => readDeviceClock());
  executor.register('tutor.read_daily_context', async () => {
    const context = await runtime.buildTutorDailyContext.execute();
    if (!context) throw new Error('请先建立备考档案。');
    return {
      content: JSON.stringify(context),
      resultRef: String(context.profile.examCycleId || '') || undefined
    };
  });
  executor.register('student.read_profile', async () => {
    const [home, cycle] = await Promise.all([
      runtime.getCandidateHome.execute(),
      runtime.candidateRepository.findCurrentCycle()
    ]);
    const tracks = cycle ? await runtime.masteryRepository.listPriorityTracks(cycle.examCycle.id, 8) : [];
    return {
      content: JSON.stringify({
        candidate: home,
        priorityCapabilities: tracks.map((track) => ({
          capabilityNodeId: track.capabilityNodeId,
          state: track.state,
          accuracy: track.accuracy,
          stability: track.stability,
          confidence: track.confidence,
          effectiveSample: track.effectiveSample
        }))
      }),
      resultRef: home?.examCycleId
    };
  });
  executor.register('workspace.discover', async (call) => ({
    content: JSON.stringify(await agentWorkspaceQueryService.discover(runtime, {
      resourceType: String(call.arguments.resourceType || '') as Parameters<typeof agentWorkspaceQueryService.discover>[1]['resourceType'],
      scope: String(call.arguments.scope || '') as Parameters<typeof agentWorkspaceQueryService.discover>[1]['scope'],
      keyword: optionalString(call.arguments.keyword),
      limit: optionalNumber(call.arguments.limit)
    }))
  }));
  executor.register('task.read_status', async (call) => {
    const result = await agentWorkspaceQueryService.readTaskStatus(runtime, {
      taskId: optionalString(call.arguments.taskId),
      scope: optionalString(call.arguments.scope) as Parameters<typeof agentWorkspaceQueryService.readTaskStatus>[1]['scope'],
      intent: optionalString(call.arguments.intent),
      limit: optionalNumber(call.arguments.limit)
    });
    const task = result.task && typeof result.task === 'object' && !Array.isArray(result.task)
      ? result.task as Record<string, unknown>
      : undefined;
    return {
      content: JSON.stringify(result),
      resultRef: typeof task?.taskId === 'string' ? task.taskId : undefined,
      madeProgress: true,
      completionVerification: agentRunCompletionVerification(result, optionalString(call.arguments.taskId))
    };
  });
  executor.register('practice.read_library', async (call) => {
    const snapshot = await practiceLibrary.read(runtime, {
      scope: String(call.arguments.scope || '') as Parameters<AIPracticeLibraryService['read']>[1]['scope'],
      entryMode: String(call.arguments.entryMode || 'all') as Parameters<AIPracticeLibraryService['read']>[1]['entryMode'],
      module: String(call.arguments.module || ''),
      capabilityKeyword: String(call.arguments.capabilityKeyword || ''),
      limit: Number(call.arguments.limit || 5)
    });
    return {
      content: JSON.stringify(snapshot),
      resultRef: snapshot.sets[0]?.questionSetId || snapshot.activeTasks[0]?.taskId
    };
  });
  executor.register('practice.read_question_set', async (call) => {
    const result = await practiceLibrary.readQuestionSet(runtime, {
      questionSetId: String(call.arguments.questionSetId || ''),
      section: String(call.arguments.section || '') as Parameters<AIPracticeLibraryService['readQuestionSet']>[1]['section'],
      offset: Number(call.arguments.offset || 0),
      limit: Number(call.arguments.limit || 3)
    });
    return {
      content: JSON.stringify(result),
      resultRef: String(call.arguments.questionSetId || '')
    };
  });
  executor.register('learning.review_session', async (call) => {
    const sessionId = String(call.arguments.sessionId || '').trim();
    if (!sessionId) throw new Error('读取练习复盘需要明确 sessionId。');
    const review = await runtime.getObjectiveSessionReview.execute(
      sessionId as Parameters<TutorDatabaseRuntime['getObjectiveSessionReview']['execute']>[0]
    );
    const cycle = await runtime.candidateRepository.findCurrentCycle();
    if (!review || !cycle || review.session.examCycleId !== cycle.examCycle.id) {
      throw new Error('当前备考档案中没有找到该练习记录。');
    }
    return {
      content: JSON.stringify({
        session: {
          sessionId: review.session.id,
          questionSetId: review.session.questionSetId,
          completedAt: review.session.completedAt,
          questionCount: review.session.questionCount,
          answeredCount: review.session.answeredCount,
          correctCount: review.session.correctCount
        },
        items: review.items.map((item) => ({
          questionId: item.question.id,
          sequence: item.question.sequence,
          result: item.grading.result,
          diagnoses: item.diagnoses
            .filter((diagnosis) => diagnosis.source === 'tutor_ai' || diagnosis.source === 'user')
            .map((diagnosis) => ({
              causeCode: diagnosis.causeCode,
              detail: diagnosis.detail,
              confidence: diagnosis.confidence,
              confirmationStatus: diagnosis.confirmationStatus
            }))
        }))
      }),
      resultRef: review.session.id
    };
  });
  executor.register('teaching.request_practice', async (call, context) => {
    const result = await aiBusinessTools.execute({
      name: 'generate_practice',
      arguments: {
        module: call.arguments.module,
        knowledgePoint: call.arguments.knowledgePoint,
        questionCount: call.arguments.questionCount,
        difficulty: call.arguments.difficulty
      }
    }, { sessionId, idempotencyKey: context.businessIdempotencyKey });
    return {
      content: JSON.stringify({ message: result.reply, taskId: result.taskId ?? null }),
      resultRef: result.taskId,
      ...agentRunCompletionExpectation(result.taskId)
    };
  });
  executor.register('file.read_text', (call) => agentFileReader.read(call.arguments));
  executor.register('question_bank.scan', async (call, context) => {
    context.signal?.throwIfAborted();
    const view = await questionImport.scan(call.arguments, {
      agentRunId: context.agentRunId,
      callId: call.id,
      ownerSessionId: sessionId,
      importedBy: 'chat_agent'
    });
    return { content: JSON.stringify(view), resultRef: view.draftId };
  });
  executor.register('question_bank.resume', async () => {
    const aggregate = await runtime.questionImportDraftRepository.findLatestPendingByOwner(sessionId);
    if (!aggregate) {
      return { content: JSON.stringify({ found: false }), terminalText: '上一次没有生成可继续的题库草稿，且历史图片已失效。请重新选择原 PDF 或题目图片后再导入。' };
    }
    return {
      content: JSON.stringify({
        found: true,
        draftId: aggregate.draft.id,
        status: aggregate.draft.status,
        version: aggregate.draft.version,
        source: {
          sourceType: aggregate.draft.sourceType,
          examYear: aggregate.draft.sourceMetadata.examYear ?? null,
          paperName: aggregate.draft.sourceMetadata.paperName ?? null
        },
        candidates: aggregate.candidates.map((candidate) => ({
          candidateId: candidate.id,
          sequence: candidate.sequence,
          status: candidate.status,
          issues: candidate.issues
        }))
      }),
      resultRef: aggregate.draft.id
    };
  });
  registerQuestionImportRepairTool(executor, runtime);
  executor.register('question_bank.confirm', async (call, context) => {
    context.signal?.throwIfAborted();
    const replacements = Array.isArray(call.arguments.replacements)
      ? call.arguments.replacements.map((item) => {
          const row = asJsonRecord(item);
          return {
            candidateId: String(row.candidateId || '') as QuestionImportCandidateId,
            raw: asJsonRecord(row.question),
            difficulty: optionalNumber(asJsonRecord(row.question).difficulty)
          };
        })
      : [];
    const rejectedCandidateIds = Array.isArray(call.arguments.rejectedCandidateIds)
      ? call.arguments.rejectedCandidateIds.map((id) => String(id) as QuestionImportCandidateId)
      : [];
    const view = await runtime.confirmQuestionImportDraft.execute({
      draftId: String(call.arguments.draftId || '') as QuestionImportDraftId,
      expectedVersion: Number(call.arguments.expectedVersion),
      replacements,
      rejectedCandidateIds
    });
    return { content: JSON.stringify(view), resultRef: view.draftId };
  });
  executor.register('question_bank.publish', async (call, context) => {
    context.signal?.throwIfAborted();
    const result = await runtime.publishQuestionImportDraft.execute({
      draftId: String(call.arguments.draftId || '') as QuestionImportDraftId,
      expectedVersion: Number(call.arguments.expectedVersion),
      idempotencyKey: context.businessIdempotencyKey ?? `chat-agent:${context.agentRunId}:${call.id}:question-publish`
    });
    return { content: JSON.stringify(result), resultRef: result.questionSetId };
  });
  executor.register('planning.propose_daily_plan', async () => {
    const cycle = await runtime.candidateRepository.findCurrentCycle();
    if (!cycle) throw new Error('请先建立备考档案。');
    const minutes = isWeekend() ? cycle.studyConstraints.weekendMinutes : cycle.studyConstraints.weekdayMinutes;
    const proposal = await runtime.buildDailyPlanProposal.execute({
      examCycleId: cycle.examCycle.id,
      availableMinutes: Math.max(5, minutes),
      examDate: cycle.examCycle.examDate,
      phase: cycle.examCycle.phase
    });
    return { content: JSON.stringify(proposal), resultRef: cycle.examCycle.id };
  });
  executor.register('candidate.change_target', async (call, context) => {
    const cycle = await runtime.candidateRepository.findCurrentCycle();
    if (!cycle) throw new Error('请先建立备考档案。');
    const subject = String(call.arguments.subject || '') as SubjectCode;
    const previous = cycle.scoreTargets.find((target) => target.subject === subject && target.status === 'active');
    if (!previous) throw new Error('没有找到对应科目的当前目标。');
    const targetScore = Number(call.arguments.targetScore);
    await runtime.updateScoreTargets.execute({
      idempotencyKey: context.businessIdempotencyKey ?? `chat-agent:${sessionId}:target:${subject}:${targetScore}`,
      examCycleId: cycle.examCycle.id,
      changes: [{
        subject,
        targetScore,
        maxScore: previous.maxScore,
        reason: '用户在 AI 对话中确认修改'
      }]
    });
    return {
      content: JSON.stringify({ subject, targetScore, updated: true }),
      resultRef: cycle.examCycle.id
    };
  });
  return executor;
}
function shouldUseAgent(text: string): boolean {
  return Boolean(text.trim());
}
export const chatAgentService = new ChatAgentService();
