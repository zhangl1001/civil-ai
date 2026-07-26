import { buildChatContext } from '@/ai/ChatContextBuilder';
import { buildCompanionChatPrompt } from '@/ai/prompts';
import {
  AI_EXECUTION_BUDGET,
  createProviderExecutionDeadline,
  ModelMessageRole,
  type ModelMessage,
  type ModelToolCall
} from '@/capabilities/ai-runtime/public';
import {
  createConfiguredProviderGateway,
  initializeTutorRuntime,
  type TutorDatabaseRuntime
} from '@/composition-root/public';
import type { AISession } from '@/domain/ai';
import type { AIMessage } from '@/domain/ai';
import type { AgentRunId, JsonObject, SubjectCode } from '@/kernel/public';
import {
  AgentRunAction,
  AgentRunType,
  AgentToolRisk,
  RegisteredAgentToolExecutor,
  TaskCenterStep,
  TaskTargetType,
  tutorToolCatalog,
  type AgentLoopCheckpoint,
  type AgentRuntimeEvent,
  type AgentToolDefinition
} from '@/modules/agent/public';
import { aiBusinessTools, type AIBusinessToolName } from './AIBusinessTools';
import { aiChatRepository } from './AIChatRepository';
import { aiConfigService } from './AIConfigService';
import { AIPracticeLibraryService } from './AIPracticeLibraryService';
import { aiStudentContextService } from './AIStudentContextService';
import { agentToolActivityService, type AgentToolActivityStatus } from './AgentToolActivityService';
import { fileRepository } from './FileRepository';
import { projectRepository } from './ProjectRepository';

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
}

const businessTools: readonly AgentToolDefinition[] = aiBusinessTools.definitions()
  .filter((tool) => tool.name !== 'generate_practice')
  .map((tool) => ({
    code: tool.name,
    description: tool.description,
    inputSchema: tool.parameters as unknown as JsonObject,
    risk: AgentToolRisk.Write,
    requiresConfirmation: false,
    enabledFor: ['tutor_turn']
  }));
const catalogChatTools = tutorToolCatalog.filter((tool) => (
  tool.code === 'student.read_profile'
  || tool.code === 'practice.read_library'
  || tool.code === 'practice.read_question_set'
  || tool.code === 'learning.review_session'
  || tool.code === 'teaching.request_practice'
  || tool.code === 'file.read_text'
  || tool.code === 'planning.propose_daily_plan'
  || tool.code === 'candidate.change_target'
));
const chatTools = [...catalogChatTools, ...businessTools];

interface ActiveChatRun {
  runId?: AgentRunId;
  readonly controller: AbortController;
  readonly guidanceQueue: string[];
}

export class ChatAgentService {
  private readonly activeRuns = new Map<string, ActiveChatRun>();

