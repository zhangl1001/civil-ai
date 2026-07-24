import { aiChatRepository } from '@/services/AIChatRepository';
import { aiEngine } from '@/ai/AIEngine';
import { aiBusinessTools, type AIBusinessToolCall, type AIBusinessToolName } from '@/services/AIBusinessTools';
import { ProfileRequiredError } from '@/services/ProfileGuardService';
import type { AISession } from '@/domain/ai';
import { initializeTutorRuntime } from '@/composition-root/public';
import { AgentRunAction, AgentRunType } from '@/modules/agent/public';
import type { AgentRunAggregate } from '@/modules/agent/public';

type CommandIntent = 'practice' | 'mock' | 'essay' | 'essay_grade' | 'redo' | 'digest' | 'monthly_digest' | 'interview_review';

interface ParsedCommand {
  intent: CommandIntent;
  module?: string;
  questionCount?: number;
  difficulty?: string;
  knowledgePoint?: string;
  essayTopic?: string;
  essayType?: 'short' | 'long';
  digestTab?: 'news' | 'tips';
  missing?: string[];
}

interface CommandResult {
  handled: boolean;
  reply?: string;
  taskId?: string;
}

type PendingMode = 'slot' | 'confirm';

interface PendingToolState {
  version: 2;
  mode: PendingMode;
  call: AIBusinessToolCall;
  missing: string[];
}

const MODULES = ['资料分析', '判断推理', '言语理解', '数量关系', '常识判断'];
const CONFIRM_PREFIX = 'ai-pending-tool:';

function parseCount(text: string, fallback: number): number {
  const match = text.match(/(\d{1,3})\s*(?:道|题|个)/);
  if (!match) return fallback;
  return Math.max(1, Math.min(120, Number(match[1])));
}

function parseModule(text: string): string | undefined {
  return MODULES.find((module) => text.includes(module));
}

function parseDifficulty(text: string): string | undefined {
  if (/基础|简单|容易/.test(text)) return '基础';
  if (/进阶|困难|难题|拔高/.test(text)) return '进阶';
  if (/标准|中等|普通/.test(text)) return '标准';
  return undefined;
}

function parseEssayTopic(text: string): string {
  if (/申发论述|大作文|作文/.test(text)) return '申发论述';
  if (/贯彻执行|公文/.test(text)) return '贯彻执行';
  if (/提出对策|对策/.test(text)) return '提出对策';
  if (/综合分析|分析/.test(text)) return '综合分析';
  if (/归纳概括|概括/.test(text)) return '归纳概括';
  return '申论小题';
}

function parseCommand(text: string): ParsedCommand | null {
  const clean = text.trim();
  if (!clean) return null;

  if (/月报|月度复盘|时政复盘/.test(clean)) {
    return { intent: 'monthly_digest' };
  }
  if (/每日积累|每日热点|时政热点|每日知识点/.test(clean)) {
    return { intent: 'digest', digestTab: /知识点|常识/.test(clean) ? 'tips' : 'news' };
  }
  if (/面试.*(点评|复盘|分析)/.test(clean)) {
    return { intent: 'interview_review' };
  }
  if (/申论/.test(clean) && /批改|评分|点评/.test(clean)) {
    return { intent: 'essay_grade' };
  }
  if (/申论/.test(clean) && /生成|出题|练习|模考|来.*题/.test(clean)) {
    const topic = parseEssayTopic(clean);
    return {
      intent: 'essay',
      essayTopic: topic,
      essayType: topic === '申发论述' ? 'long' : 'short',
      questionCount: parseCount(clean, topic === '申发论述' ? 1 : 1)
    };
  }
  if (/模考|套卷|模拟考试/.test(clean)) {
    return { intent: 'mock', questionCount: parseCount(clean, 120) };
  }
  if (/错题|重练|重做|复习/.test(clean) && /生成|来|练|刷|做/.test(clean)) {
    const module = parseModule(clean);
    return {
      intent: 'redo',
      module,
      questionCount: parseCount(clean, 10),
      difficulty: parseDifficulty(clean),
      missing: module ? [] : ['module']
    };
  }
  if (/生成|出题|来.*题|练.*题|刷.*题/.test(clean)) {
    const module = parseModule(clean);
    if (!module) return null;
    return {
      intent: 'practice',
      module,
      questionCount: parseCount(clean, 10),
      difficulty: parseDifficulty(clean)
    };
  }
  return null;
}

