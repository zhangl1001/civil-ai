import { ORPHANED_FOREGROUND_RUN_REASON } from '../domain/ForegroundAgentRuns';
import { invalidProviderRequestText } from './AgentRunErrorPresentation';

const GENERIC_FAILURE_TEXT = '任务执行失败，请重新生成';
const CHINESE_TEXT = /[\u3400-\u9fff]/;

/**
 * Chinese text for a failed durable task, shared by the task center and the
 * message center. The internal error code and the raw diagnostic stay on the
 * run (`errorCode`, `checkpoint.errorMessage`, the failed event payload) for
 * diagnosis; only this text is shown. A diagnostic is shown verbatim only when
 * it was written for the learner, which in this app means it is Chinese; an
 * internal English message ("Agent run version conflict: …") never is.
 */
export function agentRunFailureText(code: string, diagnostic?: string): string {
  const readable = diagnostic && CHINESE_TEXT.test(diagnostic) ? diagnostic.trim() : undefined;
  return knownFailureText(code, diagnostic, readable) ?? readable ?? GENERIC_FAILURE_TEXT;
}

function knownFailureText(code: string, diagnostic: string | undefined, readable: string | undefined): string | undefined {
  if (code === 'agent_run.input_incompatible') return readable || '该任务来自旧版本，无法安全恢复，请在对应页面重新发起。';
  if (code === 'agent_run.version_conflict') return '任务进度同步冲突，请重新执行任务';
  if (code === 'agent_run.gateway_missing') return '模型服务尚未配置，请先完成模型设置后重试';
  if (code === 'agent_run.handler_missing') return '当前版本暂不支持该任务，请更新应用后重试';
  if (code === 'agent.execution_failed') return readable || 'AI 私教执行失败，请重新发送';
  if (code === 'content.generation_request_conflict') return '同一任务的出题请求前后不一致，已停止以免返回错误的题组，请重新发起';
  if (code === 'agent.AbortError' || code === 'generation.process_interrupted') return '模型连接意外中断，请重新执行任务';
  if (code === 'agent.GeneratedContentParseError' || code.startsWith('generation.json')) return '模型返回内容不完整，自动重试后仍无法解析';
  if (code === 'generation.lecture_schema_invalid') return '讲义结构校验失败，请重新生成';
  if (code === 'generation.question_schema_invalid' || code === 'generation.questions_invalid') return '题目结构校验失败，请重新生成';
  if (code.includes('schema_invalid')) return '生成内容结构校验失败，请重新生成';
  if (code === 'generation.quality_invalid') return '生成内容结构不完整，请重新生成';
  if (code === 'generation.error_diagnosis_invalid') return '模型返回的错因结构不完整，请重新分析';
  if (code.startsWith('generation.')) return '生成内容校验失败，请重新生成';
  if (code === 'provider.authentication') return '模型配置认证失败，请检查 API Key';
  if (code === 'provider.invalid_request') return invalidProviderRequestText(diagnostic);
  if (code === 'provider.rate_limited') return '模型服务限流，任务会自动重试';
  if (code === 'provider.empty_response') return '模型没有返回有效内容，请重新生成';
  if (code === 'provider.protocol') return '模型接口返回格式不兼容，请检查 Base URL';
  if (code === 'provider.transient') return '模型网络或服务暂时异常，请稍后重试';
  if (code.startsWith('provider.')) return '模型服务请求失败，请检查模型配置';
  return undefined;
}

/**
 * Chinese text for a cancelled task. Cancellation reasons are codes chosen by
 * the caller (`user_cancelled_from_task_dock`, `chat_agent.orphaned`); a reason
 * that is already learner text is shown as it is.
 */
export function agentRunCancellationText(reason: string): string {
  const code = reason.trim();
  if (code === ORPHANED_FOREGROUND_RUN_REASON) return '对话在页面关闭或应用重启时中断，请重新发送';
  if (code === 'app_lifecycle_interrupted_chat_agent') return '应用切到后台，本次对话已中断';
  if (code === 'agent_run.worker_aborted') return '任务已中断，可重新发起';
  if (code === 'user_replaced_pending_agent_action') return '已被新的请求替代';
  if (CHINESE_TEXT.test(code)) return code;
  return '任务已取消';
}
