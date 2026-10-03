import type { ModelToolCall } from '@/capabilities/ai-runtime/public';
import type { TutorDatabaseRuntime } from '@/composition-root/public';
import type { JsonObject } from '@/kernel/public';
import {
  TaskCenterStep,
  type AgentLoopCheckpoint,
  type AgentRuntimeEvent
} from '@/modules/agent/public';
import type { AgentToolActivityStatus } from './AgentToolActivityService';

export function eventStatus(event: AgentRuntimeEvent): {
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

export function parseCheckpoint(value: unknown): AgentLoopCheckpoint | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const checkpoint = value as Partial<AgentLoopCheckpoint>;
  return checkpoint.agentRunId && Array.isArray(checkpoint.messages)
    ? checkpoint as AgentLoopCheckpoint
    : undefined;
}

export function budgetContinuationCheckpoint(
  checkpoint: AgentLoopCheckpoint
): AgentLoopCheckpoint {
  return {
    ...checkpoint,
    turnCount: 0,
    toolCallCount: 0,
    pendingConfirmation: undefined,
    pendingConfirmationArgumentsHash: undefined,
    pauseReason: undefined
  };
}

export function asJsonObject(value: unknown): JsonObject {
  const serialized = JSON.parse(JSON.stringify(value)) as unknown;
  if (!serialized || typeof serialized !== 'object' || Array.isArray(serialized)) {
    throw new TypeError('Agent checkpoint must serialize to an object');
  }
  return serialized as JsonObject;
}

export async function findWaitingRun(runtime: TutorDatabaseRuntime, sessionId: string) {
  return (await runtime.getAgentRunViews.execute({ limit: 50 }))
    .find((run) => run.chatSessionId === sessionId && run.status === 'waiting_user');
}

export function confirmationText(call?: ModelToolCall): string {
  if (!call) return '这项操作需要你确认。回复“确认”继续，回复“取消”终止。';
  if (call.name === 'candidate.change_target') {
    return `准备把${subjectLabel(String(call.arguments.subject || ''))}目标分改为 ${String(call.arguments.targetScore || '')}。回复“确认”继续，回复“取消”终止。`;
  }
  if (call.name === 'question_bank.confirm') {
    return '准备确认本次扫描结果；这一步只锁定草稿，不会发布正式题组。回复“确认”继续，回复“取消”终止。';
  }
  if (call.name === 'question_bank.publish') {
    return '准备把已确认草稿发布为正式题组。发布后题目会进入题库，回复“确认”继续，回复“取消”终止。';
  }
  return `准备执行“${toolLabel(call.name)}”。回复“确认”继续，回复“取消”终止。`;
}

export const BUDGET_PAUSE_TEXT = '这一步已到达本段安全执行边界，进度和工具证据已经保留。你可以直接补充要求或让我继续，我会从当前状态接着处理。';

/**
 * Added to a turn whose message reads as a yes while nothing waits for one:
 * a bare "确认" must not let the model act out a confirmation or a completion.
 */
export const NO_PENDING_CONFIRMATION_FACT = [
  '# 运行时事实：当前没有等待确认的操作',
  '本会话此刻没有任何操作在等待用户确认，用户这条回复不会执行任何操作。',
  '如果用户想修改数据，必须调用对应工具；系统会在调用后向用户展示确认。没有本轮工具的成功结果时，不得声称已经修改、保存或完成，也不得自己写出确认提示。'
].join('\n');

/** A write tool call compacted for the chat history trace. */
export function toolTraceEntry(call: ModelToolCall): { readonly toolName: string; readonly arguments: string } {
  const json = JSON.stringify(call.arguments ?? {});
  return { toolName: call.name, arguments: json.length > 160 ? `${json.slice(0, 157)}...` : json };
}

/** Asked again when a reply to a pending confirmation was neither yes nor no. */
export function pendingConfirmationReminder(call?: ModelToolCall): string {
  return `这项操作还在等你确认：${confirmationText(call)}如果想先调整要求或聊别的，请先回复“取消”。`;
}

export function toolLabel(code: string): string {
  return ({
    'system.read_clock': '读取设备时间',
    student_read_profile: '读取学习档案',
    'student.read_profile': '读取学习档案',
    'tutor.read_daily_context': '读取今日教学状态',
    'workspace.discover': '检索本地学习资源',
    'task.read_status': '核验任务状态',
    practice_read_library: '读取题库状态',
    'practice.read_library': '读取题库状态',
    'practice.read_question_set': '读取题组内容',
    'learning.review_session': '读取练习复盘',
    'teaching.request_practice': '创建针对性训练',
    'file.read_text': '读取导入文件',
    'question_bank.scan': '扫描题目草稿',
    'question_bank.repair': '自动修正题目结构',
    'question_bank.resume': '恢复导入草稿',
    'question_bank.confirm': '确认题目草稿',
    'question_bank.publish': '发布正式题组',
    'planning.propose_daily_plan': '分析今日计划',
    'candidate.change_target': '修改目标分',
    'web.search': '搜索公开资料',
    'web.read_page': '读取网页证据',
    'memory.remember': '记住个人偏好',
    'memory.forget': '遗忘个人偏好',
    generate_practice: '生成专项练习',
    generate_mock: '生成模拟考试',
    generate_essay: '生成申论练习',
    redo_wrongbook: '生成错题重练',
    generate_digest: '生成每日积累',
    generate_monthly_digest: '生成月度复盘',
    research_true_questions: '创建联网真题研究任务',
    grade_essay: '申论批改',
    review_interview: '面试点评'
  } as Record<string, string>)[code] || code;
}

export function normalizeFreshness(value: unknown): 'day' | 'week' | 'month' | 'year' | 'any' {
  return value === 'day' || value === 'week' || value === 'month' || value === 'year'
    ? value
    : 'any';
}

export function activityStatus(event: ToolActivityEvent): AgentToolActivityStatus {
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

export function isToolActivityEvent(event: AgentRuntimeEvent): event is ToolActivityEvent {
  return event.type === 'tool_call_requested'
    || event.type === 'tool_call_started'
    || event.type === 'tool_call_succeeded'
    || event.type === 'tool_call_failed'
    || event.type === 'confirmation_required';
}

export function compactText(value: string): string {
  return value.length > 80 ? `${value.slice(0, 80)}...` : value;
}

export function asJsonRecord(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('工具参数必须是对象。');
  }
  return value as JsonObject;
}

export function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function isWeekend(): boolean {
  const day = new Date().getDay();
  return day === 0 || day === 6;
}

function subjectLabel(subject: string): string {
  return ({ aptitude: '行测', essay: '申论', interview: '面试' } as Record<string, string>)[subject] || subject;
}