function toToolCall(command: ParsedCommand): AIBusinessToolCall {
  const nameByIntent: Record<CommandIntent, AIBusinessToolName> = {
    practice: 'generate_practice',
    mock: 'generate_mock',
    essay: 'generate_essay',
    essay_grade: 'grade_essay',
    redo: 'redo_wrongbook',
    digest: 'generate_digest',
    monthly_digest: 'generate_monthly_digest',
    interview_review: 'review_interview'
  };
  return {
    name: nameByIntent[command.intent],
    arguments: {
      module: command.module,
      questionCount: command.questionCount,
      difficulty: command.difficulty,
      knowledgePoint: command.knowledgePoint,
      essayTopic: command.essayTopic,
      essayType: command.essayType,
      digestTab: command.digestTab
    }
  };
}

function extractJsonObject(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) return text.slice(first, last + 1);
  return text.trim();
}

function buildToolClassifierPrompt(text: string): string {
  const tools = aiBusinessTools.definitions().map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters
  }));
  return [
    '# 任务识别',
    '你只负责判断用户是否想调用一个受控业务工具。',
    '你不能执行工具，不能生成题目，不能输出完整提示词。',
    '',
    '## 可用工具',
    JSON.stringify(tools, null, 2),
    '',
    '## 输出格式',
    '只输出 JSON 对象：',
    '{"action":"tool","confidence":0.0,"tool":{"name":"generate_practice","arguments":{}},"missing":["module"]}',
    '或：',
    '{"action":"chat","confidence":0.0}',
    '',
    '## 判定规则',
    '- 只有用户明确要求生成、批改、复盘、模考、错题重练、每日积累时才 action=tool。',
    '- 普通聊天、鼓励、解释、学习建议 action=chat。',
    '- confidence 0.55 到 0.85 之间，如果像任务但参数不完整，也可以输出 tool，并在 missing 写缺失参数。',
    '- confidence 低于 0.55 时应输出 chat。',
    '',
    '## 用户消息',
    text
  ].join('\n');
}

interface ClassifiedTool {
  call: AIBusinessToolCall;
  confidence: number;
  missing: string[];
}

async function classifyByAI(text: string): Promise<ClassifiedTool | null> {
  const raw = await aiEngine.complete([
    { role: 'system', content: '你是工具路由分类器。只输出 JSON，不解释。' },
    { role: 'user', content: buildToolClassifierPrompt(text) }
  ], undefined, { temperature: 0 });
  try {
    const parsed = JSON.parse(extractJsonObject(raw)) as {
      action?: string;
      confidence?: number;
      tool?: { name?: string; arguments?: Record<string, unknown> };
      missing?: string[];
    };
    const names = new Set(aiBusinessTools.definitions().map((tool) => tool.name));
    const confidence = Number(parsed.confidence || 0);
    if (parsed.action !== 'tool' || confidence < 0.55) return null;
    if (!parsed.tool?.name || !names.has(parsed.tool.name as AIBusinessToolName)) return null;
    return {
      call: {
        name: parsed.tool.name as AIBusinessToolName,
        arguments: parsed.tool.arguments || {}
      },
      confidence,
      missing: Array.isArray(parsed.missing) ? parsed.missing.filter((item): item is string => typeof item === 'string') : []
    };
  } catch {
    return null;
  }
}

function shouldAskToolClassifier(text: string): boolean {
  return /生成|出题|批改|评分|点评|复盘|模考|模拟|套卷|错题|重练|重做|每日积累|每日热点|时政|月报|面试|申论|行测|刷题|练题|做题/.test(text);
}

function pendingKey(sessionId: string): string {
  return `${CONFIRM_PREFIX}${sessionId}`;
}

