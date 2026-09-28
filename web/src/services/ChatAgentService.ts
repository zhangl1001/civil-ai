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
import { isProviderConfigured } from '@/composition-root/ai/createConfiguredProviderGateway';
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
  type AgentLoopResult,
  type AgentWorkflowInvocation
} from '@/modules/agent/public';
import { aiChatRepository } from './AIChatRepository';
import { aiConfigService } from './AIConfigService';
import { aiStudentContextService } from './AIStudentContextService';
import { classifyAgentConfirmationReply } from './AgentConfirmationReply';
import { visibleAssistantText } from './AgentResponsePresentation';
import { publishChatTaskMessage } from './ChatAgentTaskPresentation';
import { compileChatAgentContext } from './ChatAgentContextCompiler';
import {
  chatAgentSystemPromptComposer,
  planChatAgentCapabilities,
} from './ChatAgentCapabilities';
import { ChatFailureCode, chatFailureForCode, describeChatFailure } from './ChatAgentFailure';
import { createChatRunObserver } from './ChatAgentRunObserver';
import { createChatAgentToolExecutor } from './ChatAgentToolExecutors';
import { ChatAgentTurnWriter, type ChatAssistantStreamUpdate } from './ChatAgentTurnWriter';
import { composeGroundedAgentSystem } from './AgentSystemTools';
import { ChatAgentToolAuthorization } from './ChatAgentToolAuthorization';
import { agentConversationMemoryService } from './AgentConversationMemoryService';
import {
  asJsonObject,
  budgetContinuationCheckpoint,
  compactText,
  confirmationText,
  findWaitingRun,
  parseCheckpoint,
  pendingConfirmationReminder
} from './ChatAgentRuntimeSupport';
export interface ChatAgentResult {
  readonly handled: boolean;
}
export type { ChatAssistantStreamUpdate } from './ChatAgentTurnWriter';
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
  readonly writer: ChatAgentTurnWriter;
  userMessagePersisted: boolean;
}
type RunId = Parameters<TutorDatabaseRuntime['agentRunRepository']['findById']>[0];
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
      guidanceQueue: [],
      writer: new ChatAgentTurnWriter({
        sessionId: session.id,
        streamMessageId: `stream:${crypto.randomUUID()}`,
        repository: aiChatRepository,
        publish: options.onAssistantStream
      }),
      userMessagePersisted: false
    };
    this.activeRuns.set(session.id, active);
    let runtime: TutorDatabaseRuntime | undefined;
    try {
      if (!isProviderConfigured(await aiConfigService.load())) {
        // Nothing can run without a model: answer locally before any durable run exists.
        await this.addUserMessage(session, text, active);
        await active.writer.fail(chatFailureForCode(ChatFailureCode.NotConfigured));
        return { handled: true };
      }
      runtime = await initializeTutorRuntime();
      active.controller.signal.throwIfAborted();
      const waiting = await findWaitingRun(runtime, session.id);
      if (waiting) {
        const waitingAggregate = await runtime.agentRunRepository.findById(waiting.id);
        const waitingCheckpoint = parseCheckpoint(waitingAggregate?.run.checkpoint.agentLoop);
        const decision = classifyAgentConfirmationReply(text);
        if (waitingCheckpoint?.pauseReason === 'budget') {
          await this.addUserMessage(session, text, active);
          if (decision === 'reject') {
            await runtime.cancelAgentRun.execute({
              agentRunId: waiting.id,
              reason: 'user_cancelled_budget_paused_agent'
            });
            return { handled: true };
          }
          active.runId = waiting.id;
          runtime.agentRunExecutions.register(waiting.id, active.controller);
          active.controller.signal.throwIfAborted();
          await this.resumeBudget(runtime, session, waiting.id, waitingCheckpoint, options, active);
          return { handled: true };
        }
        if (decision !== 'ambiguous') {
          await this.addUserMessage(session, text, active);
          active.runId = waiting.id; runtime.agentRunExecutions.register(waiting.id, active.controller);
          active.controller.signal.throwIfAborted();
          await this.resume(runtime, session, waiting.id, decision, options, active);
          return { handled: true };
        }
        if (waitingCheckpoint?.pendingConfirmation) {
          // Neither yes nor no: keep the pending action and ask again rather
          // than cancelling it and letting the model re-ask in a loop.
          await this.addUserMessage(session, text, active);
          await active.writer.complete(pendingConfirmationReminder(waitingCheckpoint.pendingConfirmation));
          return { handled: true };
        }
        await runtime.cancelAgentRun.execute({
          agentRunId: waiting.id,
          reason: 'user_replaced_pending_agent_action'
        });
      }
      await this.addUserMessage(session, text, active);
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
      await this.run(runtime, session, aggregate.run.id, undefined, undefined, options, active, options.attachments);
      return { handled: true };
    } catch (error) {
      if (!active.controller.signal.aborted) {
        // Before the question is on screen the composer can simply keep the draft.
        if (!active.userMessagePersisted) throw error;
        await this.recordFailure(runtime, active, error);
        return { handled: true };
      }
      if (active.userMessagePersisted && !active.writer.isFinished) await this.recordStop(active);
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
  private async addUserMessage(session: AISession, text: string, active: ActiveChatRun): Promise<void> {
    await aiChatRepository.addMessage({ sessionId: session.id, role: 'user', content: text });
    active.userMessagePersisted = true;
  }
  private async resume(
    runtime: TutorDatabaseRuntime,
    session: AISession,
    runId: RunId,
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
    await this.run(runtime, session, runId, checkpoint, decision, options, active);
  }

  private async resumeBudget(
    runtime: TutorDatabaseRuntime,
    session: AISession,
    runId: RunId,
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
    await this.run(runtime, session, runId, budgetContinuationCheckpoint(checkpoint), undefined, options, active);
  }

  private async run(
    runtime: TutorDatabaseRuntime,
    session: AISession,
    runId: RunId,
    checkpoint: AgentLoopCheckpoint | undefined,
    confirmationDecision: 'confirm' | 'reject' | undefined,
    options: ChatAgentOptions,
    active: ActiveChatRun,
    attachments?: readonly ModelImageContentPart[]
  ): Promise<void> {
    const { controller, writer } = active;
    writer.bindRun(runId);
    const deadline = createProviderExecutionDeadline(
      controller.signal,
      AI_EXECUTION_BUDGET.chatRunMs,
      '本次 AI 对话'
    );
    try {
      controller.signal.throwIfAborted();
      const executor = new AuthorizedAgentToolExecutor(createChatAgentToolExecutor(runtime, session.id), new ChatAgentToolAuthorization(runtime, session.id));
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
      const gateway = await createConfiguredProviderGateway(config);
      const result = await runtime.createAgentLoop(executor, createChatRunObserver(runtime, session.id, runId, writer)).execute({
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
      }, gateway, deadline.signal);
      await this.settle(runtime, session, runId, result, active);
    } catch (error) {
      if (controller.signal.aborted) await this.settleAbort(runtime, runId, active);
      else await this.recordFailure(runtime, active, error);
    } finally {
      deadline.dispose();
      writer.dispose();
    }
  }

  private async settle(
    runtime: TutorDatabaseRuntime,
    session: AISession,
    runId: RunId,
    result: AgentLoopResult,
    active: ActiveChatRun
  ): Promise<void> {
    const { controller, writer } = active;
    if (result.status === 'waiting_user' || result.status === 'budget_exhausted') {
      const waiting = result.status === 'waiting_user';
      await writer.persist(writer.visibleText);
      await aiChatRepository.addMessage({
        sessionId: session.id,
        role: 'assistant',
        content: waiting ? confirmationText(result.checkpoint.pendingConfirmation) : BUDGET_PAUSE_TEXT
      });
      await agentConversationMemoryService.refreshSessionSummary(runtime, session.id);
      const current = waiting ? undefined : await runtime.agentRunRepository.findById(runId);
      await runtime.transitionAgentRun.execute({
        idempotencyKey: `chat-agent:${runId}:waiting:${waiting ? '' : 'budget:'}${result.checkpoint.turnCount}`,
        agentRunId: runId,
        action: AgentRunAction.WaitForUser,
        reasonCode: waiting ? 'chat_agent.confirmation_required' : 'chat_agent.budget_paused',
        ...(waiting ? {} : {
          checkpoint: {
            ...(current?.run.checkpoint || {}),
            agentLoop: asJsonObject({ ...result.checkpoint, pauseReason: 'budget' })
          }
        })
      });
      return;
    }
    const latest = await runtime.agentRunRepository.findById(runId);
    if (latest?.run.status === 'cancelled') {
      // Cancelled elsewhere (e.g. the task bar) while the model finished.
      await this.recordStop(active);
      return;
    }
    // The answer is the final turn only; preambles of tool-calling turns were provisional.
    const finalContent = visibleAssistantText(result.text) || writer.visibleText;
    controller.signal.throwIfAborted();
    await writer.complete(finalContent);
    await agentConversationMemoryService.refreshSessionSummary(runtime, session.id);
    const delegated = result.status === 'delegated';
    const completed = await runtime.transitionAgentRun.execute({
      idempotencyKey: `chat-agent:${runId}:completed`,
      agentRunId: runId,
      action: AgentRunAction.Complete,
      reasonCode: delegated ? 'chat_agent.delegated' : 'chat_agent.completed',
      checkpoint: {
        ...(latest?.run.checkpoint || {}),
        progress: 100,
        step: TaskCenterStep.Completed,
        message: delegated ? '任务已受理' : '已完成'
      }
    });
    await publishChatTaskMessage(runtime, completed, 'completed');
  }

  private async settleAbort(runtime: TutorDatabaseRuntime, runId: RunId, active: ActiveChatRun): Promise<void> {
    await this.recordStop(active);
    const current = await runtime.agentRunRepository.findById(runId);
    if (current?.run.status !== 'running') return;
    const cancelled = await runtime.transitionAgentRun.execute({
      idempotencyKey: `chat-agent:${runId}:cancelled:${Date.now()}`,
      agentRunId: runId,
      action: AgentRunAction.Cancel,
      reasonCode: 'chat_agent.cancelled',
      cancellationReason: isAgentRunSuspended(active.controller.signal.reason)
        ? 'app_lifecycle_interrupted_chat_agent'
        : 'user_cancelled_chat_agent'
    });
    await publishChatTaskMessage(runtime, cancelled, 'cancelled');
  }

  /** A stop is the user's choice, not a failure: keep what was shown and mark it stopped. */
  private async recordStop(active: ActiveChatRun): Promise<void> {
    if (active.writer.hasCompletedAnswer) return;
    const reason = active.controller.signal.aborted
      ? describeChatFailure(active.controller.signal.reason)
      : chatFailureForCode(ChatFailureCode.Stopped);
    await active.writer.stop(reason).catch((error: unknown) => {
      console.warn('[ChatAgent] stopped turn was not saved', error);
    });
  }

  /** Shows why the turn failed and fails its run with the same stable code. */
  private async recordFailure(
    runtime: TutorDatabaseRuntime | undefined,
    active: ActiveChatRun,
    error: unknown
  ): Promise<void> {
    const failure = describeChatFailure(error);
    console.warn('[ChatAgent] execution failed', {
      runId: active.runId,
      code: failure.code,
      name: error instanceof Error ? error.name : 'UnknownError',
      message: error instanceof Error ? error.message : String(error)
    });
    // A finished answer stays an answer even if later bookkeeping failed.
    if (!active.writer.hasCompletedAnswer) {
      await active.writer.fail(failure).catch((persistError: unknown) => {
        console.warn('[ChatAgent] failure outcome was not saved', persistError);
      });
    }
    if (!runtime || !active.runId) return;
    const runId = active.runId;
    try {
      const current = await runtime.agentRunRepository.findById(runId);
      if (current?.run.status !== 'running') return;
      const failed = await runtime.transitionAgentRun.execute({
        idempotencyKey: `chat-agent:${runId}:failed:${Date.now()}`,
        agentRunId: runId,
        action: AgentRunAction.Fail,
        reasonCode: 'chat_agent.failed',
        errorCode: failure.code
      });
      await publishChatTaskMessage(runtime, failed, 'failed');
    } catch (transitionError) {
      console.warn('[ChatAgent] failed run was not closed', { runId, transitionError });
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

const BUDGET_PAUSE_TEXT = '这一步已到达本段安全执行边界，进度和工具证据已经保留。你可以直接补充要求或让我继续，我会从当前状态接着处理。';

function shouldUseAgent(text: string): boolean {
  return Boolean(text.trim());
}
export const chatAgentService = new ChatAgentService();