  cancel(sessionId?: string): void {
    if (sessionId) {
      this.activeRuns.get(sessionId)?.controller.abort();
      return;
    }
    this.activeRuns.forEach((run) => run.controller.abort());
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
        if (isConfirm(text) || isCancel(text)) {
          await aiChatRepository.addMessage({ sessionId: session.id, role: 'user', content: text });
          active.runId = waiting.id;
          active.controller.signal.throwIfAborted();
          await this.resume(runtime, session, waiting.id, isConfirm(text) ? 'confirm' : 'reject', options, active);
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
      active.runId = aggregate.run.id;
      active.controller.signal.throwIfAborted();
      await runtime.transitionAgentRun.execute({
        idempotencyKey: `chat-agent:${aggregate.run.id}:started`,
        agentRunId: aggregate.run.id,
        action: AgentRunAction.Start,
        reasonCode: 'chat_agent.started'
      });
      await this.run(runtime, session, aggregate.run.id, undefined, undefined, options, active);
      return { handled: true };
    } catch (error) {
      if (!active.controller.signal.aborted) throw error;
      if (runtime && active.runId) {
        const current = await runtime.agentRunRepository.findById(active.runId);
        if (current?.run.status === 'running' || current?.run.status === 'waiting_user') {
          await runtime.cancelAgentRun.execute({
            agentRunId: current.run.id,
            reason: 'user_cancelled_chat_agent'
          });
        }
      }
      return { handled: true };
    } finally {
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
    await this.run(runtime, session, runId, checkpoint, decision, options, active);
  }

  private async run(
    runtime: TutorDatabaseRuntime,
    session: AISession,
    runId: Parameters<TutorDatabaseRuntime['agentRunRepository']['findById']>[0],
    checkpoint: AgentLoopCheckpoint | undefined,
    confirmationDecision: 'confirm' | 'reject' | undefined,
    options: ChatAgentOptions,
    active: ActiveChatRun
  ): Promise<void> {
    const controller = active.controller;
    controller.signal.throwIfAborted();
    const executor = createExecutor(runtime, session.id);
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
              ...(linkedTask?.actionRoute ? { actionRoute: linkedTask.actionRoute } : {}),
              ...(linkedTask?.actionParams ? { actionParams: linkedTask.actionParams } : {})
            }
          });
        }
      }
    };
    const history = await aiChatRepository.listMessages(session.id);
    const messages: ModelMessage[] = [
      ...buildChatContext(history, { currentPrompt: history.at(-1)?.content || '' }).map((item) => ({
        role: item.role === 'assistant' ? ModelMessageRole.Assistant : ModelMessageRole.User,
        content: item.content
      })),
      { role: ModelMessageRole.User, content: history.filter((item) => item.role === 'user').at(-1)?.content || '' }
    ];
    const studentContext = await aiStudentContextService.buildSystemContext();
    const system = [
      buildCompanionChatPrompt(options.thinkingEnabled, studentContext, session.summary || ''),
      '',
      '# Agent 执行规则',
      '- 你是主动负责学习结果的私教，不是客服。',
      '- 只有用户明确要求执行操作时才调用写工具；意图、模块或题量不明确时先用自然语言确认，不要猜。',
      '- 用户要求执行操作但范围、内容、模块、题量或时间不明确时，先向用户确认；确认前不要扩大范围读取或派发任务。',
      '- 读取工具可以按需调用；不要重复调用相同工具和参数。',
      '- 用户询问题组是否生成、题库记录或练习生成状态时，必须先调用 practice.read_library 获取本地事实，不得根据会话记忆猜测。泛问题库是否有数据时用 scope=all，不得用 today 或 active 的空结果代表整个题库。',
      '- 需要了解某个题组内容时，只能使用目录返回的 questionSetId 调用 practice.read_question_set，并按 overview、lecture 或最多 5 道 questions 分页读取；不要扫描无关题组。',
      '- practice.read_question_set 的 overview 会返回该题组最近练习 sessionId；需要判断用户是否做过、答得怎样或错在哪里时，再调用 learning.review_session，不能只看题组存在就推断学习结果。',
      '- 用户明确要求围绕当前能力或错因继续训练时，可调用 teaching.request_practice。模块、考点或题量不明确时先确认。',
      '- 题库工具返回的标准答案属于内部教学事实，除非用户明确要求或已经完成该题，否则不要直接泄露答案。',
      '- 用户导入文件后，必须按需调用 file.read_text 读取，不要假装已经看过文件。',
      '- 工具只提供简要描述，具体业务规则由本地工具执行。',
      '- 工具返回任务 ID 时，告诉用户任务已进入任务栏，不要伪造已完成结果。',
      '- 不输出内部思考过程。最终回复使用简洁 Markdown。'
    ].join('\n');
    const config = await aiConfigService.load();
    const deadline = createProviderExecutionDeadline(
      controller.signal,
      AI_EXECUTION_BUDGET.chatRunMs,
      '本次 AI 对话'
    );
    try {
      const result = await runtime.createAgentLoop(executor, observer).execute({
        agentRunId: runId,
        system,
        messages,
        tools: chatTools,
        executionContext: {
          agentRunId: runId,
          sessionId: session.id
        },
        checkpoint,
        confirmationDecision,
        maxTurns: 6,
        maxToolCalls: 8,
        maxToolCallsPerTurn: 2,
        consumeGuidance: () => this.consumeGuidance(session.id, runId),
        preferStream: config.streamingEnabled !== false
      }, await createConfiguredProviderGateway(), deadline.signal);
      if (result.status === 'waiting_user') {
        await persistAssistant(streamedText);
        const call = result.checkpoint.pendingConfirmation;
        await aiChatRepository.addMessage({
          sessionId: session.id,
          role: 'assistant',
          content: confirmationText(call)
        });
        await runtime.transitionAgentRun.execute({
          idempotencyKey: `chat-agent:${runId}:waiting:${result.checkpoint.turnCount}`,
          agentRunId: runId,
          action: AgentRunAction.WaitForUser,
          reasonCode: 'chat_agent.confirmation_required'
        });
        return;
      }
      if (result.status === 'budget_exhausted') throw new Error('Agent 执行达到安全上限，请缩小任务范围后重试。');
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
      const current = latest ?? await runtime.agentRunRepository.findById(runId);
      await runtime.transitionAgentRun.execute({
        idempotencyKey: `chat-agent:${runId}:completed`,
        agentRunId: runId,
        action: AgentRunAction.Complete,
        reasonCode: 'chat_agent.completed',
        checkpoint: {
          ...(current?.run.checkpoint || {}),
          progress: 100,
          step: TaskCenterStep.Completed,
          message: '已完成'
        }
      });
    } catch (error) {
      const aborted = controller.signal.aborted;
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
      const current = await runtime.agentRunRepository.findById(runId);
      if (current?.run.status === 'running') {
        await runtime.transitionAgentRun.execute({
          idempotencyKey: `chat-agent:${runId}:${aborted ? 'cancelled' : 'failed'}:${Date.now()}`,
          agentRunId: runId,
          action: aborted ? AgentRunAction.Cancel : AgentRunAction.Fail,
          reasonCode: aborted ? 'chat_agent.cancelled' : 'chat_agent.failed',
          ...(aborted
            ? { cancellationReason: 'user_cancelled_chat_agent' }
            : { errorCode: 'agent.execution_failed' })
        });
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
  businessTools.forEach((definition) => {
    executor.register(definition.code, async (call) => {
      const result = await aiBusinessTools.execute({
        name: call.name as AIBusinessToolName,
        arguments: call.arguments
      }, { sessionId });
      return {
        content: JSON.stringify({ message: result.reply, taskId: result.taskId ?? null }),
        resultRef: result.taskId
      };
    });
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
  executor.register('teaching.request_practice', async (call) => {
    const result = await aiBusinessTools.execute({
      name: 'generate_practice',
      arguments: {
        module: call.arguments.module,
        knowledgePoint: call.arguments.knowledgePoint,
        questionCount: call.arguments.questionCount,
        difficulty: call.arguments.difficulty
      }
    }, { sessionId });
    return {
      content: JSON.stringify({ message: result.reply, taskId: result.taskId ?? null }),
      resultRef: result.taskId
    };
  });
  executor.register('file.read_text', async (call) => {
    const path = String(call.arguments.path || '').trim();
    if (!path || path.includes('..') || !path.startsWith('导入资料/')) {
      throw new Error('只能读取当前对话已经导入的资料文件。');
    }
    const project = await projectRepository.getActiveProject();
    const content = await fileRepository.readText(project.id, path);
    if (!content) throw new Error('没有找到这个导入文件。');
    return {
      content: content.slice(0, 24_000),
      resultRef: path
    };
  });
  executor.register('planning.propose_daily_plan', async () => {
    const cycle = await runtime.candidateRepository.findCurrentCycle();
    if (!cycle) throw new Error('请先建立备考档案。');
    const minutes = isWeekend() ? cycle.studyConstraints.weekendMinutes : cycle.studyConstraints.weekdayMinutes;
    const proposal = await runtime.buildDailyPlanProposal.execute({
      examCycleId: cycle.examCycle.id,
      availableMinutes: Math.max(5, minutes)
    });
    return { content: JSON.stringify(proposal), resultRef: cycle.examCycle.id };
  });
  executor.register('candidate.change_target', async (call) => {
    const cycle = await runtime.candidateRepository.findCurrentCycle();
    if (!cycle) throw new Error('请先建立备考档案。');
    const subject = String(call.arguments.subject || '') as SubjectCode;
    const previous = cycle.scoreTargets.find((target) => target.subject === subject && target.status === 'active');
    if (!previous) throw new Error('没有找到对应科目的当前目标。');
    const targetScore = Number(call.arguments.targetScore);
    await runtime.updateScoreTargets.execute({
      idempotencyKey: `chat-agent:${sessionId}:target:${subject}:${targetScore}`,
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

function eventStatus(event: AgentRuntimeEvent): {
  readonly message: string;
  readonly toolName?: string;
  readonly taskId?: string;
  readonly step: Parameters<TutorDatabaseRuntime['updateAgentRunProgress']['execute']>[0]['step'];
  readonly progress: number;
} | undefined {
  if (event.type === 'tool_call_requested') {
    return { message: `准备执行 · ${toolLabel(event.call.name)}`, toolName: event.call.name, step: TaskCenterStep.ResolvingPlan, progress: 28 };
  }
  if (event.type === 'tool_call_started') {
    return { message: `正在执行 · ${toolLabel(event.call.name)}`, toolName: event.call.name, step: TaskCenterStep.InvokingModel, progress: 46 };
  }
  if (event.type === 'tool_call_succeeded') {
    return { message: `执行完成 · ${toolLabel(event.call.name)}`, toolName: event.call.name, taskId: event.resultRef, step: TaskCenterStep.CommittingResult, progress: 78 };
  }
  if (event.type === 'tool_call_failed') {
    return { message: `执行失败 · ${toolLabel(event.call.name)}`, toolName: event.call.name, step: TaskCenterStep.CommittingResult, progress: 78 };
  }
  if (event.type === 'confirmation_required') {
    return { message: `等待确认 · ${toolLabel(event.call.name)}`, toolName: event.call.name, step: TaskCenterStep.ResolvingPlan, progress: 36 };
  }
  return undefined;
}

function parseCheckpoint(value: unknown): AgentLoopCheckpoint | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const checkpoint = value as Partial<AgentLoopCheckpoint>;
  return checkpoint.agentRunId && Array.isArray(checkpoint.messages)
    ? checkpoint as AgentLoopCheckpoint
    : undefined;
}

async function findWaitingRun(runtime: TutorDatabaseRuntime, sessionId: string) {
  return (await runtime.getAgentRunViews.execute({ limit: 50 }))
    .find((run) => run.chatSessionId === sessionId && run.status === 'waiting_user');
}

function confirmationText(call?: ModelToolCall): string {
  if (!call) return '这项操作需要你确认。回复“确认”继续，回复“取消”终止。';
  if (call.name === 'candidate.change_target') {
    return `准备把${subjectLabel(String(call.arguments.subject || ''))}目标分改为 ${String(call.arguments.targetScore || '')}。回复“确认”继续，回复“取消”终止。`;
  }
  return `准备执行“${toolLabel(call.name)}”。回复“确认”继续，回复“取消”终止。`;
}

function shouldUseAgent(text: string): boolean {
  return Boolean(text.trim());
}

function isConfirm(text: string): boolean {
  return /^(确认|确定|开始|执行|可以|好|好的|行|嗯|是|yes|ok)$/i.test(text.trim());
}

function isCancel(text: string): boolean {
  return /^(取消|算了|不要|停止|不执行|否|no)$/i.test(text.trim());
}

function toolLabel(code: string): string {
  return ({
    student_read_profile: '读取学习档案',
    'student.read_profile': '读取学习档案',
    practice_read_library: '读取题库状态',
    'practice.read_library': '读取题库状态',
    'practice.read_question_set': '读取题组内容',
    'learning.review_session': '读取练习复盘',
    'teaching.request_practice': '创建针对性训练',
    'file.read_text': '读取导入文件',
    'planning.propose_daily_plan': '分析今日计划',
    'candidate.change_target': '修改目标分',
    generate_practice: '生成专项练习',
    generate_mock: '生成模拟考试',
    generate_essay: '生成申论练习',
    redo_wrongbook: '生成错题重练',
    generate_digest: '生成每日积累',
    generate_monthly_digest: '生成月度复盘',
    grade_essay: '申论批改',
    review_interview: '面试点评'
  } as Record<string, string>)[code] || code;
}

function activityStatus(
  event: ToolActivityEvent
): AgentToolActivityStatus {
  if (event.type === 'tool_call_requested') return 'queued';
  if (event.type === 'tool_call_started') return 'running';
  if (event.type === 'confirmation_required') return 'waiting_user';
  if (event.type === 'tool_call_succeeded') return 'completed';
  return 'failed';
}

type ToolActivityEvent = Extract<AgentRuntimeEvent, {
  type: 'tool_call_requested'
    | 'tool_call_started'
    | 'tool_call_succeeded'
    | 'tool_call_failed'
    | 'confirmation_required';
}>;

function isToolActivityEvent(event: AgentRuntimeEvent): event is ToolActivityEvent {
  return event.type === 'tool_call_requested'
    || event.type === 'tool_call_started'
    || event.type === 'tool_call_succeeded'
    || event.type === 'tool_call_failed'
    || event.type === 'confirmation_required';
}

function subjectLabel(subject: string): string {
  return ({ aptitude: '行测', essay: '申论', interview: '面试' } as Record<string, string>)[subject] || subject;
}

function compactText(value: string): string {
  return value.length > 80 ? `${value.slice(0, 80)}...` : value;
}

function chatExecutionFailureText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || '');
  if (/network|fetch|timeout|超时|连接|provider\.transient|provider\.rate_limited/i.test(message)) {
    return '模型服务暂时没有响应，请稍后重试。';
  }
  if (/version conflict|database|sqlite|transaction|事务|数据库/i.test(message)) {
    return '本地数据正在忙，请稍后重试。刚才的工具执行状态已保留。';
  }
  return '后续回复没有正常返回，请重试。刚才的工具执行状态已保留。';
}

function visibleAssistantText(value: string): string {
  let visible = value.replace(/<think>[\s\S]*?<\/think>/gi, '');
  const openThinking = visible.search(/<think>/i);
  if (openThinking >= 0) visible = visible.slice(0, openThinking);
  return visible
    .replace(/<\/?thinking>/gi, '')
    .trim();
}

function hasVisibleAssistantContent(value: string): boolean {
  const readable = value
    .replace(/<[^>]*(?:>|$)/g, '')
    .replace(/[\s`*_#[\]()>~|\\-]+/g, '');
  return /[\p{L}\p{N}\p{Extended_Pictographic}]/u.test(readable);
}

function isWeekend(): boolean {
  const day = new Date().getDay();
  return day === 0 || day === 6;
}

export const chatAgentService = new ChatAgentService();