function isPendingState(value: PendingToolState | AIBusinessToolCall): value is PendingToolState {
  return 'version' in value && value.version === 2 && 'call' in value;
}

function readPending(sessionId: string): PendingToolState | null {
  try {
    const raw = sessionStorage.getItem(pendingKey(sessionId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingToolState | AIBusinessToolCall;
    if (isPendingState(parsed)) return parsed;
    return {
      version: 2,
      mode: 'confirm',
      call: parsed,
      missing: missingRequiredArguments(parsed)
    };
  } catch {
    return null;
  }
}

function writePending(sessionId: string, state: PendingToolState): void {
  sessionStorage.setItem(pendingKey(sessionId), JSON.stringify(state));
}

function clearPending(sessionId: string): void {
  sessionStorage.removeItem(pendingKey(sessionId));
}

function isConfirm(text: string): boolean {
  return /^(确认|确定|开始|执行|可以|好|好的|行|嗯|是|yes|ok)$/i.test(text.trim());
}

function isCancel(text: string): boolean {
  return /^(取消|算了|不要|先别|不用|否|no)$/i.test(text.trim());
}

function hasRequiredArguments(call: AIBusinessToolCall): boolean {
  return missingRequiredArguments(call).length === 0;
}

function normalizeMissing(missing: string[] = []): string[] {
  return Array.from(new Set(missing.filter(Boolean)));
}

function missingRequiredArguments(call: AIBusinessToolCall, hintedMissing: string[] = []): string[] {
  const missing = normalizeMissing(hintedMissing);
  const definition = aiBusinessTools.definitions().find((tool) => tool.name === call.name);
  definition?.parameters.required.forEach((key) => {
    if (!call.arguments[key]) missing.push(key);
  });
  if (call.name === 'redo_wrongbook' && hintedMissing.includes('module') && !call.arguments.module) missing.push('module');
  return normalizeMissing(missing);
}

function commandNeedsConfirmation(command: ParsedCommand, call: AIBusinessToolCall): boolean {
  if (command.missing?.length) return true;
  return !hasRequiredArguments(call);
}

function missingLabel(name: string): string {
  if (name === 'module') return '模块';
  if (name === 'questionCount') return '题量';
  if (name === 'difficulty') return '难度';
  if (name === 'essayTopic') return '申论题型';
  return name;
}

function buildConfirmReply(call: AIBusinessToolCall, missing: string[] = []): string {
  const suffix = missing.length
    ? `我还不确定${missing.map(missingLabel).join('、')}，会先按默认值处理。`
    : '这个操作会创建任务。';
  return `我理解你可能想要：${describeToolCall(call)}。${suffix}确认执行吗？回复“确认”开始，或回复“取消”。`;
}

function buildSlotQuestion(call: AIBusinessToolCall, missing: string[]): string {
  const first = missing[0];
  if (first === 'module') {
    if (call.name === 'redo_wrongbook') return `你想重练哪个模块的错题？可以回复：${MODULES.join('、')}。`;
    return `你想练哪个行测模块？可以回复：${MODULES.join('、')}。`;
  }
  if (first === 'questionCount') return '这次想生成多少道题？可以直接回复题量，比如“10道”。';
  if (first === 'difficulty') return '这次想用什么难度？可以回复：基础、标准、进阶。';
  if (first === 'essayTopic') return '这次想练哪类申论题？可以回复：归纳概括、综合分析、提出对策、贯彻执行、申发论述。';
  return `还差一个信息：${missingLabel(first)}。你可以直接补充。`;
}

function fillPendingSlot(state: PendingToolState, text: string): PendingToolState {
  const next: PendingToolState = {
    version: 2,
    mode: state.mode,
    call: {
      name: state.call.name,
      arguments: { ...(state.call.arguments || {}) }
    },
    missing: [...state.missing]
  };
  if (next.missing.includes('module')) {
    const module = parseModule(text);
    if (module) next.call.arguments.module = module;
  }
  if (next.missing.includes('questionCount')) {
    const count = parseCount(text, 0);
    if (count > 0) next.call.arguments.questionCount = count;
  }
  if (next.missing.includes('difficulty')) {
    const difficulty = parseDifficulty(text);
    if (difficulty) next.call.arguments.difficulty = difficulty;
  }
  if (next.missing.includes('essayTopic')) {
    const topic = parseEssayTopic(text);
    if (topic) {
      next.call.arguments.essayTopic = topic;
      next.call.arguments.essayType = topic === '申发论述' ? 'long' : 'short';
    }
  }
  next.missing = missingRequiredArguments(next.call, next.missing);
  return next;
}

async function executeToolCall(session: AISession, call: AIBusinessToolCall): Promise<CommandResult> {
  const startedAt = Date.now();
  const agentRun = await startToolAgentRun(session, call, startedAt);
  const progressMessage = await aiChatRepository.addMessage({
    sessionId: session.id,
    role: 'tool',
    content: buildToolProgress(call, 'running'),
    toolName: call.name
  });
  try {
    const runtime = await initializeTutorRuntime();
    if (!agentRun) {
      const result = await aiBusinessTools.execute(call, { sessionId: session.id });
      await aiChatRepository.updateMessageMeta(progressMessage.id, {
        content: buildToolProgress(call, 'done', {
          taskId: result.taskId,
          elapsedMs: Date.now() - startedAt
        }),
        toolCallId: result.taskId || undefined,
        toolName: call.name
      });
      await aiChatRepository.addMessage({
        sessionId: session.id,
        role: 'assistant',
        content: result.reply,
        toolCallId: result.taskId || undefined,
        toolName: call.name
      });
      return { handled: true, reply: result.reply, taskId: result.taskId };
    }
    await runtime.runTutorAgentBatch.executeRuns([agentRun]);
    const latest = await runtime.agentRunRepository.findById(agentRun.run.id);
    const reply = extractToolReply(latest, call);
    const taskId = extractToolTaskId(latest);
    const failedReply = extractToolFailureReply(latest, call, reply);
    if (failedReply) throw new Error(failedReply);
    await aiChatRepository.updateMessageMeta(progressMessage.id, {
      content: buildToolProgress(call, 'done', {
        taskId,
        elapsedMs: Date.now() - startedAt
      }),
      toolCallId: taskId || undefined,
      toolName: call.name
    });
    await aiChatRepository.addMessage({
      sessionId: session.id,
      role: 'assistant',
      content: reply,
      toolCallId: taskId || undefined,
      toolName: call.name
    });
    return { handled: true, reply, taskId };
  } catch (error) {
    const reply = toolErrorReply(error);
    await failToolAgentRun(agentRun, reply);
    await aiChatRepository.updateMessageMeta(progressMessage.id, {
      content: buildToolProgress(call, 'failed', {
        error: reply,
        elapsedMs: Date.now() - startedAt
      }),
      toolName: call.name
    });
    await aiChatRepository.addMessage({
      sessionId: session.id,
      role: 'assistant',
      content: reply,
      toolName: call.name
    });
    return { handled: true, reply };
  }
}

async function startToolAgentRun(session: AISession, call: AIBusinessToolCall, startedAt: number): Promise<AgentRunAggregate | undefined> {
  try {
    const runtime = await initializeTutorRuntime();
    const cycle = await runtime.candidateRepository.findCurrentCycle();
    const created = await runtime.createAgentRun.execute({
      idempotencyKey: `chat-tool:${session.id}:${call.name}:${startedAt}:${stableToolKey(call)}`,
      runType: runTypeForTool(call.name),
      examCycleId: cycle?.examCycle.id,
      targetResourceType: 'chat_tool',
      targetResourceId: session.id,
      inputSnapshot: {
        chatSessionId: session.id,
        toolName: call.name,
        arguments: jsonObject(call.arguments)
      }
    });
    if (created.run.status !== 'queued') return created;
    return runtime.transitionAgentRun.execute({
      idempotencyKey: `chat-tool:${created.run.id}:started`,
      agentRunId: created.run.id,
      action: AgentRunAction.Start,
      reasonCode: 'chat_tool.started',
      payload: { toolName: call.name }
    });
  } catch {
    return undefined;
  }
}

async function failToolAgentRun(agentRun: AgentRunAggregate | undefined, errorCode: string): Promise<void> {
  if (!agentRun || agentRun.run.status === 'completed' || agentRun.run.status === 'failed' || agentRun.run.status === 'cancelled') return;
  try {
    const runtime = await initializeTutorRuntime();
    await runtime.transitionAgentRun.execute({
      idempotencyKey: `chat-tool:${agentRun.run.id}:failed`,
      agentRunId: agentRun.run.id,
      action: AgentRunAction.Fail,
      reasonCode: 'chat_tool.failed',
      errorCode: normalizeAgentErrorCode(errorCode),
      payload: { error: errorCode.slice(0, 400) }
    });
  } catch {
    // Do not mask the original tool failure.
  }
}

function runTypeForTool(toolName: AIBusinessToolName): AgentRunType {
  if (toolName === 'generate_practice' || toolName === 'redo_wrongbook' || toolName === 'generate_mock' || toolName === 'generate_essay') return AgentRunType.ContentGeneration;
  if (toolName === 'generate_digest' || toolName === 'generate_monthly_digest') return AgentRunType.TeachingPlan;
  return AgentRunType.TutorTurn;
}

function stableToolKey(call: AIBusinessToolCall): string {
  return JSON.stringify({ name: call.name, arguments: jsonObject(call.arguments) }).slice(0, 300);
}

function normalizeAgentErrorCode(value: string): string {
  const code = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  return code.slice(0, 80) || 'chat_tool_failed';
}

function extractToolReply(agentRun: AgentRunAggregate | undefined, call: AIBusinessToolCall): string {
  const checkpoint = agentRun?.run.checkpoint;
  const reply = textField((checkpoint as Record<string, unknown> | undefined)?.reply);
  if (reply) return reply;
  return `已开始${describeToolCall(call)}，你可以在任务栏查看进度。`;
}

function extractToolTaskId(agentRun: AgentRunAggregate | undefined): string | undefined {
  return textField((agentRun?.run.checkpoint as Record<string, unknown> | undefined)?.taskId);
}

function extractToolFailureReply(agentRun: AgentRunAggregate | undefined, call: AIBusinessToolCall, fallbackReply: string): string | undefined {
  if (!agentRun) return undefined;
  if (agentRun.run.status === 'completed') return undefined;
  if (agentRun.run.status === 'cancelled') return '已取消这次操作。';
  if (agentRun.run.status === 'failed') {
    const code = textField(agentRun.run.errorCode) || textField(agentRun.run.cancellationReason) || 'agent_run.failed';
    return `工具执行失败：${describeToolCall(call)} · ${code}`;
  }
  return fallbackReply;
}

function textField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function jsonObject(value: Record<string, unknown>): Record<string, string | number | boolean | null> {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonPrimitive(item)]));
}

