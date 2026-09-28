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
import type { AgentRunId } from '@/kernel/public';
import {
  AgentRunAction,
  AgentRunType,
  AuthorizedAgentToolExecutor,
  AgentRunSuspendedError,
  isAgentRunSuspended,
  TaskCenterStep,
  TaskTargetType,
  type AgentLoopCheckpoint,
  type AgentRuntimeEvent,
  type AgentWorkflowInvocation
} from '@/modules/agent/public';
import { aiChatRepository } from './AIChatRepository';
import { aiConfigService } from './AIConfigService';
import { aiStudentContextService } from './AIStudentContextService';
import { agentToolActivityService } from './AgentToolActivityService';
import { isAgentCancellation, isAgentConfirmation } from './AgentConfirmationReply';
import {
  chatExecutionFailureText,
  hasVisibleAssistantContent,
  visibleAssistantText
} from './AgentResponsePresentation';
import { chatTaskPresentation, publishChatTaskMessage } from './ChatAgentTaskPresentation';
import { compileChatAgentContext } from './ChatAgentContextCompiler';
import {
  chatAgentSystemPromptComposer,
  planChatAgentCapabilities,
} from './ChatAgentCapabilities';
import { createChatAgentToolExecutor } from './ChatAgentToolExecutors';
import { composeGroundedAgentSystem } from './AgentSystemTools';
import { ChatAgentToolAuthorization } from './ChatAgentToolAuthorization';
import { agentConversationMemoryService } from './AgentConversationMemoryService';
import {
  activityStatus,
  asJsonObject,
  budgetContinuationCheckpoint,
  compactText,
  confirmationText,
  eventStatus,
  findWaitingRun,
  isToolActivityEvent,
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
    const executor = new AuthorizedAgentToolExecutor(createChatAgentToolExecutor(runtime, session.id), new ChatAgentToolAuthorization(runtime, session.id));
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
      console.warn('[ChatAgent] execution failed', {
        runId,
        name: error instanceof Error ? error.name : 'UnknownError',
        message: error instanceof Error ? error.message : String(error)
      });
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

function shouldUseAgent(text: string): boolean {
  return Boolean(text.trim());
}
export const chatAgentService = new ChatAgentService();