function jsonPrimitive(value: unknown): string | number | boolean | null {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value === null || value === undefined) return null;
  return String(value);
}

function toolErrorReply(error: unknown): string {
  if (error instanceof ProfileRequiredError) return `${error.message}你可以先回到首页点“开始建档”，填好目标分、当前分和学习时间。`;
  return `工具执行失败：${error instanceof Error ? error.message : String(error)}`;
}

function describeToolCall(call: AIBusinessToolCall): string {
  const args = call.arguments || {};
  if (call.name === 'generate_practice') return `生成${args.module || '行测'}练习，题量 ${args.questionCount || 10}${args.difficulty ? `，难度 ${args.difficulty}` : ''}`;
  if (call.name === 'redo_wrongbook') return `生成错题重练，模块 ${args.module || '默认'}，题量 ${args.questionCount || 10}`;
  if (call.name === 'generate_mock') return `生成行测模考，题量 ${args.questionCount || 120}`;
  if (call.name === 'generate_essay') return `生成${args.essayTopic || '申论'}题`;
  if (call.name === 'generate_digest') return args.digestTab === 'tips' ? '生成每日知识点' : '生成每日热点';
  if (call.name === 'generate_monthly_digest') return '生成时政月报';
  if (call.name === 'grade_essay') return '进入申论批改流程';
  if (call.name === 'review_interview') return '进入面试深度点评流程';
  return call.name;
}

function formatElapsed(ms?: number): string {
  if (!ms || ms < 1000) return '';
  const seconds = Math.max(1, Math.round(ms / 1000));
  return ` · ${seconds}s`;
}

function buildToolProgress(
  call: AIBusinessToolCall,
  status: 'running' | 'done' | 'failed',
  extra: { taskId?: string; elapsedMs?: number; error?: string } = {}
): string {
  const title = describeToolCall(call);
  if (status === 'running') {
    return [`工具执行中：${title}`, `工具：${call.name}`].join('\n');
  }
  if (status === 'done') {
    const task = extra.taskId ? `\n任务：${extra.taskId}` : '';
    return `工具完成：${title}${formatElapsed(extra.elapsedMs)}${task}`;
  }
  return `工具失败：${title}${formatElapsed(extra.elapsedMs)}\n原因：${extra.error || '未知错误'}`;
}

export class AICommandRouter {
  async handle(text: string, session: AISession): Promise<CommandResult> {
    const pending = readPending(session.id);
    if (pending) {
      if (isCancel(text)) {
        clearPending(session.id);
        await aiChatRepository.addMessage({ sessionId: session.id, role: 'user', content: text.trim() });
        await aiChatRepository.addMessage({ sessionId: session.id, role: 'assistant', content: '已取消这次操作。' });
        return { handled: true, reply: '已取消这次操作。' };
      }
      if (pending.mode === 'confirm' && isConfirm(text)) {
        clearPending(session.id);
        await aiChatRepository.addMessage({ sessionId: session.id, role: 'user', content: text.trim() });
        return executeToolCall(session, pending.call);
      }
      if (pending.mode === 'slot') {
        await aiChatRepository.addMessage({ sessionId: session.id, role: 'user', content: text.trim() });
        const filled = fillPendingSlot(pending, text);
        if (filled.missing.length) {
          writePending(session.id, { ...filled, mode: 'slot' });
          const reply = buildSlotQuestion(filled.call, filled.missing);
          await aiChatRepository.addMessage({ sessionId: session.id, role: 'assistant', content: reply, toolName: filled.call.name });
          return { handled: true, reply };
        }
        writePending(session.id, { ...filled, mode: 'confirm', missing: [] });
        const reply = buildConfirmReply(filled.call);
        await aiChatRepository.addMessage({ sessionId: session.id, role: 'assistant', content: reply, toolName: filled.call.name });
        return { handled: true, reply };
      }
      clearPending(session.id);
    }

    const command = parseCommand(text);
    const classified = command || !shouldAskToolClassifier(text) ? null : await classifyByAI(text);
    const toolCall = command ? toToolCall(command) : classified?.call;
    if (!toolCall) return { handled: false };

    await aiChatRepository.addMessage({ sessionId: session.id, role: 'user', content: text.trim() });

    const needsConfirmation = command
      ? commandNeedsConfirmation(command, toolCall)
      : Boolean(classified && (classified.confidence < 0.85 || classified.missing.length || !hasRequiredArguments(toolCall)));
    const missing = command
      ? missingRequiredArguments(toolCall, command.missing || [])
      : missingRequiredArguments(toolCall, classified?.missing || []);

    if (missing.length) {
      writePending(session.id, { version: 2, mode: 'slot', call: toolCall, missing });
      const reply = buildSlotQuestion(toolCall, missing);
      await aiChatRepository.addMessage({
        sessionId: session.id,
        role: 'assistant',
        content: reply,
        toolName: toolCall.name
      });
      return { handled: true, reply };
    }

    if (needsConfirmation) {
      writePending(session.id, { version: 2, mode: 'confirm', call: toolCall, missing: [] });
      const reply = buildConfirmReply(toolCall);
      await aiChatRepository.addMessage({
        sessionId: session.id,
        role: 'assistant',
        content: reply,
        toolName: toolCall.name
      });
      return { handled: true, reply };
    }

    return executeToolCall(session, toolCall);
  }
}

export const aiCommandRouter = new AICommandRouter();
